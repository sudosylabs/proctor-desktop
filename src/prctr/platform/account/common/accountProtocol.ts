import {
	validateSignInStanding,
	type SignInStanding
} from '../../identity/common/signInStanding.js';
import type { ObservableCapability } from '../../capabilityObservation/common/capabilityObservation.js';
import {
	projectionFlag,
	projectionId,
	projectionList,
	projectionMember,
	projectionRecord,
	projectionText,
	projectionTime
} from '../../serverApi/common/projection.js';
export const ACCOUNT_CHANNEL = 'prctr:authenticated:account';
export const accountSections = ['profile', 'security', 'sessions', 'desktops'] as const;
export type AccountSection = (typeof accountSections)[number];
/** Every readable section: the navigable sections plus token, scope and retention-notice reads. */
export const accountReadSections = [
	...accountSections,
	'tokens',
	'grantableScopes',
	'notices',
	'signIn'
] as const;
export type AccountReadSection = (typeof accountReadSections)[number];
export const accountNoticeCategories = [
	'work',
	'integrity',
	'browser_activity',
	'security_operational'
] as const;
export const accountNoticeStates = ['grace', 'canceled', 'retired'] as const;
export const accountNoticeDeliveryStates = [
	'pending',
	'queued',
	'sending',
	'accepted',
	'suppressed',
	'failed',
	'canceled'
] as const;
/** The server's closed catalogue of account-history events; labels are the client's. */
export const accountHistoryEvents = [
	'academic_unit.joined',
	'academic_unit.left',
	'account.disabled',
	'account.enabled',
	'account.recovered_by_administrator',
	'affiliation.ended',
	'affiliation.started',
	'class.enrolled',
	'class.transferred_in',
	'class.transferred_out',
	'class.unenrolled',
	'desktop.registration_revoked',
	'desktop.signed_in',
	'email.change_undone',
	'email.changed',
	'email.verified',
	'invitation.accepted',
	'mfa.disabled',
	'mfa.enabled',
	'mfa.recovery_codes_regenerated',
	'mfa.reset_by_administrator',
	'mfa.setup_started',
	'password.changed',
	'password.enrolled',
	'password.removed',
	'password.reset',
	'personal_access_token.created',
	'personal_access_token.disabled',
	'personal_access_token.enabled',
	'personal_access_token.revoked',
	'profile.changed',
	'profile_picture.changed',
	'profile_picture.removed',
	'provider.unlinked',
	'role.ended',
	'role.granted',
	'session.revoked',
	'sessions.revoked_all',
	'sessions.revoked_others',
	'sign_in.failed',
	'sign_in.succeeded',
	'sign_out'
] as const;
export type AccountHistoryEvent = (typeof accountHistoryEvents)[number];
export const accountHistoryActors = ['self', 'administrator', 'system'] as const;
/** One history query: every filter is optional and the cursor continues the same query. */
/** Events on one page of account history, unless the person chose another of the sizes. */
export const ACCOUNT_HISTORY_PAGE_SIZE = 10;
export const ACCOUNT_HISTORY_PAGE_SIZES = [10, 25, 50] as const;
export type AccountHistoryPageSize = (typeof ACCOUNT_HISTORY_PAGE_SIZES)[number];
const ACCOUNT_HISTORY_MAX_PAGE_SIZE = 50;

export interface AccountHistoryQuery {
	/** Inclusive lower bound, epoch milliseconds. */
	readonly createdAfter?: number;
	/** Exclusive upper bound, epoch milliseconds. */
	readonly createdBefore?: number;
	readonly events?: readonly AccountHistoryEvent[];
	readonly status?: 'success' | 'fail';
	readonly relation?: 'subject' | 'actor';
	/** Newest first unless asked otherwise; a cursor continues only the order that made it. */
	readonly order?: 'asc' | 'desc';
	/** Events on the page, 1 to 50; 10 when absent. A short last page is read oldest first. */
	readonly limit?: number;
	readonly cursor?: string;
}
export type AccountIntent =
	| { readonly kind: 'read'; readonly section: AccountReadSection }
	| ({ readonly kind: 'readHistory' } & AccountHistoryQuery)
	| { readonly kind: 'openSecurity' }
	| { readonly kind: 'readPhoto' }
	| {
			readonly kind: 'uploadPhoto';
			readonly bytes: Uint8Array;
			readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
			readonly etag: string;
	  }
	| { readonly kind: 'removePhoto'; readonly etag: string }
	| { readonly kind: 'revokeSession'; readonly id: string }
	| { readonly kind: 'revokeOtherSessions' }
	| { readonly kind: 'revokeDesktop'; readonly id: string }
	/** Names a browser or CLI Session; a Desktop Session is named by its registration. */
	| { readonly kind: 'renameSession'; readonly id: string; readonly name: string }
	| { readonly kind: 'renameDesktop'; readonly id: string; readonly name: string }
	| {
			readonly kind: 'createToken';
			readonly description: string;
			readonly scopes: readonly string[];
			readonly academicUnitId?: string;
			/** Absolute expiry in epoch milliseconds, as the server contract declares. */
			readonly expiresAt: number;
	  }
	| { readonly kind: 'disableToken'; readonly id: string }
	| { readonly kind: 'enableToken'; readonly id: string }
	| { readonly kind: 'revokeToken'; readonly id: string }
	| { readonly kind: 'requestEmailVerification' }
	/**
	 * Confirms it is the person in the system browser, refreshing the session's recent sign-in so
	 * a change that needs one can be sent again. Ends when the browser step completes or fails.
	 */
	| { readonly kind: 'reauthenticate' }
	/** Stops a confirmation still waiting for the browser. */
	| { readonly kind: 'cancelReauthentication' };
export interface AccountProfile {
	readonly username: string;
	readonly displayName: string;
	readonly firstName: string;
	readonly lastName: string;
	readonly email?: string;
	readonly emailVerified?: boolean;
	readonly locale?: string;
	readonly timezone?: string;
	/** When the account was created. */
	readonly createdAt: number;
	/** Whether the photo is the person's own upload or the generated default; only their own can be removed. */
	readonly photoKind: 'custom' | 'default';
}
export interface AccountSecurity {
	readonly password: boolean;
	readonly providers: readonly { readonly name: string; readonly type: string }[];
	readonly mfa:
		| {
				readonly available: boolean;
				readonly enabled: boolean;
				readonly pending: boolean;
				readonly recoveryRequired: boolean;
				readonly recoveryCodesRemaining: number;
				/** Size of the live recovery-code set; 0 unless two-step verification is on. */
				readonly recoveryCodesTotal: number;
				readonly recoveryCodesGeneratedAt?: number;
				readonly method?: 'authenticatorApp';
				readonly enabledAt?: number;
				readonly passwordChangedAt?: number;
		  }
		| undefined;
}
export interface AccountSession {
	readonly id: string;
	readonly current: boolean;
	readonly name: string;
	readonly client: string;
	/** The Desktop's operating system, empty for other clients. */
	readonly platform: string;
	readonly method: string;
	/** How strongly the Session was authenticated, as the server names it. */
	readonly authenticationStrength: string;
	/** When the Session completed two-step verification. */
	readonly mfaCompletedAt?: number;
	/** The Desktop registration a Desktop Session signed in with; it names the Session. */
	readonly desktopRegistrationId?: string;
	readonly desktopRegistrationName?: string;
	readonly createdAt: number;
	readonly lastActivityAt: number;
	readonly expiresAt: number;
}
export interface AccountDesktop {
	readonly id: string;
	readonly current: boolean;
	readonly name: string;
	readonly platform: string;
	readonly release: string;
	readonly createdAt: number;
	readonly lastUsedAt: number;
	readonly revoked: boolean;
}
/** Safe Personal Access Token metadata; the credential is never part of a read. */
export interface AccountToken {
	readonly id: string;
	readonly description: string;
	readonly scopes: readonly string[];
	readonly academicUnitId?: string;
	readonly expiresAt: number;
	readonly lastUsedAt?: number;
	readonly disabledAt?: number;
	readonly revokedAt?: number;
	readonly createdAt: number;
}
export interface AccountRetentionNotice {
	readonly retirementId: string;
	readonly examId: string;
	readonly examTitle: string;
	readonly examSittingId: string;
	readonly sittingStartAt: number;
	readonly sittingEndAt: number;
	readonly submissionId: string;
	readonly category: (typeof accountNoticeCategories)[number];
	readonly state: (typeof accountNoticeStates)[number];
	readonly createdAt: number;
	readonly retireAfter: number;
	readonly deliveryState: (typeof accountNoticeDeliveryStates)[number];
	readonly canceledAt?: number;
}
/** One scope the signed-in user may put on a Personal Access Token. */
export interface AccountGrantableScope {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	/** May be granted without an Academic Unit limit, or with any. */
	readonly institutionWide: boolean;
	/** Listed units at (and below) which this scope may be granted. */
	readonly academicUnitIds: readonly string[];
}
export interface AccountAcademicUnit {
	readonly id: string;
	readonly name: string;
}
export interface AccountGrantableScopes {
	readonly scopes: readonly AccountGrantableScope[];
	readonly academicUnits: readonly AccountAcademicUnit[];
	/** More units exist than are listed. */
	readonly moreAcademicUnits: boolean;
}
/** One event of the user's own account history. Another person is never named. */
export interface AccountHistoryEntry {
	readonly id: string;
	readonly createdAt: number;
	/** A catalogue name; the catalogue may grow, so an unknown name is presented generically. */
	readonly event: string;
	readonly failed: boolean;
	readonly relation: 'subject' | 'actor';
	readonly actor: (typeof accountHistoryActors)[number];
	/** One sentence the server wrote for display; it never names another person. */
	readonly summary: string;
	readonly client?: string;
	readonly ipAddress?: string;
	readonly userAgent?: string;
}
export type AccountData =
	| { readonly section: 'profile'; readonly profile: AccountProfile }
	| { readonly section: 'security'; readonly security: AccountSecurity }
	| { readonly section: 'sessions'; readonly sessions: readonly AccountSession[] }
	| { readonly section: 'desktops'; readonly desktops: readonly AccountDesktop[] }
	| { readonly section: 'tokens'; readonly tokens: readonly AccountToken[] }
	| { readonly section: 'grantableScopes'; readonly grantable: AccountGrantableScopes }
	/** How this Session stands for changes the institution guards. */
	| { readonly section: 'signIn'; readonly signIn: SignInStanding }
	| {
			readonly section: 'history';
			readonly entries: readonly AccountHistoryEntry[];
			/** Stretches of entries on this page that read as one line, in order, never overlapping. */
			readonly runs: readonly AccountHistoryRun[];
			/** Continues the same query; absent after the final page. */
			readonly cursor?: string;
			/** How many events match the query; only the first page of a query carries it. */
			readonly total?: number;
			/** The count stopped at its ceiling, so there are at least {@link total}. */
			readonly totalIsLowerBound?: boolean;
	  }
	| {
			readonly section: 'notices';
			readonly notices: readonly AccountRetentionNotice[];
			/** The server holds further notices beyond this bounded first page. */
			readonly more: boolean;
	  };
/** Two or more neighbouring entries of the same change, with the server's one sentence for them. */
export interface AccountHistoryRun {
	/** Index in the page's entries of the run's first entry. */
	readonly start: number;
	readonly length: number;
	/** A plural sentence counted by entries, as in "You changed 5 profile pictures". */
	readonly summary: string;
}
export type AccountFailure =
	| 'unavailable'
	| 'sessionEnded'
	| 'reauthenticationRequired'
	| 'strongAuthenticationRequired'
	| 'denied'
	| 'notFound'
	| 'unconfirmed'
	| 'conflict'
	| 'invalid'
	/** The person stopped a step in the browser, or it was cancelled here. */
	| 'cancelled'
	/** The browser step was not finished in time. */
	| 'expired';
export type AccountResponse =
	| { readonly kind: 'photo'; readonly dataUrl: string; readonly etag: string }
	| { readonly kind: 'data'; readonly data: AccountData }
	/** The one-time credential reply to createToken; never cached, logged or stored. */
	| { readonly kind: 'tokenCreated'; readonly token: AccountToken; readonly credential: string }
	| { readonly kind: 'success' }
	| { readonly kind: 'sessionsEnded'; readonly count: number }
	/** A Desktop Session is named by its registration; rename that registration instead. */
	| { readonly kind: 'namedByDesktop'; readonly desktopRegistrationId: string }
	| { readonly kind: 'error'; readonly reason: AccountFailure };
export interface AccountClient extends ObservableCapability<AccountIntent, AccountResponse> {
	request(intent: AccountIntent): Promise<AccountResponse>;
}
export function validateAccountIntent(value: unknown): AccountIntent {
	const input = projectionRecord(value);
	if (input.kind === 'readPhoto' && Object.keys(input).length === 1) return { kind: 'readPhoto' };
	if (input.kind === 'removePhoto' && Object.keys(input).length === 2)
		return { kind: 'removePhoto', etag: accountPhotoEtag(input.etag) };
	if (input.kind === 'uploadPhoto' && Object.keys(input).length === 4) {
		if (
			!(input.bytes instanceof Uint8Array) ||
			input.bytes.byteLength < 1 ||
			input.bytes.byteLength > 5 * 1024 * 1024 ||
			!['image/png', 'image/jpeg', 'image/webp'].includes(input.mediaType as string)
		)
			throw new TypeError('Invalid profile photo');
		return {
			kind: 'uploadPhoto',
			bytes: input.bytes.slice(),
			mediaType: input.mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
			etag: accountPhotoEtag(input.etag)
		};
	}
	if (
		(input.kind === 'openSecurity' ||
			input.kind === 'requestEmailVerification' ||
			input.kind === 'revokeOtherSessions' ||
			input.kind === 'reauthenticate' ||
			input.kind === 'cancelReauthentication') &&
		Object.keys(input).length === 1
	)
		return Object.freeze({ kind: input.kind });
	if (input.kind === 'createToken') return validateCreateToken(input);
	if (
		(input.kind === 'renameSession' || input.kind === 'renameDesktop') &&
		Object.keys(input).sort().join() === 'id,kind,name'
	)
		return Object.freeze({
			kind: input.kind,
			id: projectionId(input.id),
			name: accountDeviceName(input.name)
		});
	if (input.kind === 'readHistory') return validateHistoryQuery(input);
	if (Object.keys(input).length !== 2) throw new TypeError('Invalid account action');
	if (input.kind === 'read' && accountReadSections.includes(input.section as AccountReadSection))
		return Object.freeze({ kind: 'read', section: input.section as AccountReadSection });
	if (
		input.kind === 'revokeSession' ||
		input.kind === 'revokeDesktop' ||
		input.kind === 'disableToken' ||
		input.kind === 'enableToken' ||
		input.kind === 'revokeToken'
	)
		return Object.freeze({ kind: input.kind, id: projectionId(input.id) });
	throw new TypeError('Invalid account action');
}
/** A name the person typed for a Session or desktop: 1 to 128 characters, no control characters. */
function accountDeviceName(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.length > 128 ||
		value.trim().length === 0 ||
		/[\u0000-\u001f\u007f]/u.test(value)
	)
		throw new TypeError('Invalid device name');
	return value;
}
function historyEventName(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z][a-z0-9_.]{0,127}$/u.test(value))
		throw new TypeError('Invalid history event');
	return value;
}
const historyCursor = /^[\x21-\x7e]{1,2048}$/u;
function validateHistoryQuery(input: Record<string, unknown>): AccountIntent {
	const allowed = [
		'kind',
		'createdAfter',
		'createdBefore',
		'events',
		'status',
		'relation',
		'order',
		'limit',
		'cursor'
	];
	if (!Object.keys(input).every((key) => allowed.includes(key)))
		throw new TypeError('Invalid account action');
	const query: Record<string, unknown> = { kind: 'readHistory' };
	if (input.createdAfter !== undefined) query.createdAfter = projectionTime(input.createdAfter);
	if (input.createdBefore !== undefined)
		query.createdBefore = projectionTime(input.createdBefore);
	if (
		query.createdAfter !== undefined &&
		query.createdBefore !== undefined &&
		(query.createdBefore as number) <= (query.createdAfter as number)
	)
		throw new TypeError('Invalid history range');
	if (input.events !== undefined) {
		const events = projectionList(input.events, 64);
		if (
			events.length === 0 ||
			new Set(events).size !== events.length ||
			!events.every((event) => accountHistoryEvents.includes(event as AccountHistoryEvent))
		)
			throw new TypeError('Invalid history events');
		query.events = Object.freeze([...(events as AccountHistoryEvent[])]);
	}
	if (input.status !== undefined)
		query.status = projectionMember(input.status, ['success', 'fail']);
	if (input.relation !== undefined)
		query.relation = projectionMember(input.relation, ['subject', 'actor']);
	if (input.order !== undefined) query.order = projectionMember(input.order, ['asc', 'desc']);
	if (input.limit !== undefined) {
		if (
			typeof input.limit !== 'number' ||
			!Number.isInteger(input.limit) ||
			input.limit < 1 ||
			input.limit > ACCOUNT_HISTORY_MAX_PAGE_SIZE
		)
			throw new TypeError('Invalid history page size');
		query.limit = input.limit;
	}
	if (input.cursor !== undefined) {
		if (typeof input.cursor !== 'string' || !historyCursor.test(input.cursor))
			throw new TypeError('Invalid history cursor');
		query.cursor = input.cursor;
	}
	return Object.freeze(query) as AccountIntent;
}
const tokenScope = /^[a-z][a-z0-9_.:-]{0,127}$/u;
function validateCreateToken(input: Record<string, unknown>): AccountIntent {
	const keys = Object.keys(input).sort().join();
	if (
		keys !== 'description,expiresAt,kind,scopes' &&
		keys !== 'academicUnitId,description,expiresAt,kind,scopes'
	)
		throw new TypeError('Invalid account action');
	if (
		typeof input.description !== 'string' ||
		input.description.length > 256 ||
		input.description.trim().length === 0 ||
		/[\u0000-\u001f\u007f]/u.test(input.description)
	)
		throw new TypeError('Invalid token description');
	const scopes = projectionList(input.scopes, 64);
	if (
		scopes.length === 0 ||
		new Set(scopes).size !== scopes.length ||
		!scopes.every((scope) => typeof scope === 'string' && tokenScope.test(scope))
	)
		throw new TypeError('Invalid token scopes');
	const expiresAt = projectionTime(input.expiresAt);
	if (expiresAt === 0) throw new TypeError('Invalid token expiry');
	return Object.freeze({
		kind: 'createToken',
		description: input.description,
		scopes: Object.freeze([...(scopes as string[])]),
		...(input.academicUnitId === undefined
			? {}
			: { academicUnitId: projectionId(input.academicUnitId) }),
		expiresAt
	});
}
function validateToken(value: unknown): AccountToken {
	const t = projectionRecord(value);
	const scopes = projectionList(t.scopes, 64).map((scope) => {
		if (typeof scope !== 'string' || !tokenScope.test(scope))
			throw new TypeError('Invalid token scope');
		return scope;
	});
	const optionalTime = (key: string) =>
		t[key] === undefined ? {} : { [key]: projectionTime(t[key]) };
	return Object.freeze({
		id: projectionId(t.id),
		description: projectionText(t.description, 512),
		scopes: Object.freeze(scopes),
		...(t.academicUnitId === undefined
			? {}
			: { academicUnitId: projectionId(t.academicUnitId) }),
		expiresAt: projectionTime(t.expiresAt),
		...optionalTime('lastUsedAt'),
		...optionalTime('disabledAt'),
		...optionalTime('revokedAt'),
		createdAt: projectionTime(t.createdAt)
	});
}
function optionalTimes(
	record: Record<string, unknown>,
	keys: readonly string[]
): Record<string, number> {
	const times: Record<string, number> = {};
	for (const key of keys) if (record[key] !== undefined) times[key] = projectionTime(record[key]);
	return times;
}
export function validateAccountResponse(value: unknown): AccountResponse {
	const input = projectionRecord(value);
	if (input.kind === 'tokenCreated') {
		if (
			typeof input.credential !== 'string' ||
			!/^[\x21-\x7e]{16,1024}$/u.test(input.credential)
		)
			throw new TypeError('Invalid token credential');
		return Object.freeze({
			kind: 'tokenCreated',
			token: validateToken(input.token),
			credential: input.credential
		});
	}
	if (input.kind === 'photo') {
		if (
			typeof input.dataUrl !== 'string' ||
			input.dataUrl.length > 3 * 1024 * 1024 ||
			!/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/u.test(input.dataUrl)
		)
			throw new TypeError('Invalid profile photo');
		return { kind: 'photo', dataUrl: input.dataUrl, etag: accountPhotoEtag(input.etag) };
	}
	if (input.kind === 'success') return Object.freeze({ kind: 'success' });
	if (input.kind === 'sessionsEnded' && Object.keys(input).length === 2)
		return Object.freeze({ kind: 'sessionsEnded', count: projectionTime(input.count) });
	if (input.kind === 'namedByDesktop' && Object.keys(input).length === 2)
		return Object.freeze({
			kind: 'namedByDesktop',
			desktopRegistrationId: projectionId(input.desktopRegistrationId)
		});
	if (
		input.kind === 'error' &&
		[
			'unavailable',
			'sessionEnded',
			'reauthenticationRequired',
			'strongAuthenticationRequired',
			'denied',
			'notFound',
			'unconfirmed',
			'conflict',
			'invalid',
			'cancelled',
			'expired'
		].includes(input.reason as string)
	)
		return Object.freeze({ kind: 'error', reason: input.reason as AccountFailure });
	if (input.kind !== 'data') throw new TypeError('Invalid account response');
	const data = projectionRecord(input.data);
	let result: AccountData;
	if (data.section === 'profile') {
		const p = projectionRecord(data.profile);
		result = {
			section: 'profile',
			profile: Object.freeze({
				username: projectionText(p.username),
				displayName: projectionText(p.displayName),
				firstName: projectionText(p.firstName),
				lastName: projectionText(p.lastName),
				...(p.email === undefined ? {} : { email: projectionText(p.email) }),
				...(p.emailVerified === undefined
					? {}
					: { emailVerified: projectionFlag(p.emailVerified) }),
				...(p.locale === undefined ? {} : { locale: projectionText(p.locale, 128) }),
				...(p.timezone === undefined ? {} : { timezone: projectionText(p.timezone, 128) }),
				createdAt: projectionTime(p.createdAt),
				photoKind: projectionMember(p.photoKind, ['custom', 'default'])
			})
		};
	} else if (data.section === 'signIn') {
		result = { section: 'signIn', signIn: validateSignInStanding(data.signIn) };
	} else if (data.section === 'security') {
		const s = projectionRecord(data.security);
		const m = s.mfa === undefined ? undefined : projectionRecord(s.mfa);
		result = {
			section: 'security',
			security: Object.freeze({
				password: projectionFlag(s.password),
				providers: Object.freeze(
					projectionList(s.providers, 64).map((value) => {
						const p = projectionRecord(value);
						return Object.freeze({
							name: projectionText(p.name),
							type: projectionText(p.type, 64)
						});
					})
				),
				mfa:
					m === undefined
						? undefined
						: Object.freeze({
								available: projectionFlag(m.available),
								enabled: projectionFlag(m.enabled),
								pending: projectionFlag(m.pending),
								recoveryRequired: projectionFlag(m.recoveryRequired),
								recoveryCodesRemaining: projectionTime(m.recoveryCodesRemaining),
								recoveryCodesTotal: projectionTime(m.recoveryCodesTotal),
								...optionalTimes(m, [
									'recoveryCodesGeneratedAt',
									'enabledAt',
									'passwordChangedAt'
								]),
								...(m.method === undefined
									? {}
									: { method: projectionMember(m.method, ['authenticatorApp']) })
							})
			})
		};
	} else if (data.section === 'sessions') {
		result = {
			section: 'sessions',
			sessions: Object.freeze(
				projectionList(data.sessions).map((value) => {
					const s = projectionRecord(value);
					return Object.freeze({
						id: projectionId(s.id),
						current: projectionFlag(s.current),
						name: projectionText(s.name),
						client: projectionText(s.client, 64),
						platform: projectionText(s.platform, 64),
						method: projectionText(s.method, 64),
						authenticationStrength: projectionText(s.authenticationStrength, 64),
						...optionalTimes(s, ['mfaCompletedAt']),
						...(s.desktopRegistrationId === undefined
							? {}
							: { desktopRegistrationId: projectionId(s.desktopRegistrationId) }),
						...(s.desktopRegistrationName === undefined
							? {}
							: {
									desktopRegistrationName: projectionText(
										s.desktopRegistrationName
									)
								}),
						createdAt: projectionTime(s.createdAt),
						lastActivityAt: projectionTime(s.lastActivityAt),
						expiresAt: projectionTime(s.expiresAt)
					});
				})
			)
		};
	} else if (data.section === 'desktops') {
		result = {
			section: 'desktops',
			desktops: Object.freeze(
				projectionList(data.desktops).map((value) => {
					const d = projectionRecord(value);
					return Object.freeze({
						id: projectionId(d.id),
						current: projectionFlag(d.current),
						name: projectionText(d.name),
						platform: projectionText(d.platform, 64),
						release: projectionText(d.release, 64),
						createdAt: projectionTime(d.createdAt),
						lastUsedAt: projectionTime(d.lastUsedAt),
						revoked: projectionFlag(d.revoked)
					});
				})
			)
		};
	} else if (data.section === 'tokens') {
		result = {
			section: 'tokens',
			tokens: Object.freeze(projectionList(data.tokens).map(validateToken))
		};
		if (new Set(result.tokens.map((token) => token.id)).size !== result.tokens.length)
			throw new TypeError('Ambiguous account resource list');
	} else if (data.section === 'grantableScopes') {
		const g = projectionRecord(data.grantable);
		const academicUnits = projectionList(g.academicUnits, 50).map((value) => {
			const u = projectionRecord(value);
			return Object.freeze({ id: projectionId(u.id), name: projectionText(u.name, 256) });
		});
		const unitIds = new Set(academicUnits.map((unit) => unit.id));
		const scopes = projectionList(g.scopes, 128).map((value) => {
			const c = projectionRecord(value);
			if (typeof c.name !== 'string' || !tokenScope.test(c.name))
				throw new TypeError('Invalid token scope');
			const ids = projectionList(c.academicUnitIds, 50).map(projectionId);
			if (!ids.every((id) => unitIds.has(id))) throw new TypeError('Invalid token scope');
			return Object.freeze({
				name: c.name,
				title: projectionText(c.title, 256),
				description: projectionText(c.description, 1024),
				institutionWide: projectionFlag(c.institutionWide),
				academicUnitIds: Object.freeze(ids)
			});
		});
		if (
			unitIds.size !== academicUnits.length ||
			new Set(scopes.map((scope) => scope.name)).size !== scopes.length
		)
			throw new TypeError('Ambiguous account resource list');
		result = {
			section: 'grantableScopes',
			grantable: Object.freeze({
				scopes: Object.freeze(scopes),
				academicUnits: Object.freeze(academicUnits),
				moreAcademicUnits: projectionFlag(g.moreAcademicUnits)
			})
		};
	} else if (data.section === 'history') {
		const entries = projectionList(data.entries, 200).map((value) => {
			const e = projectionRecord(value);
			const optional = (key: string, limit: number) =>
				e[key] === undefined ? {} : { [key]: projectionText(e[key], limit) };
			return Object.freeze({
				id: projectionId(e.id),
				createdAt: projectionTime(e.createdAt),
				event: historyEventName(e.event),
				failed: projectionFlag(e.failed),
				relation: projectionMember(e.relation, ['subject', 'actor'] as const),
				actor: projectionMember(e.actor, accountHistoryActors),
				summary: projectionText(e.summary, 2048),
				...optional('client', 32),
				...optional('ipAddress', 64),
				...optional('userAgent', 512)
			}) as AccountHistoryEntry;
		});
		if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
			throw new TypeError('Ambiguous account resource list');
		if (
			data.cursor !== undefined &&
			(typeof data.cursor !== 'string' || !historyCursor.test(data.cursor))
		)
			throw new TypeError('Invalid history cursor');
		if (
			data.total !== undefined &&
			(typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0)
		)
			throw new TypeError('Invalid history total');
		let next = 0;
		const runs = projectionList(data.runs ?? [], 100).map((value) => {
			const r = projectionRecord(value);
			const start = r.start;
			const length = r.length;
			if (
				typeof start !== 'number' ||
				typeof length !== 'number' ||
				!Number.isSafeInteger(start) ||
				!Number.isSafeInteger(length) ||
				start < next ||
				length < 2 ||
				start + length > entries.length
			)
				throw new TypeError('Invalid history run');
			next = start + length;
			return Object.freeze({ start, length, summary: projectionText(r.summary, 500) });
		});
		result = {
			section: 'history',
			entries: Object.freeze(entries),
			runs: Object.freeze(runs),
			...(data.cursor === undefined ? {} : { cursor: data.cursor }),
			...(data.total === undefined
				? {}
				: {
						total: data.total as number,
						totalIsLowerBound: projectionFlag(data.totalIsLowerBound ?? false)
					})
		};
	} else if (data.section === 'notices') {
		const notices = projectionList(data.notices, 200).map((value) => {
			const n = projectionRecord(value);
			return Object.freeze({
				retirementId: projectionId(n.retirementId),
				examId: projectionId(n.examId),
				examTitle: projectionText(n.examTitle, 200),
				examSittingId: projectionId(n.examSittingId),
				sittingStartAt: projectionTime(n.sittingStartAt),
				sittingEndAt: projectionTime(n.sittingEndAt),
				submissionId: projectionId(n.submissionId),
				category: projectionMember(n.category, accountNoticeCategories),
				state: projectionMember(n.state, accountNoticeStates),
				createdAt: projectionTime(n.createdAt),
				retireAfter: projectionTime(n.retireAfter),
				deliveryState: projectionMember(n.deliveryState, accountNoticeDeliveryStates),
				...(n.canceledAt === undefined ? {} : { canceledAt: projectionTime(n.canceledAt) })
			});
		});
		if (new Set(notices.map((notice) => notice.retirementId)).size !== notices.length)
			throw new TypeError('Ambiguous account resource list');
		result = {
			section: 'notices',
			notices: Object.freeze(notices),
			more: projectionFlag(data.more)
		};
	} else throw new TypeError('Invalid account section');
	if (result.section === 'sessions' || result.section === 'desktops') {
		const items = result.section === 'sessions' ? result.sessions : result.desktops;
		if (
			new Set(items.map((item) => item.id)).size !== items.length ||
			items.filter((item) => item.current).length > 1
		)
			throw new TypeError('Ambiguous account resource list');
	}
	return Object.freeze({ kind: 'data', data: Object.freeze(result) });
}

export function accountPhotoEtag(value: unknown): string {
	if (typeof value !== 'string' || !/^"[a-f0-9]{64}"$/u.test(value))
		throw new TypeError('Invalid profile photo revision');
	return value;
}
