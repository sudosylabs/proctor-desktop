import { ServerApiClient, type ApiObservation } from '../../serverApi/node/serverApiClient.js';
import { resolveApiRoute } from '../../serverApi/node/legacyApiRequest.js';
import { ServerApiError } from '../../serverApi/common/serverApi.js';
import {
	ProjectionFailure,
	projectRead,
	type SessionBinding
} from '../../serverApi/common/projection.js';
import { decodeJson, type HttpResponse } from '../../serverApi/node/serverHttpTransport.js';
import type { PreparedApiRequest } from '../../serverApi/node/apiRequest.js';
import {
	validateExamActivityIntent,
	type ExamActivityIntent,
	type ExamActivityResponse
} from '../../examActivity/common/examActivityProtocol.js';
import { readExamActivityWire } from '../../examActivity/electron-main/examActivityWire.js';
import { validateUserSettingsCommitIntent } from '../../settings/common/settingsRendererProtocol.js';
import {
	readUserSettingsWire,
	readUserSettingsRevision,
	type UserSettingsSessionService
} from '../../settings/common/userSettingsSession.js';
import type {
	SettingsCommitRequest,
	SettingsCommitResult
} from '../../settings/common/userSettingsService.js';
import type { DesktopSessionOutcome } from '../common/desktopSessionOutcome.js';
import { createHash, randomBytes } from 'node:crypto';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import {
	validateAuthenticatedIdentity,
	type AuthenticatedIdentity
} from '../common/authenticatedIdentity.js';
import type { DesktopReleaseTarget, VerifiedServerIdentity } from './serverReadiness.js';
import { LoopbackAuthServer, type LoopbackCallbackPages } from '../node/loopbackAuthServer.js';
import { DesktopAuthorizationError } from '../node/desktopAuthorizationError.js';
import {
	DesktopAuthHttp,
	desktopHttpMethod,
	type DesktopHttpPath,
	type DesktopPhotoRequest,
	type DesktopSettingsRequest,
	type DesktopHttpResult
} from '../node/desktopAuthHttp.js';
import {
	validateAccountIntent,
	validateAccountResponse,
	type AccountFailure,
	type AccountIntent,
	type AccountResponse
} from '../../account/common/accountProtocol.js';
import {
	readAccountProfile,
	readAccountSecurity,
	readAccountSessions,
	readAccountDesktops,
	readAccountNotices,
	readAccountToken,
	readAccountTokenCreation,
	readAccountTokens,
	readAccountGrantableScopes,
	readAccountHistory,
	accountHistoryPath,
	readRevokedSessionCount
} from '../../account/electron-main/accountWire.js';
import {
	createDPoPProof,
	installationKeyScope,
	type DesktopSigningKey,
	type DesktopKeyCustody
} from '../node/desktopSigningKey.js';
import type {
	DesktopCredentialStore,
	StoredDesktopSession
} from '../node/desktopCredentialStore.js';
import {
	record,
	boundedText,
	credential,
	expiry,
	parseTokens,
	errorCode,
	type DesktopTokens
} from '../node/desktopAuthProtocol.js';

interface CurrentSession {
	readonly identity: VerifiedServerIdentity;
	readonly scope: string;
	readonly key: DesktopSigningKey;
	tokens: DesktopTokens;
	stored: StoredDesktopSession;
}
export interface DesktopAuthorizationOptions {
	readonly target: DesktopReleaseTarget;
	/** The running application's identity, which keeps its installation keys apart. */
	readonly applicationId: string;
	readonly keys: DesktopKeyCustody;
	readonly credentials: DesktopCredentialStore;
	readonly http: DesktopAuthHttp;
	readonly openBrowser: (url: string) => Promise<void>;
	readonly callbackPages: LoopbackCallbackPages;
	/** The same pages worded for Confirm it's you, which never signs anyone in. */
	readonly confirmationPages: LoopbackCallbackPages;
	readonly onAuthenticated: (identity: AuthenticatedIdentity) => Promise<void>;
}
/** Owns credentials and exchange effects in main; emitted state never contains credentials. */
export class DesktopAuthorizationService extends Disposable {
	readonly #ended = this._register(new Emitter<DesktopSessionOutcome>());
	readonly onDidEndSession = this.#ended.event;
	#session: CurrentSession | undefined;
	#refresh: Promise<void> | undefined;
	#refreshTimer: ReturnType<typeof setTimeout> | undefined;
	#operations = new CancellationTokenSource();
	#generation = 0;
	#disposed = false;
	#starting = false;
	#signingOut: Promise<void> | undefined;
	#shutdown: Promise<void> | undefined;
	#outcomeSequence = 0;
	#accountMutation: object | undefined;
	/** A confirmation waiting for the system browser; the renderer may stop it. */
	#reauthentication: CancellationTokenSource | undefined;
	/** The sign-in page a browser is completing, kept so it can be opened again until it expires. */
	#pendingSignInPage: { readonly url: string; readonly expiresAt: number } | undefined;
	#api: ServerApiClient | undefined;
	constructor(private readonly options: DesktopAuthorizationOptions) {
		super();
	}

	async start(identity: VerifiedServerIdentity, cancellation: CancellationToken): Promise<void> {
		if (this.#starting || this.#signingOut || this.#shutdown)
			throw new DesktopAuthorizationError('rejected');
		this.#starting = true;
		const operation = new CancellationTokenSource(this.#operations.token);
		const external = cancellation.onCancellationRequested(() => operation.cancel());
		if (cancellation.isCancellationRequested) operation.cancel();
		try {
			await this.#start(identity, operation.token);
		} catch (error) {
			throw error instanceof DesktopAuthorizationError
				? error
				: new DesktopAuthorizationError('unavailable');
		} finally {
			external.dispose();
			operation.dispose();
			this.#starting = false;
		}
	}
	async #start(identity: VerifiedServerIdentity, cancellation: CancellationToken): Promise<void> {
		if (this.#disposed || this.#session) throw new DesktopAuthorizationError('rejected');
		const generation = ++this.#generation;
		const current = (): void => {
			if (
				this.#disposed ||
				cancellation.isCancellationRequested ||
				generation !== this.#generation
			)
				throw new DesktopAuthorizationError('cancelled');
		};
		const scope = installationKeyScope(
			this.options.applicationId,
			identity.origin,
			identity.institutionId
		);
		current();
		const key = await this.options.keys.loadOrCreate(scope);
		current();
		let saved = await this.options.credentials.read(scope);
		current();
		if (saved?.phase === 'rotationPending') {
			// A previous ambiguous rotation already requires a new interactive transaction.
			await this.options.credentials.delete(scope);
			current();
			saved = undefined;
		}
		let session: CurrentSession | undefined;
		try {
			if (saved) {
				if (
					saved.phase !== 'usable' ||
					saved.origin !== identity.origin ||
					saved.institutionId !== identity.institutionId ||
					saved.installationId !== identity.installationId ||
					saved.keyThumbprint !== thumbprint(key) ||
					saved.refreshExpiresAt <= Date.now()
				) {
					await this.options.credentials.delete(scope);
					throw new DesktopAuthorizationError('verificationRequired');
				}
				const tokens = await this.#rotate(scope, key, saved, cancellation);
				session = {
					identity,
					scope,
					key,
					tokens,
					stored: {
						...saved,
						phase: 'usable',
						refreshToken: tokens.refreshToken,
						refreshExpiresAt: tokens.refreshExpiresAt
					}
				};
			} else {
				const tokens = await this.#authorize(identity, key, cancellation);
				session = {
					identity,
					scope,
					key,
					tokens,
					stored: {
						phase: 'usable',
						origin: identity.origin,
						institutionId: identity.institutionId,
						installationId: identity.installationId,
						principalId: tokens.principalId,
						sessionId: tokens.sessionId,
						registrationId: tokens.registrationId,
						keyThumbprint: thumbprint(key),
						refreshToken: tokens.refreshToken,
						refreshExpiresAt: tokens.refreshExpiresAt
					}
				};
			}
			current();
			const projection = await this.#context(session, cancellation);
			current();
			await this.options.credentials.write(scope, session.stored);
			current();
			this.#session = session;
			const activeSession = session;
			this.#api = new ServerApiClient(
				identity.origin,
				(request) => this.executeApiRequest(activeSession, generation, request),
				async (url, challenge) => {
					if (
						this.#session !== activeSession ||
						this.#generation !== generation ||
						this.#disposed
					)
						throw new ServerApiError('sessionEnded');
					if (challenge?.nonce)
						activeSession.tokens = { ...activeSession.tokens, nonce: challenge.nonce };
					if (this.#refresh || activeSession.tokens.accessExpiresAt <= Date.now() + 5000)
						await this.refresh();
					const credential = activeSession.tokens.accessToken;
					const proof = await createDPoPProof(
						activeSession.key,
						'GET',
						url,
						activeSession.tokens.nonce,
						credential
					);
					if (
						this.#session !== activeSession ||
						this.#generation !== generation ||
						this.#disposed
					)
						throw new ServerApiError('sessionEnded');
					return { Authorization: `DPoP ${credential}`, DPoP: proof };
				}
			);
			await this.options.onAuthenticated(projection);
			current();
			this.#scheduleRefresh();
		} catch (error) {
			if (this.#session === session) {
				this.#session = undefined;
				this.#api?.dispose();
				this.#api = undefined;
			}
			if (session) {
				await this.options.credentials.delete(scope).catch(() => undefined);
				await this.#revoke(session).catch(() => undefined);
			}
			throw error instanceof DesktopAuthorizationError
				? error
				: new DesktopAuthorizationError('unavailable');
		}
	}

	async #authorize(
		identity: VerifiedServerIdentity,
		key: DesktopSigningKey,
		token: CancellationToken
	): Promise<DesktopTokens> {
		const state = randomBytes(32).toString('base64url');
		const verifier = randomBytes(32).toString('base64url');
		const listener = await LoopbackAuthServer.start(state, this.options.callbackPages, token);
		try {
			const target = this.#selectors();
			const started = await this.options.http.request(
				identity.origin,
				'/api/v1/auth/desktop/authorizations',
				token,
				{
					body: {
						...target,
						state,
						code_challenge: createHash('sha256').update(verifier).digest('base64url'),
						callback_url: listener.callbackURL,
						public_jwk: key.publicJwk,
						device_name: 'Proctor Desktop'
					}
				}
			);
			if (started.status !== 201) throw new DesktopAuthorizationError('rejected');
			const value = record(started.value);
			const authorizationURL = new URL(boundedText(value.authorization_url, 4096));
			if (
				authorizationURL.origin !== identity.origin ||
				authorizationURL.username ||
				authorizationURL.password
			)
				throw new DesktopAuthorizationError('rejected');
			const expiresAt = expiry(value.expires_at);
			listener.expireAt(expiresAt);
			let nonce = credential(started.nonce);
			if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
			this.#pendingSignInPage = { url: authorizationURL.href, expiresAt };
			await this.options.openBrowser(authorizationURL.href);
			const code = await listener.waitForCode();
			this.#pendingSignInPage = undefined;
			if (Date.now() >= expiresAt) throw new DesktopAuthorizationError('timedOut');
			let result = await this.options.http.request(
				identity.origin,
				'/api/v1/auth/desktop/token',
				token,
				{
					body: {
						...target,
						code,
						state,
						code_verifier: verifier,
						public_jwk: key.publicJwk
					},
					proof: await createDPoPProof(
						key,
						'POST',
						`${identity.origin}/api/v1/auth/desktop/token`,
						nonce
					)
				}
			);
			// A nonce rejection occurs before code consumption. Only this explicit response permits one retry.
			if (errorCode(result) === 'authentication.dpop.use_nonce' && result.nonce) {
				nonce = result.nonce;
				result = await this.options.http.request(
					identity.origin,
					'/api/v1/auth/desktop/token',
					token,
					{
						body: {
							...target,
							code,
							state,
							code_verifier: verifier,
							public_jwk: key.publicJwk
						},
						proof: await createDPoPProof(
							key,
							'POST',
							`${identity.origin}/api/v1/auth/desktop/token`,
							nonce
						)
					}
				);
			}
			return parseTokens(result, nonce);
		} finally {
			this.#pendingSignInPage = undefined;
			await listener.stop();
		}
	}

	/** Opens the waiting sign-in page again. Does nothing once the callback arrived or the page expired. */
	async reopenBrowser(): Promise<void> {
		const page = this.#pendingSignInPage;
		if (this.#disposed || page === undefined || Date.now() >= page.expiresAt) return;
		await this.options.openBrowser(page.url);
	}

	#selectors(): Record<string, string | number> {
		const target = this.options.target;
		return {
			desktop_release: target.release,
			desktop_build_id: target.buildId,
			platform: target.platform,
			architecture: target.architecture,
			realtime_protocol: target.realtimeProtocol
		};
	}
	async #rotate(
		scope: string,
		key: DesktopSigningKey,
		saved: StoredDesktopSession,
		token: CancellationToken,
		nonce = randomBytes(32).toString('base64url')
	): Promise<DesktopTokens> {
		// Persist the uncertainty barrier before sending a one-use refresh credential.
		if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
		await this.options.credentials.write(scope, { ...saved, phase: 'rotationPending' });
		try {
			if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
			let result = await this.#requestProof(
				saved.origin,
				'/api/v1/auth/refresh',
				key,
				saved.refreshToken,
				nonce,
				token,
				false
			);
			if (errorCode(result) === 'authentication.dpop.use_nonce' && result.nonce) {
				nonce = result.nonce;
				result = await this.#requestProof(
					saved.origin,
					'/api/v1/auth/refresh',
					key,
					saved.refreshToken,
					nonce,
					token,
					false
				);
			}
			const next = parseTokens(result, nonce);
			if (
				next.sessionId !== saved.sessionId ||
				next.principalId !== saved.principalId ||
				next.registrationId !== saved.registrationId ||
				next.refreshToken === saved.refreshToken
			)
				throw new DesktopAuthorizationError('verificationRequired');
			if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
			await this.options.credentials.write(scope, {
				...saved,
				phase: 'usable',
				refreshToken: next.refreshToken,
				refreshExpiresAt: next.refreshExpiresAt
			});
			if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
			return next;
		} catch (error) {
			if (token.isCancellationRequested) {
				await this.options.credentials.delete(scope).catch(() => undefined);
				throw new DesktopAuthorizationError('cancelled');
			}
			if (error instanceof DesktopAuthorizationError && error.reason === 'storageUnavailable')
				throw error;
			throw new DesktopAuthorizationError('verificationRequired');
		}
	}
	async #requestProof(
		origin: string,
		path: '/api/v1/auth/refresh' | '/api/v1/auth/logout' | '/api/v1/users/me/context',
		key: DesktopSigningKey,
		secret: string,
		nonce: string,
		token: CancellationToken,
		access = true
	): Promise<DesktopHttpResult> {
		const proof = await createDPoPProof(
			key,
			path === '/api/v1/users/me/context' ? 'GET' : 'POST',
			`${origin}${path}`,
			nonce,
			access ? secret : undefined
		);
		return this.options.http.request(origin, path, token, { proof, credential: secret });
	}
	async #context(
		session: CurrentSession,
		token: CancellationToken
	): Promise<AuthenticatedIdentity> {
		let response = await this.#requestProof(
			session.identity.origin,
			'/api/v1/users/me/context',
			session.key,
			session.tokens.accessToken,
			session.tokens.nonce,
			token
		);
		if (errorCode(response) === 'authentication.dpop.use_nonce' && response.nonce)
			response = await this.#requestProof(
				session.identity.origin,
				'/api/v1/users/me/context',
				session.key,
				session.tokens.accessToken,
				response.nonce,
				token
			);
		if (response.status !== 200) throw new DesktopAuthorizationError('rejected');
		if (response.nonce) session.tokens = { ...session.tokens, nonce: response.nonce };
		const context = record(response.value);
		const user = record(context.user);
		if (
			user.id !== session.tokens.principalId ||
			context.current_desktop_registration_id !== session.tokens.registrationId
		)
			throw new DesktopAuthorizationError('rejected');
		return validateAuthenticatedIdentity({
			principalId: session.tokens.principalId,
			sessionId: session.tokens.sessionId,
			institutionOrigin: session.identity.origin,
			institutionName: session.identity.institutionName,
			displayName: boundedText(user.display_name || user.username, 512),
			availableProductAreas: context.available_product_areas,
			noCurrentAffiliation: context.no_current_affiliation,
			noAssignedAccess: context.no_assigned_access
		});
	}

	/** Closed account capability: credentials, URLs, and arbitrary requests never cross IPC. */
	async account(binding: SessionBinding, raw: AccountIntent): Promise<AccountResponse> {
		const intent = validateAccountIntent(raw);
		if (intent.kind !== 'read' && intent.kind !== 'readPhoto' && intent.kind !== 'readHistory')
			// A change through the typed client already invalidates every cached read.
			return this.accountUncached(binding, intent);
		try {
			return await this.apiForSession(binding).fetchTask(['account', intent], (signal) =>
				projectRead((capture) => this.accountUncached(binding, intent, signal, capture))
			);
		} catch (error) {
			return error instanceof ProjectionFailure
				? (error.response as AccountResponse)
				: {
						kind: 'error',
						reason:
							error instanceof ServerApiError && error.kind === 'sessionEnded'
								? 'sessionEnded'
								: 'unavailable'
					};
		}
	}
	observeAccount(
		binding: SessionBinding,
		raw: AccountIntent,
		listener: (response: AccountResponse) => void
	): ApiObservation {
		const intent = validateAccountIntent(raw);
		if (intent.kind !== 'read' && intent.kind !== 'readPhoto')
			throw new ServerApiError('invalidRequest');
		return this.apiForSession(binding).observeTask(
			['account', intent],
			(signal) =>
				projectRead((capture) => this.accountUncached(binding, intent, signal, capture)),
			(state) => {
				if (state.error)
					listener(
						state.error instanceof ProjectionFailure
							? (state.error.response as AccountResponse)
							: { kind: 'error', reason: 'unavailable' }
					);
				else if (state.data) listener(state.data);
			},
			{ pollIntervalMs: 60_000 }
		);
	}
	setApiOnline(online: boolean): void {
		this.#api?.setOnline(online);
	}
	setApiFocused(binding: SessionBinding, focused: boolean): void {
		this.apiForSession(binding).setFocused(focused);
	}
	/** Confirm it's you for another capability of the same Session, as Account does. */
	async reauthenticate(binding: SessionBinding): Promise<'success' | AccountFailure> {
		const result = await this.account(binding, { kind: 'reauthenticate' });
		return result.kind === 'success'
			? 'success'
			: result.kind === 'error'
				? result.reason
				: 'unavailable';
	}
	cancelReauthentication(binding: SessionBinding): void {
		void this.account(binding, { kind: 'cancelReauthentication' });
	}
	private async accountUncached(
		binding: SessionBinding,
		raw: AccountIntent,
		signal?: AbortSignal,
		captureFailure?: (failure: ServerApiError) => void
	): Promise<AccountResponse> {
		const intent = validateAccountIntent(raw);
		const session = this.#session;
		const generation = this.#generation;
		if (
			!session ||
			this.#disposed ||
			session.tokens.principalId !== binding.principalId ||
			session.tokens.sessionId !== binding.sessionId
		)
			return { kind: 'error', reason: 'sessionEnded' };
		const current = () => {
			if (this.#disposed || this.#session !== session || this.#generation !== generation)
				throw new DesktopAuthorizationError('cancelled');
		};
		// Stopping a confirmation is never blocked by the confirmation it stops.
		if (intent.kind === 'cancelReauthentication') {
			this.#reauthentication?.cancel();
			return { kind: 'success' };
		}
		const mutation =
			intent.kind === 'revokeSession' ||
			intent.kind === 'revokeOtherSessions' ||
			intent.kind === 'revokeDesktop' ||
			intent.kind === 'uploadPhoto' ||
			intent.kind === 'removePhoto' ||
			intent.kind === 'createToken' ||
			intent.kind === 'disableToken' ||
			intent.kind === 'enableToken' ||
			intent.kind === 'revokeToken' ||
			intent.kind === 'requestEmailVerification' ||
			intent.kind === 'reauthenticate';
		if (mutation && this.#accountMutation) return { kind: 'error', reason: 'unavailable' };
		const operation = {};
		if (mutation) this.#accountMutation = operation;
		try {
			if (intent.kind === 'openSecurity') {
				await this.options.openBrowser(
					new URL('/account/security', session.identity.origin).href
				);
				current();
				return { kind: 'success' };
			}
			if (this.#refresh || session.tokens.accessExpiresAt <= Date.now() + 5000)
				await this.refresh();
			current();
			const request = async (
				path: DesktopHttpPath,
				body?: unknown,
				photo?: DesktopPhotoRequest
			): Promise<DesktopHttpResult> => {
				const result = await this.protectedRequest(
					session,
					generation,
					path,
					body,
					photo,
					undefined,
					signal
				);
				if (result.failure) captureFailure?.(result.failure);
				return result;
			};
			const failed = async (result: DesktopHttpResult): Promise<AccountResponse> => {
				const code = errorCode(result);
				if (result.status === 409) return { kind: 'error', reason: 'conflict' };
				if (result.status === 400) return { kind: 'error', reason: 'invalid' };
				if (result.status === 401) {
					await this.signOut();
					return { kind: 'error', reason: 'sessionEnded' };
				}
				if (code === 'authentication.reauthentication_required')
					return { kind: 'error', reason: 'reauthenticationRequired' };
				if (code === 'authentication.desktop_reauthentication.denied')
					return { kind: 'error', reason: 'denied' };
				if (code === 'authentication.desktop_reauthentication.invalid')
					return { kind: 'error', reason: 'invalid' };
				if (code === 'authentication.strong_required')
					return { kind: 'error', reason: 'strongAuthenticationRequired' };
				return {
					kind: 'error',
					reason:
						result.status === 403
							? 'denied'
							: result.status === 404
								? 'notFound'
								: mutation && result.status >= 500
									? 'unconfirmed'
									: 'unavailable'
				};
			};
			if (
				intent.kind === 'readPhoto' ||
				intent.kind === 'uploadPhoto' ||
				intent.kind === 'removePhoto'
			) {
				const photo: DesktopPhotoRequest =
					intent.kind === 'readPhoto'
						? { operation: 'GET' }
						: intent.kind === 'removePhoto'
							? { operation: 'DELETE', etag: intent.etag }
							: {
									operation: 'PUT',
									etag: intent.etag,
									bytes: intent.bytes,
									mediaType: intent.mediaType
								};
				const result = await request(
					`/api/v1/users/${binding.principalId}/profile-picture`,
					undefined,
					photo
				);
				if (result.status !== 200) return failed(result);
				return intent.kind === 'readPhoto'
					? validateAccountResponse(result.value)
					: { kind: 'success' };
			}
			if (intent.kind === 'revokeSession') {
				if (intent.id === binding.sessionId) {
					await this.signOut();
					return { kind: 'success' };
				}
				const response = await request('/api/v1/users/me/sessions/revoke', {
					session_id: intent.id
				});
				return response.status === 204 ? { kind: 'success' } : failed(response);
			}
			if (intent.kind === 'revokeOtherSessions') {
				const response = await request('/api/v1/users/me/sessions/revoke-others');
				return response.status === 200
					? readRevokedSessionCount(response.value)
					: failed(response);
			}
			if (intent.kind === 'reauthenticate')
				return await this.#reauthenticate(session, request, failed, current);
			if (intent.kind === 'readHistory') {
				const response = await request(accountHistoryPath(intent));
				return response.status === 200
					? { kind: 'data', data: readAccountHistory(response.value) }
					: failed(response);
			}
			if (intent.kind === 'revokeDesktop') {
				const response = await request(
					`/api/v1/users/me/desktop-registrations/${intent.id}`
				);
				if (response.status !== 204) return failed(response);
				if (intent.id === session.tokens.registrationId)
					await (this.#signingOut ??= this.#signOutCurrent(true).finally(() => {
						this.#signingOut = undefined;
					}));
				return { kind: 'success' };
			}
			if (intent.kind === 'createToken') {
				const response = await request('/api/v1/users/me/tokens', {
					description: intent.description,
					scopes: intent.scopes,
					...(intent.academicUnitId === undefined
						? {}
						: { academic_unit_id: intent.academicUnitId }),
					expires_at: new Date(intent.expiresAt).toISOString()
				});
				if (response.status !== 201) return failed(response);
				// The one-time credential is returned to the caller only; it is never cached.
				return readAccountTokenCreation(response.value, binding);
			}
			if (intent.kind === 'disableToken' || intent.kind === 'enableToken') {
				const response = await request(
					`/api/v1/users/me/tokens/${intent.id}/${intent.kind === 'disableToken' ? 'disable' : 'enable'}`
				);
				if (response.status !== 200) return failed(response);
				readAccountToken(response.value, binding, intent.id);
				return { kind: 'success' };
			}
			if (intent.kind === 'revokeToken') {
				const response = await request(`/api/v1/users/me/tokens/${intent.id}`);
				return response.status === 204 ? { kind: 'success' } : failed(response);
			}
			if (intent.kind === 'requestEmailVerification') {
				const response = await request('/api/v1/auth/email-verification/request');
				return response.status === 202 ? { kind: 'success' } : failed(response);
			}
			const paths = {
				profile: '/api/v1/users/me',
				security: '/api/v1/authentication-methods',
				sessions: '/api/v1/users/me/sessions',
				desktops: '/api/v1/users/me/desktop-registrations',
				tokens: '/api/v1/users/me/tokens',
				grantableScopes: '/api/v1/users/me/tokens/grantable-scopes',
				notices: '/api/v1/users/me/retention-notices?limit=200'
			} as const;
			const response = await request(paths[intent.section]);
			if (response.status !== 200) return failed(response);
			if (intent.section === 'tokens')
				return { kind: 'data', data: readAccountTokens(response.value, binding) };
			if (intent.section === 'grantableScopes')
				return { kind: 'data', data: readAccountGrantableScopes(response.value) };
			if (intent.section === 'notices')
				return { kind: 'data', data: readAccountNotices(response.value) };
			if (intent.section === 'profile')
				return { kind: 'data', data: readAccountProfile(response.value, binding) };
			if (intent.section === 'sessions')
				return { kind: 'data', data: readAccountSessions(response.value, binding) };
			if (intent.section === 'desktops')
				return {
					kind: 'data',
					data: readAccountDesktops(response.value, session.tokens.registrationId)
				};
			const mfa = await request('/api/v1/users/me/mfa');
			if (mfa.status === 401) return failed(mfa);
			return {
				kind: 'data',
				data: readAccountSecurity(
					response.value,
					mfa.status === 200 ? mfa.value : undefined
				)
			};
		} catch (error) {
			if (error instanceof ServerApiError) captureFailure?.(error);
			return {
				kind: 'error',
				reason:
					this.#session !== session || this.#generation !== generation
						? 'sessionEnded'
						: mutation
							? 'unconfirmed'
							: 'unavailable'
			};
		} finally {
			if (this.#accountMutation === operation) this.#accountMutation = undefined;
		}
	}

	/** Full typed client is available only to privileged, session-bound capability owners. */
	apiForSession(binding: SessionBinding): ServerApiClient {
		const session = this.#session;
		if (
			!session ||
			!this.#api ||
			this.#disposed ||
			session.tokens.principalId !== binding.principalId ||
			session.tokens.sessionId !== binding.sessionId
		)
			throw new ServerApiError('sessionEnded');
		return this.#api;
	}
	private async executeApiRequest(
		session: CurrentSession,
		generation: number,
		request: PreparedApiRequest
	): Promise<HttpResponse> {
		const current = () => {
			if (this.#disposed || this.#session !== session || this.#generation !== generation)
				throw new ServerApiError('sessionEnded');
			if (request.signal?.aborted) throw new ServerApiError('cancelled');
		};
		current();
		if (request.operation['x-proctor-auth'] === 'public')
			return this.options.http.transport.send(request);
		if (request.operation['x-proctor-auth'] === 'refresh_credential_required')
			throw new ServerApiError('invalidRequest');
		if (this.#refresh || session.tokens.accessExpiresAt <= Date.now() + 5000)
			await this.refresh();
		const send = async () => {
			current();
			const accessToken = session.tokens.accessToken;
			const proof = await createDPoPProof(
				session.key,
				request.method,
				request.url,
				session.tokens.nonce,
				accessToken
			);
			current();
			const result = await this.options.http.transport.send({
				...request,
				headers: { ...request.headers, DPoP: proof, Authorization: `DPoP ${accessToken}` }
			});
			current();
			const nonce = result.headers['dpop-nonce'];
			if (nonce) {
				if (!/^[A-Za-z0-9_-]{43}$/u.test(nonce))
					throw new ServerApiError('invalidResponse');
				session.tokens = { ...session.tokens, nonce };
			}
			return result;
		};
		const code = (result: HttpResponse): string | undefined => {
			if (result.status < 400) return undefined;
			try {
				const value = decodeJson(result);
				return value &&
					typeof value === 'object' &&
					'code' in value &&
					typeof value.code === 'string'
					? value.code
					: undefined;
			} catch {
				return undefined;
			}
		};
		let result = await send();
		if (code(result) === 'authentication.dpop.use_nonce' && result.headers['dpop-nonce'])
			result = await send();
		if (result.status === 401 && code(result) === 'authentication.invalid_token') {
			await this.refresh();
			current();
			result = await send();
			if (code(result) === 'authentication.dpop.use_nonce' && result.headers['dpop-nonce'])
				result = await send();
		}
		return result;
	}
	/**
	 * Confirms it is the person on the institution's own page in the system browser, as Desktop
	 * Authorization does: an exact loopback callback, state and a PKCE S256 challenge. Success
	 * refreshes the existing session's recent sign-in; no session is issued and nothing rotates.
	 */
	async #reauthenticate(
		session: CurrentSession,
		request: (path: DesktopHttpPath, body?: unknown) => Promise<DesktopHttpResult>,
		failed: (result: DesktopHttpResult) => Promise<AccountResponse>,
		current: () => void
	): Promise<AccountResponse> {
		this.#reauthentication?.cancel();
		const source = new CancellationTokenSource(this.#operations.token);
		this.#reauthentication = source;
		const state = randomBytes(32).toString('base64url');
		const verifier = randomBytes(32).toString('base64url');
		let listener: LoopbackAuthServer | undefined;
		try {
			listener = await LoopbackAuthServer.start(
				state,
				this.options.confirmationPages,
				source.token
			);
			const started = await request('/api/v1/auth/desktop/reauthentications', {
				callback_url: listener.callbackURL,
				state,
				code_challenge: createHash('sha256').update(verifier).digest('base64url')
			});
			if (started.status !== 201) return await failed(started);
			const value = record(started.value);
			const page = new URL(boundedText(value.authorization_url, 4096));
			// Only the institution's own page may be opened.
			if (page.origin !== session.identity.origin || page.username || page.password)
				return { kind: 'error', reason: 'invalid' };
			listener.expireAt(expiry(value.expires_at));
			current();
			await this.options.openBrowser(page.href);
			const code = await listener.waitForCode();
			current();
			const completed = await request('/api/v1/auth/desktop/reauthentications/complete', {
				code,
				code_verifier: verifier,
				state
			});
			return completed.status === 200 ? { kind: 'success' } : await failed(completed);
		} catch (error) {
			if (error instanceof DesktopAuthorizationError) {
				if (error.reason === 'cancelled') return { kind: 'error', reason: 'cancelled' };
				if (error.reason === 'timedOut') return { kind: 'error', reason: 'expired' };
				if (error.reason === 'callbackInvalid') return { kind: 'error', reason: 'invalid' };
			}
			return { kind: 'error', reason: 'unavailable' };
		} finally {
			await listener?.stop().catch(() => undefined);
			if (this.#reauthentication === source) this.#reauthentication = undefined;
			source.dispose();
		}
	}

	private async protectedRequest(
		session: CurrentSession,
		generation: number,
		path: DesktopHttpPath,
		body?: unknown,
		photo?: DesktopPhotoRequest,
		settings?: DesktopSettingsRequest,
		signal?: AbortSignal
	): Promise<DesktopHttpResult> {
		if (this.#generation !== generation || this.#session !== session)
			throw new ServerApiError('sessionEnded');
		const headers = {
			...(photo?.etag ? { 'If-Match': photo.etag } : {}),
			...(settings?.idempotencyKey ? { 'Idempotency-Key': settings.idempotencyKey } : {})
		};
		const { id, input } = resolveApiRoute(
			session.identity.origin,
			path,
			desktopHttpMethod(path, photo, settings, body !== undefined),
			photo?.bytes ?? body,
			headers,
			photo?.mediaType
		);
		try {
			const result = await this.apiForSession({
				principalId: session.tokens.principalId,
				sessionId: session.tokens.sessionId
			}).request(id, input, { signal });
			if (photo?.operation === 'GET' && result.status === 200) {
				if (!(result.value instanceof Uint8Array))
					throw new ServerApiError('invalidResponse');
				const bytes = Buffer.from(result.value);
				if (
					bytes.toString('ascii', 0, 4) !== 'RIFF' ||
					bytes.toString('ascii', 8, 12) !== 'WEBP'
				)
					throw new ServerApiError('invalidResponse');
				return {
					status: 200,
					value: {
						kind: 'photo',
						dataUrl: `data:image/webp;base64,${bytes.toString('base64')}`,
						etag: result.headers.etag
					}
				};
			}
			return { status: Number(result.status), value: result.value };
		} catch (error) {
			if (error instanceof ServerApiError && error.kind === 'server')
				return { status: error.status!, value: error.problem, failure: error };
			throw error;
		}
	}
	async examActivity(
		binding: SessionBinding,
		raw: ExamActivityIntent
	): Promise<ExamActivityResponse> {
		const intent = validateExamActivityIntent(raw);
		try {
			return await this.apiForSession(binding).fetchTask(
				['examActivity', intent],
				(signal) =>
					projectRead((capture) =>
						this.examActivityUncached(binding, intent, signal, capture)
					),
				{ staleTime: intent.kind === 'context' ? 0 : 30_000 }
			);
		} catch (error) {
			return error instanceof ProjectionFailure
				? (error.response as ExamActivityResponse)
				: {
						kind: 'error',
						reason:
							error instanceof ServerApiError && error.kind === 'sessionEnded'
								? 'sessionEnded'
								: 'unavailable'
					};
		}
	}
	observeExamActivity(
		binding: SessionBinding,
		raw: ExamActivityIntent,
		listener: (response: ExamActivityResponse) => void
	): ApiObservation {
		const intent = validateExamActivityIntent(raw);
		return this.apiForSession(binding).observeTask(
			['examActivity', intent],
			(signal) =>
				projectRead((capture) =>
					this.examActivityUncached(binding, intent, signal, capture)
				),
			(state) => {
				if (state.error)
					listener(
						state.error instanceof ProjectionFailure
							? (state.error.response as ExamActivityResponse)
							: { kind: 'error', reason: 'unavailable' }
					);
				else if (state.data) listener(state.data);
			},
			{ staleTime: intent.kind === 'context' ? 0 : 30_000, pollIntervalMs: 30_000 }
		);
	}
	/** Read-only product capability bound to the same authenticated session as account/settings. */
	private async examActivityUncached(
		binding: SessionBinding,
		raw: ExamActivityIntent,
		signal?: AbortSignal,
		captureFailure?: (failure: ServerApiError) => void
	): Promise<ExamActivityResponse> {
		const intent = validateExamActivityIntent(raw);
		const session = this.#session,
			generation = this.#generation;
		const current = () =>
			!this.#disposed && this.#session === session && this.#generation === generation;
		if (
			!session ||
			!current() ||
			session.tokens.principalId !== binding.principalId ||
			session.tokens.sessionId !== binding.sessionId
		)
			return { kind: 'error', reason: 'sessionEnded' };
		const path: DesktopHttpPath =
			intent.kind === 'context'
				? '/api/v1/users/me/context'
				: intent.kind === 'result'
					? `/api/v1/exam-attempts/${intent.attemptId}/result`
					: `/api/v1/users/me/exam-activity?limit=20${intent.cursor ? `&cursor=${encodeURIComponent(intent.cursor)}` : ''}`;
		try {
			const result = await this.protectedRequest(
				session,
				generation,
				path,
				undefined,
				undefined,
				undefined,
				signal
			);
			if (result.failure) captureFailure?.(result.failure);
			if (result.status === 401) {
				await this.signOut();
				return { kind: 'error', reason: 'sessionEnded' };
			}
			if (result.status === 403) return { kind: 'error', reason: 'restricted' };
			if (result.status === 404 && intent.kind === 'result')
				return { kind: 'error', reason: 'notFound' };
			if (result.status === 400 && intent.kind === 'activity' && intent.cursor)
				return { kind: 'error', reason: 'invalidCursor' };
			if (result.status !== 200) return { kind: 'error', reason: 'unavailable' };
			return readExamActivityWire(
				intent,
				result.value,
				session.tokens.principalId,
				session.tokens.registrationId
			);
		} catch (error) {
			if (error instanceof ServerApiError) captureFailure?.(error);
			return { kind: 'error', reason: current() ? 'unavailable' : 'sessionEnded' };
		}
	}
	async readSettings(
		binding: SessionBinding
	): ReturnType<UserSettingsSessionService['readSettings']> {
		const session = this.#session,
			generation = this.#generation;
		if (
			!session ||
			this.#disposed ||
			session.tokens.principalId !== binding.principalId ||
			session.tokens.sessionId !== binding.sessionId
		)
			return undefined;
		try {
			const result = await this.protectedRequest(
				session,
				generation,
				'/api/v1/users/me/settings',
				undefined,
				undefined,
				{ operation: 'GET' }
			);
			if (result.status === 401) {
				await this.signOut();
				return undefined;
			}
			return result.status === 200 ? readUserSettingsWire(result.value) : undefined;
		} catch {
			return undefined;
		}
	}
	async commitSettings(
		binding: SessionBinding,
		raw: SettingsCommitRequest
	): Promise<SettingsCommitResult> {
		const request = validateUserSettingsCommitIntent(raw);
		const session = this.#session,
			generation = this.#generation;
		if (
			!session ||
			this.#disposed ||
			session.tokens.principalId !== binding.principalId ||
			session.tokens.sessionId !== binding.sessionId
		)
			return { kind: 'unavailable' };
		try {
			const result = await this.protectedRequest(
				session,
				generation,
				'/api/v1/users/me/settings',
				{
					source: request.source,
					format_version: 1,
					expected_revision: request.expectedRevision
				},
				undefined,
				{
					operation: 'PUT',
					idempotencyKey: createHash('sha256')
						.update(request.idempotencyKey)
						.digest('hex')
				}
			);
			if (result.status === 200)
				return { kind: 'success', revision: readUserSettingsRevision(result.value) };
			if (result.status === 401) {
				await this.signOut();
				return { kind: 'unavailable' };
			}
			if (result.status === 409 && errorCode(result) === 'user_settings.revision_conflict') {
				const latest = await this.readSettings(binding);
				return latest
					? { kind: 'conflict', latest: latest.acknowledged }
					: { kind: 'unavailable' };
			}
			return {
				kind:
					result.status >= 500 || errorCode(result) === 'idempotency.in_progress'
						? 'ambiguous'
						: 'unavailable'
			};
		} catch {
			return {
				kind:
					this.#session === session && this.#generation === generation
						? 'ambiguous'
						: 'unavailable'
			};
		}
	}

	#scheduleRefresh(): void {
		clearTimeout(this.#refreshTimer);
		if (!this.#session) return;
		this.#refreshTimer = setTimeout(
			() => {
				void this.refresh().catch(() => undefined);
			},
			Math.max(
				1000,
				Math.min(2147483647, this.#session.tokens.accessExpiresAt - Date.now() - 30000)
			)
		);
	}
	refresh(): Promise<void> {
		return (this.#refresh ??= this.#refreshCurrent().finally(() => {
			this.#refresh = undefined;
		}));
	}
	async #refreshCurrent(): Promise<void> {
		const session = this.#session;
		const generation = this.#generation;
		if (!session || this.#disposed) throw new DesktopAuthorizationError('rejected');
		try {
			const tokens = await this.#rotate(
				session.scope,
				session.key,
				session.stored,
				this.#operations.token,
				session.tokens.nonce
			);
			if (this.#session !== session || generation !== this.#generation)
				throw new DesktopAuthorizationError('cancelled');
			session.tokens = tokens;
			session.stored = {
				...session.stored,
				refreshToken: tokens.refreshToken,
				refreshExpiresAt: tokens.refreshExpiresAt
			};
			this.#scheduleRefresh();
		} catch (error) {
			if (this.#session === session) {
				this.#drop();
				this.#ended.fire({
					sequence: ++this.#outcomeSequence,
					origin: session.identity.origin,
					institutionName: session.identity.institutionName,
					authentication: 'signedOut',
					sessionValidity: 'verificationRequired',
					credentialReadiness:
						error instanceof DesktopAuthorizationError &&
						error.reason === 'storageUnavailable'
							? 'unavailable'
							: 'locked',
					reason: 'refreshFailed',
					localCleanup: 'notRequested',
					remoteRevocation: 'notRequested'
				});
			}
			throw error;
		}
	}
	#drop(): void {
		this.#generation++;
		this.#session = undefined;
		this.#api?.dispose();
		this.#api = undefined;
		clearTimeout(this.#refreshTimer);
		this.#operations.dispose(true);
		this.#operations = new CancellationTokenSource();
	}
	signOut(): Promise<void> {
		return (this.#signingOut ??= this.#signOutCurrent().finally(() => {
			this.#signingOut = undefined;
		}));
	}
	async #signOutCurrent(revocationConfirmed = false): Promise<void> {
		const session = this.#session;
		if (!session) return;
		this.#drop();
		const pending: DesktopSessionOutcome = {
			sequence: ++this.#outcomeSequence,
			origin: session.identity.origin,
			institutionName: session.identity.institutionName,
			authentication: 'ending',
			sessionValidity: 'verificationRequired',
			credentialReadiness: 'locked',
			reason: 'signOut',
			localCleanup: 'pending',
			remoteRevocation: 'pending'
		};
		this.#ended.fire(pending);
		// Join cancelled rotation before cleanup; a late write must not restore the Session.
		await this.#refresh?.catch(() => undefined);
		const [local, remote] = await Promise.allSettled([
			this.#forget(session),
			revocationConfirmed ? Promise.resolve() : this.#revoke(session)
		]);
		this.#ended.fire({
			...pending,
			authentication: 'signedOut',
			sessionValidity: remote.status === 'fulfilled' ? 'revoked' : 'verificationRequired',
			credentialReadiness: local.status === 'fulfilled' ? 'locked' : 'unavailable',
			localCleanup: local.status === 'fulfilled' ? 'cleared' : 'failed',
			remoteRevocation: remote.status === 'fulfilled' ? 'confirmed' : 'unconfirmed'
		});
	}

	async #forget(session: CurrentSession): Promise<void> {
		// If deletion is interrupted, a surviving barrier requires fresh verification.
		await this.options.credentials
			.write(session.scope, { ...session.stored, phase: 'rotationPending' })
			.catch(() => undefined);
		// Successful deletion confirms cleanup even when writing the barrier failed.
		await this.options.credentials.delete(session.scope);
	}

	async #revoke(session: CurrentSession): Promise<void> {
		let response = await this.#requestProof(
			session.identity.origin,
			'/api/v1/auth/logout',
			session.key,
			session.tokens.accessToken,
			session.tokens.nonce,
			CancellationToken.None
		);
		if (errorCode(response) === 'authentication.dpop.use_nonce' && response.nonce)
			response = await this.#requestProof(
				session.identity.origin,
				'/api/v1/auth/logout',
				session.key,
				session.tokens.accessToken,
				response.nonce,
				CancellationToken.None
			);
		if (response.status !== 204) throw new DesktopAuthorizationError('unavailable');
	}
	/** Ordinary shutdown joins sign-out before releasing custody or destroying outcome listeners. */
	shutdown(): Promise<void> {
		return (this.#shutdown ??= this.#shutdownCurrent());
	}
	async #shutdownCurrent(): Promise<void> {
		this.#drop();
		await this.#signingOut;
		this.dispose();
	}
	override dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#drop();
		this.#operations.dispose();
		super.dispose();
	}
}
function thumbprint(key: DesktopSigningKey): string {
	const { crv, kty, x, y } = key.publicJwk;
	return createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url');
}
