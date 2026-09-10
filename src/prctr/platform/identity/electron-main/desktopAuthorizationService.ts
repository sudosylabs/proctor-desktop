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
	type AccountBinding,
	type AccountIntent,
	type AccountResponse
} from '../../account/common/accountProtocol.js';
import {
	readAccountProfile,
	readAccountSecurity,
	readAccountSessions,
	readAccountDesktops
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
	readonly keys: DesktopKeyCustody;
	readonly credentials: DesktopCredentialStore;
	readonly http: DesktopAuthHttp;
	readonly openBrowser: (url: string) => Promise<void>;
	readonly callbackPages: LoopbackCallbackPages;
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
		const scope = installationKeyScope(identity.origin, identity.institutionId);
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
						version: 1,
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
			await this.options.onAuthenticated(projection);
			current();
			this.#scheduleRefresh();
		} catch (error) {
			if (this.#session === session) this.#session = undefined;
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
			await this.options.openBrowser(authorizationURL.href);
			const code = await listener.waitForCode();
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
			return parseTokens(result);
		} finally {
			await listener.stop();
		}
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
			if (errorCode(result) === 'authentication.dpop.use_nonce' && result.nonce)
				result = await this.#requestProof(
					saved.origin,
					'/api/v1/auth/refresh',
					key,
					saved.refreshToken,
					result.nonce,
					token,
					false
				);
			const next = parseTokens(result);
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
	async account(binding: AccountBinding, raw: AccountIntent): Promise<AccountResponse> {
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
		const mutation =
			intent.kind === 'revokeSession' ||
			intent.kind === 'revokeDesktop' ||
			intent.kind === 'uploadPhoto' ||
			intent.kind === 'removePhoto';
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
			const request = (
				path: DesktopHttpPath,
				body?: unknown,
				photo?: DesktopPhotoRequest
			): Promise<DesktopHttpResult> =>
				this.protectedRequest(session, generation, path, body, photo);
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
			const paths = {
				profile: '/api/v1/users/me',
				security: '/api/v1/authentication-methods',
				sessions: '/api/v1/users/me/sessions',
				desktops: '/api/v1/users/me/desktop-registrations'
			} as const;
			const response = await request(paths[intent.section]);
			if (response.status !== 200) return failed(response);
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
		} catch {
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

	private async protectedRequest(
		session: CurrentSession,
		generation: number,
		path: DesktopHttpPath,
		body?: unknown,
		photo?: DesktopPhotoRequest,
		settings?: DesktopSettingsRequest
	): Promise<DesktopHttpResult> {
		const current = () => {
			if (this.#disposed || this.#session !== session || this.#generation !== generation)
				throw new DesktopAuthorizationError('cancelled');
		};
		current();
		if (this.#refresh || session.tokens.accessExpiresAt <= Date.now() + 5000)
			await this.refresh();
		current();
		const send = async (): Promise<DesktopHttpResult> => {
			current();
			const accessToken = session.tokens.accessToken;
			const proof = await createDPoPProof(
				session.key,
				desktopHttpMethod(path, photo, settings),
				`${session.identity.origin}${path}`,
				session.tokens.nonce,
				accessToken
			);
			current();
			const result = await this.options.http.request(
				session.identity.origin,
				path,
				this.#operations.token,
				{
					proof,
					credential: accessToken,
					...(body === undefined ? {} : { body }),
					...(photo ? { photo } : {}),
					...(settings ? { settings } : {})
				}
			);
			current();
			if (result.nonce) session.tokens = { ...session.tokens, nonce: result.nonce };
			return result;
		};
		let result = await send();
		if (errorCode(result) === 'authentication.dpop.use_nonce' && result.nonce)
			result = await send();
		if (result.status === 401 && errorCode(result) === 'authentication.invalid_token') {
			await this.refresh();
			current();
			result = await send();
			if (errorCode(result) === 'authentication.dpop.use_nonce' && result.nonce)
				result = await send();
		}
		return result;
	}
	async readSettings(
		binding: AccountBinding
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
		binding: AccountBinding,
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
