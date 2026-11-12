import { SessionApi } from '../../serverApi/node/sessionApi.js';
import {
	ServerApiError,
	type ApiInput,
	type ApiOperationId
} from '../../serverApi/common/serverApi.js';
import type { SessionBinding } from '../../serverApi/common/projection.js';
import type { ServerHttpTransport } from '../../serverApi/node/serverHttpTransport.js';
import { decodeResponse } from '../../serverApi/node/responseDecoding.js';
import { encodeRequest, type ApiRequestInput } from '../../serverApi/node/requestEncoding.js';
import { problemCode, sendWithDPoP, type DPoPBinding } from '../node/dpopExchange.js';
import { SessionRequestSigner } from './sessionRequestSigner.js';
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
import type { AccountFailure } from '../../account/common/accountProtocol.js';
import { accountFailure } from '../../account/electron-main/accountService.js';
import {
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
	type DesktopExchangeResult,
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
	/** The single HTTP boundary every authentication and Session request goes through. */
	readonly transport: ServerHttpTransport;
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
	/** A confirmation waiting for the system browser; the renderer may stop it. */
	#reauthentication: CancellationTokenSource | undefined;
	/** The sign-in page a browser is completing, kept so it can be opened again until it expires. */
	#pendingSignInPage: { readonly url: string; readonly expiresAt: number } | undefined;
	#api: SessionApi | undefined;
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
			const refreshing = () => this.#refresh !== undefined;
			const signer = new SessionRequestSigner(this.options.transport, {
				credentials: () =>
					this.#session === activeSession &&
					this.#generation === generation &&
					!this.#disposed
						? {
								key: activeSession.key,
								accessToken: activeSession.tokens.accessToken,
								accessExpiresAt: activeSession.tokens.accessExpiresAt,
								nonce: activeSession.tokens.nonce
							}
						: undefined,
				recordNonce: (nonce) => {
					activeSession.tokens = { ...activeSession.tokens, nonce };
				},
				refresh: () => this.refresh(),
				get refreshing() {
					return refreshing();
				},
				endSession: () => {
					if (this.#session === activeSession) void this.signOut();
				}
			});
			this.#api = new SessionApi({
				binding: {
					principalId: session.tokens.principalId,
					sessionId: session.tokens.sessionId
				},
				origin: identity.origin,
				execute: (request) => signer.execute(request),
				authorizeUpgrade: (url, challenge) => signer.authorizeUpgrade(url, challenge)
			});
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
			const started = await this.#exchange(
				identity.origin,
				'startDesktopAuthorization',
				{
					body: {
						...target,
						state,
						code_challenge: createHash('sha256').update(verifier).digest('base64url'),
						callback_url: listener.callbackURL,
						public_jwk: key.publicJwk,
						device_name: 'Proctor Desktop'
					}
				} as ApiInput<'startDesktopAuthorization'>,
				undefined,
				undefined,
				token
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
			// A nonce challenge is answered before the code is consumed, so it is retried once.
			const result = await this.#exchange(
				identity.origin,
				'exchangeDesktopAuthorizationCode',
				{
					body: {
						...target,
						code,
						state,
						code_verifier: verifier,
						public_jwk: key.publicJwk
					}
				} as ApiInput<'exchangeDesktopAuthorizationCode'>,
				{ key },
				nonce,
				token
			);
			nonce = result.nonce ?? nonce;
			try {
				return parseTokens(result, nonce);
			} catch (error) {
				// The institution requires two-step verification first; its own page sets it up.
				if (
					error instanceof DesktopAuthorizationError &&
					error.reason === 'twoStepSetupRequired'
				)
					await this.options
						.openBrowser(new URL('/account/security', identity.origin).href)
						.catch(() => undefined);
				throw error;
			}
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
			const result = await this.#exchange(
				saved.origin,
				'refreshSession',
				{},
				{ key, credential: saved.refreshToken },
				nonce,
				token
			);
			nonce = result.nonce ?? nonce;
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
	/**
	 * One authentication operation: encoded from the packaged contract, signed when `binding` is
	 * given, its success body decoded and validated, its failure reduced to the server's code.
	 */
	async #exchange<K extends ApiOperationId>(
		origin: string,
		id: K,
		input: ApiInput<K>,
		binding: DPoPBinding | undefined,
		nonce: string | undefined,
		token: CancellationToken
	): Promise<DesktopExchangeResult> {
		const controller = new AbortController();
		const cancellation = token.onCancellationRequested(() => controller.abort());
		if (token.isCancellationRequested) controller.abort();
		try {
			const request = encodeRequest(origin, id, input as ApiRequestInput);
			const exchange = await sendWithDPoP(
				this.options.transport,
				{ ...request, signal: controller.signal },
				binding,
				nonce
			);
			const response = exchange.response;
			const value =
				response.status < 400
					? decodeResponse(request.operation, response).value
					: { code: problemCode(response) };
			return {
				status: response.status,
				value,
				...(exchange.nonce === undefined ? {} : { nonce: exchange.nonce })
			};
		} catch (error) {
			if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
			if (error instanceof DesktopAuthorizationError) throw error;
			if (
				error instanceof ServerApiError &&
				['invalidRequest', 'invalidResponse', 'redirectBlocked'].includes(error.kind)
			)
				throw new DesktopAuthorizationError('rejected');
			throw new DesktopAuthorizationError('verificationRequired');
		} finally {
			cancellation.dispose();
		}
	}
	async #context(
		session: CurrentSession,
		token: CancellationToken
	): Promise<AuthenticatedIdentity> {
		const response = await this.#exchange(
			session.identity.origin,
			'getCurrentUserContext',
			{},
			{ key: session.key, credential: session.tokens.accessToken, accessToken: true },
			session.tokens.nonce,
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

	setApiOnline(online: boolean): void {
		this.#api?.setOnline(online);
	}
	setApiFocused(binding: SessionBinding, focused: boolean): void {
		this.apiForSession(binding).setFocused(focused);
	}
	/** The Institution the bound Session belongs to. */
	institutionId(binding: SessionBinding): string {
		this.apiForSession(binding);
		return this.#session!.identity.institutionId;
	}
	/** The Desktop registration the bound Session signed in with. */
	currentRegistration(binding: SessionBinding): string {
		this.apiForSession(binding);
		return this.#session!.tokens.registrationId;
	}
	/** Ends this Session after the server confirmed its own Desktop registration is revoked. */
	endRevokedDesktop(): Promise<void> {
		return (this.#signingOut ??= this.#signOutCurrent(true).finally(() => {
			this.#signingOut = undefined;
		}));
	}
	openBrowser(url: string): Promise<void> {
		return this.options.openBrowser(url);
	}
	cancelReauthentication(binding: SessionBinding): void {
		this.apiForSession(binding);
		this.#reauthentication?.cancel();
	}

	/** Full typed client is available only to privileged, session-bound capability owners. */
	apiForSession(binding: SessionBinding): SessionApi {
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
	/**
	 * Confirm it's you on the institution's own page in the system browser, as Desktop
	 * Authorization does: an exact loopback callback, state and a PKCE S256 challenge. Success
	 * refreshes the bound Session's recent sign-in; no Session is issued and nothing rotates.
	 * A new confirmation replaces one still waiting for the browser.
	 */
	async reauthenticate(binding: SessionBinding): Promise<'success' | AccountFailure> {
		let api: SessionApi;
		try {
			api = this.apiForSession(binding);
		} catch {
			return 'sessionEnded';
		}
		const session = this.#session!;
		const generation = this.#generation;
		const current = (): void => {
			if (this.#disposed || this.#session !== session || this.#generation !== generation)
				throw new DesktopAuthorizationError('cancelled');
		};
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
			const started = await api.request('startDesktopReauthentication', {
				body: {
					callback_url: listener.callbackURL,
					state,
					code_challenge: createHash('sha256').update(verifier).digest('base64url')
				}
			} as never);
			const value = record(started.value);
			const page = new URL(boundedText(value.authorization_url, 4096));
			// Only the institution's own page may be opened.
			if (page.origin !== session.identity.origin || page.username || page.password)
				return 'invalid';
			listener.expireAt(expiry(value.expires_at));
			current();
			await this.options.openBrowser(page.href);
			const code = await listener.waitForCode();
			current();
			await api.request('completeDesktopReauthentication', {
				body: { code, code_verifier: verifier, state }
			} as never);
			return 'success';
		} catch (error) {
			if (error instanceof DesktopAuthorizationError) {
				if (error.reason === 'cancelled')
					return this.#session === session ? 'cancelled' : 'sessionEnded';
				if (error.reason === 'timedOut') return 'expired';
				if (error.reason === 'callbackInvalid') return 'invalid';
			}
			if (
				error instanceof ServerApiError &&
				(error.kind === 'server' || error.kind === 'sessionEnded')
			)
				return accountFailure(error, true);
			return 'unavailable';
		} finally {
			await listener?.stop().catch(() => undefined);
			if (this.#reauthentication === source) this.#reauthentication = undefined;
			source.dispose();
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
		const response = await this.#exchange(
			session.identity.origin,
			'logout',
			{},
			{ key: session.key, credential: session.tokens.accessToken, accessToken: true },
			session.tokens.nonce,
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
