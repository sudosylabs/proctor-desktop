/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { combinedDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { ServerApiError } from '../../serverApi/common/serverApi.js';
import type { SessionBinding } from '../../serverApi/common/projection.js';
import type { SessionApi } from '../../serverApi/node/sessionApi.js';
import {
	validateAccountIntent,
	validateAccountResponse,
	type AccountFailure,
	type AccountIntent,
	type AccountResponse
} from '../common/accountProtocol.js';
import {
	accountHistoryQuery,
	readAccountDesktops,
	readAccountGrantableScopes,
	readAccountHistory,
	readAccountNotices,
	readAccountProfile,
	readAccountSecurity,
	readAccountSessions,
	readAccountToken,
	readAccountTokenCreation,
	readAccountTokens,
	readRevokedSessionCount
} from './accountWire.js';

type AccountRead = Extract<AccountIntent, { kind: 'read' | 'readPhoto' | 'readHistory' }>;
export type AccountApi = Pick<SessionApi, 'origin' | 'request' | 'reads' | 'events' | 'setFocused'>;

/** What the Session owner lends Account. Credentials and refresh never leave it. */
export interface AccountSessionPort {
	/** The typed client of the bound Session; throws `sessionEnded` once it is not current. */
	apiForSession(binding: SessionBinding): AccountApi;
	/** The Desktop registration the bound Session signed in with. */
	currentRegistration(binding: SessionBinding): string;
	signOut(): Promise<void>;
	/** Ends this Session locally after the server confirmed its Desktop registration is revoked. */
	endRevokedDesktop(): Promise<void>;
	/** Confirm it's you in the system browser; ends when the browser step completes or fails. */
	reauthenticate(binding: SessionBinding): Promise<'success' | AccountFailure>;
	cancelReauthentication(binding: SessionBinding): void;
	openBrowser(url: string): Promise<void>;
}

const sections = {
	profile: 'getCurrentUserProfile',
	security: 'listAuthenticationMethods',
	sessions: 'listCurrentUserSessions',
	desktops: 'listDesktopRegistrations',
	tokens: 'listPersonalAccessTokens',
	grantableScopes: 'listGrantablePersonalAccessTokenScopes',
	notices: 'listRetentionNotices'
} as const;
const MAX_NOTICES = 200;
const POLL_MS = 60_000;
/** Events are best-effort after commit, so a live read is still re-read now and then. */
const SAFETY_POLL_MS = 300_000;

/**
 * The privileged Account capability: each intent becomes one operation on the bound Session's
 * typed client, replies are whitelist projections, failures are closed reasons, and one change
 * runs at a time. Credentials, URLs and arbitrary requests never cross IPC.
 */
export class AccountService {
	#changing = false;
	constructor(private readonly session: AccountSessionPort) {}

	async account(binding: SessionBinding, raw: AccountIntent): Promise<AccountResponse> {
		const intent = validateAccountIntent(raw);
		if (!isRead(intent)) return this.#change(binding, intent);
		try {
			return await this.session
				.apiForSession(binding)
				.reads.read(['account', intent], (signal) => this.#read(binding, intent, signal));
		} catch (error) {
			return failure(error, false);
		}
	}

	observeAccount(
		binding: SessionBinding,
		raw: AccountIntent,
		listener: (response: AccountResponse) => void
	): IDisposable {
		const intent = validateAccountIntent(raw);
		if (intent.kind !== 'read' && intent.kind !== 'readPhoto')
			throw new ServerApiError('invalidRequest');
		const api = this.session.apiForSession(binding);
		const key = ['account', intent] as const;
		// The profile picture, Sessions and registered desktops change live; the rest is polled.
		// A Session renamed or ended and a desktop renamed or removed share one event, so both
		// sections refresh on it. The profile has no event for its other fields.
		const event =
			intent.kind === 'readPhoto' || (intent.kind === 'read' && intent.section === 'profile')
				? 'user_profile_picture_changed'
				: intent.kind === 'read' &&
					  (intent.section === 'sessions' || intent.section === 'desktops')
					? 'current_user.sessions.changed'
					: undefined;
		const observation = api.reads.observe(
			key,
			(signal) => this.#read(binding, intent, signal),
			(state) => {
				if (state.error) listener(failure(state.error, false));
				else if (state.value) listener(state.value);
			},
			{ pollIntervalMs: event ? SAFETY_POLL_MS : POLL_MS }
		);
		if (!event) return observation;
		const changes = api.events.on(event, undefined, () => api.reads.refresh(key));
		return combinedDisposable(observation, changes);
	}

	setApiFocused(binding: SessionBinding, focused: boolean): void {
		this.session.apiForSession(binding).setFocused(focused);
	}

	async #read(
		binding: SessionBinding,
		intent: AccountRead,
		signal: AbortSignal
	): Promise<AccountResponse> {
		const api = this.session.apiForSession(binding);
		if (intent.kind === 'readPhoto') {
			const result = await api.request(
				'getUserProfilePicture',
				{ path: { user_id: binding.principalId } },
				{ signal }
			);
			return readPhoto(result.value, result.headers.etag);
		}
		if (intent.kind === 'readHistory') {
			const { kind: _kind, ...query } = intent;
			const result = await api.request(
				'listCurrentUserAuditEvents',
				{ query: accountHistoryQuery(query) },
				{ signal }
			);
			return { kind: 'data', data: readAccountHistory(result.value) };
		}
		const section = intent.section;
		if (section === 'security') {
			const [methods, mfa] = await Promise.all([
				api.request('listAuthenticationMethods', {}, { signal }),
				api.request('getMFAStatus', {}, { signal }).catch((error: unknown) => {
					// Two-step status is optional to the page; only an ended Session is fatal.
					if (error instanceof ServerApiError && error.kind === 'sessionEnded')
						throw error;
					return undefined;
				})
			]);
			return { kind: 'data', data: readAccountSecurity(methods.value, mfa?.value) };
		}
		const result = await api.request(
			sections[section],
			section === 'notices' ? { query: { limit: MAX_NOTICES } } : {},
			{ signal }
		);
		const value = result.value;
		switch (section) {
			case 'profile':
				return { kind: 'data', data: readAccountProfile(value, binding) };
			case 'sessions':
				return { kind: 'data', data: readAccountSessions(value, binding) };
			case 'desktops':
				return {
					kind: 'data',
					data: readAccountDesktops(value, this.session.currentRegistration(binding))
				};
			case 'tokens':
				return { kind: 'data', data: readAccountTokens(value, binding) };
			case 'grantableScopes':
				return { kind: 'data', data: readAccountGrantableScopes(value) };
			case 'notices':
				return { kind: 'data', data: readAccountNotices(value) };
		}
	}

	async #change(
		binding: SessionBinding,
		intent: Exclude<AccountIntent, AccountRead>
	): Promise<AccountResponse> {
		// Stopping a confirmation is never blocked by the confirmation it stops.
		if (intent.kind === 'cancelReauthentication') {
			try {
				this.session.apiForSession(binding);
				this.session.cancelReauthentication(binding);
				return { kind: 'success' };
			} catch (error) {
				return failure(error, true);
			}
		}
		if (this.#changing) return { kind: 'error', reason: 'unavailable' };
		this.#changing = true;
		try {
			return await this.#apply(binding, intent);
		} catch (error) {
			return failure(error, true);
		} finally {
			this.#changing = false;
		}
	}

	async #apply(
		binding: SessionBinding,
		intent: Exclude<AccountIntent, AccountRead | { kind: 'cancelReauthentication' }>
	): Promise<AccountResponse> {
		const api = this.session.apiForSession(binding);
		switch (intent.kind) {
			case 'openSecurity':
				await this.session.openBrowser(new URL('/account/security', api.origin).href);
				return { kind: 'success' };
			case 'reauthenticate': {
				const outcome = await this.session.reauthenticate(binding);
				return outcome === 'success'
					? { kind: 'success' }
					: { kind: 'error', reason: outcome };
			}
			case 'uploadPhoto':
				await api.request('uploadUserProfilePicture', {
					path: { user_id: binding.principalId },
					header: { 'If-Match': intent.etag },
					mediaType: intent.mediaType,
					body: intent.bytes
				});
				return { kind: 'success' };
			case 'removePhoto':
				await api.request('removeUserProfilePicture', {
					path: { user_id: binding.principalId },
					header: { 'If-Match': intent.etag }
				});
				return { kind: 'success' };
			case 'revokeSession':
				if (intent.id === binding.sessionId) {
					await this.session.signOut();
					return { kind: 'success' };
				}
				await api.request('revokeCurrentUserSession', { body: { session_id: intent.id } });
				return { kind: 'success' };
			case 'revokeOtherSessions': {
				const result = await api.request('revokeOtherCurrentUserSessions', {});
				return readRevokedSessionCount(result.value);
			}
			case 'revokeDesktop':
				await api.request('revokeDesktopRegistration', {
					path: { desktop_registration_id: intent.id }
				});
				if (intent.id === this.session.currentRegistration(binding))
					await this.session.endRevokedDesktop();
				return { kind: 'success' };
			case 'renameSession':
				try {
					await api.request('renameCurrentUserSession', {
						path: { session_id: intent.id },
						body: { device_name: intent.name }
					});
				} catch (error) {
					const registration = namingRegistration(error);
					if (registration === undefined) throw error;
					return validateAccountResponse({
						kind: 'namedByDesktop',
						desktopRegistrationId: registration
					});
				}
				return { kind: 'success' };
			case 'renameDesktop':
				await api.request('renameDesktopRegistration', {
					path: { desktop_registration_id: intent.id },
					body: { display_name: intent.name }
				});
				return { kind: 'success' };
			case 'createToken': {
				const result = await api.request('createPersonalAccessToken', {
					body: {
						description: intent.description,
						scopes: [...intent.scopes],
						...(intent.academicUnitId === undefined
							? {}
							: { academic_unit_id: intent.academicUnitId }),
						expires_at: new Date(intent.expiresAt).toISOString()
					}
				} as never);
				// The one-time credential is returned to the caller only; it is never cached.
				return readAccountTokenCreation(result.value, binding);
			}
			case 'disableToken':
			case 'enableToken': {
				const result = await api.request(
					intent.kind === 'disableToken'
						? 'disablePersonalAccessToken'
						: 'enablePersonalAccessToken',
					{ path: { personal_access_token_id: intent.id } }
				);
				readAccountToken(result.value, binding, intent.id);
				return { kind: 'success' };
			}
			case 'revokeToken':
				await api.request('revokePersonalAccessToken', {
					path: { personal_access_token_id: intent.id }
				});
				return { kind: 'success' };
			case 'requestEmailVerification':
				await api.request('requestEmailVerification', {});
				return { kind: 'success' };
		}
	}
}

function isRead(intent: AccountIntent): intent is AccountRead {
	return intent.kind === 'read' || intent.kind === 'readPhoto' || intent.kind === 'readHistory';
}

/** Reads the picture as WebP bytes; anything else is refused rather than displayed. */
function readPhoto(value: unknown, etag: string | undefined): AccountResponse {
	if (!(value instanceof Uint8Array)) throw new ServerApiError('invalidResponse');
	const bytes = Buffer.from(value);
	if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')
		throw new ServerApiError('invalidResponse');
	return validateAccountResponse({
		kind: 'photo',
		dataUrl: `data:image/webp;base64,${bytes.toString('base64')}`,
		etag
	});
}

/** The registration that names a Desktop Session, when a Session rename was refused for it. */
function namingRegistration(error: unknown): string | undefined {
	if (
		!(error instanceof ServerApiError) ||
		error.kind !== 'server' ||
		error.status !== 409 ||
		error.code !== 'session.desktop_named_by_registration'
	)
		return undefined;
	return error.problem?.fields?.desktop_registration_id;
}

/** The closed Account reason for a failure. The Session signer already ended a refused Session. */
export function accountFailure(error: unknown, change: boolean): AccountFailure {
	if (!(error instanceof ServerApiError)) return change ? 'unconfirmed' : 'unavailable';
	if (error.kind === 'sessionEnded') return 'sessionEnded';
	if (error.kind !== 'server') return change ? 'unconfirmed' : 'unavailable';
	const status = error.status ?? 0;
	const code = error.code;
	if (status === 409) return 'conflict';
	if (status === 400) return 'invalid';
	if (status === 401) return 'sessionEnded';
	if (code === 'authentication.reauthentication_required') return 'reauthenticationRequired';
	if (code === 'authentication.desktop_reauthentication.denied') return 'denied';
	if (code === 'authentication.desktop_reauthentication.invalid') return 'invalid';
	if (code === 'authentication.strong_required') return 'strongAuthenticationRequired';
	if (status === 403) return 'denied';
	if (status === 404) return 'notFound';
	return change && status >= 500 ? 'unconfirmed' : 'unavailable';
}
function failure(error: unknown, change: boolean): AccountResponse {
	return { kind: 'error', reason: accountFailure(error, change) };
}
