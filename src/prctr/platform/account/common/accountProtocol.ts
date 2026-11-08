import type { ObservableApiCapability } from '../../serverApi/common/apiObservation.js';
export const ACCOUNT_CHANNEL = 'prctr:authenticated:account';
export const accountSections = ['profile', 'security', 'sessions', 'desktops'] as const;
export type AccountSection = (typeof accountSections)[number];
/** Every readable section: the navigable sections plus token, scope and retention-notice reads. */
export const accountReadSections = [
	...accountSections,
	'tokens',
	'grantableScopes',
	'notices'
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
export interface AccountHistoryQuery {
	/** Inclusive lower bound, epoch milliseconds. */
	readonly createdAfter?: number;
	/** Exclusive upper bound, epoch milliseconds. */
	readonly createdBefore?: number;
	readonly events?: readonly AccountHistoryEvent[];
	readonly status?: 'success' | 'fail';
	readonly relation?: 'subject' | 'actor';
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
	| { readonly kind: 'requestEmailVerification' };
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
	readonly method: string;
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
	| {
			readonly section: 'history';
			readonly entries: readonly AccountHistoryEntry[];
			/** Continues the same query; absent after the final page. */
			readonly cursor?: string;
	  }
	| {
			readonly section: 'notices';
			readonly notices: readonly AccountRetentionNotice[];
			/** The server holds further notices beyond this bounded first page. */
			readonly more: boolean;
	  };
export type AccountFailure =
	| 'unavailable'
	| 'sessionEnded'
	| 'reauthenticationRequired'
	| 'strongAuthenticationRequired'
	| 'denied'
	| 'notFound'
	| 'unconfirmed'
	| 'conflict'
	| 'invalid';
export type AccountResponse =
	| { readonly kind: 'photo'; readonly dataUrl: string; readonly etag: string }
	| { readonly kind: 'data'; readonly data: AccountData }
	/** The one-time credential reply to createToken; never cached, logged or stored. */
	| { readonly kind: 'tokenCreated'; readonly token: AccountToken; readonly credential: string }
	| { readonly kind: 'success' }
	| { readonly kind: 'sessionsEnded'; readonly count: number }
	| { readonly kind: 'error'; readonly reason: AccountFailure };
export interface AccountClient extends ObservableApiCapability<AccountIntent, AccountResponse> {
	request(intent: AccountIntent): Promise<AccountResponse>;
}
export interface AccountBinding {
	readonly principalId: string;
	readonly sessionId: string;
}

export function accountRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('Invalid account data');
	return value as Record<string, unknown>;
}
export function accountText(value: unknown, limit = 512): string {
	if (typeof value !== 'string' || value.length > limit)
		throw new TypeError('Invalid account text');
	return value.replace(/[\u0000-\u001f\u007f]/gu, ' ');
}
export function accountId(value: unknown): string {
	if (typeof value !== 'string' || !/^[ybndrfg8ejkmcpqxot1uwisza345h769]{26}$/u.test(value))
		throw new TypeError('Invalid account resource');
	return value;
}
export function accountBoolean(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new TypeError('Invalid account flag');
	return value;
}
export function accountTime(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 8640000000000000)
		throw new TypeError('Invalid account timestamp');
	return Number(value);
}
export function accountList(value: unknown, limit = 256): unknown[] {
	if (!Array.isArray(value) || value.length > limit) throw new TypeError('Invalid account list');
	return value;
}
/** Reads one page of a server collection; only its first page is presented. */
export function accountPage(value: unknown, limit = 256): unknown[] {
	return accountList(accountRecord(value).items, limit);
}
/** Reads a server RFC 3339 UTC instant as epoch milliseconds; absence stays absent. */
export function accountInstant(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value.length > 40 || !/Z$/u.test(value))
		throw new TypeError('Invalid account timestamp');
	return accountTime(Date.parse(value));
}
export function validateAccountIntent(value: unknown): AccountIntent {
	const input = accountRecord(value);
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
			input.kind === 'revokeOtherSessions') &&
		Object.keys(input).length === 1
	)
		return Object.freeze({ kind: input.kind });
	if (input.kind === 'createToken') return validateCreateToken(input);
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
		return Object.freeze({ kind: input.kind, id: accountId(input.id) });
	throw new TypeError('Invalid account action');
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
		'cursor'
	];
	if (!Object.keys(input).every((key) => allowed.includes(key)))
		throw new TypeError('Invalid account action');
	const query: Record<string, unknown> = { kind: 'readHistory' };
	if (input.createdAfter !== undefined) query.createdAfter = accountTime(input.createdAfter);
	if (input.createdBefore !== undefined) query.createdBefore = accountTime(input.createdBefore);
	if (
		query.createdAfter !== undefined &&
		query.createdBefore !== undefined &&
		(query.createdBefore as number) <= (query.createdAfter as number)
	)
		throw new TypeError('Invalid history range');
	if (input.events !== undefined) {
		const events = accountList(input.events, 64);
		if (
			events.length === 0 ||
			new Set(events).size !== events.length ||
			!events.every((event) => accountHistoryEvents.includes(event as AccountHistoryEvent))
		)
			throw new TypeError('Invalid history events');
		query.events = Object.freeze([...(events as AccountHistoryEvent[])]);
	}
	if (input.status !== undefined) query.status = accountMember(input.status, ['success', 'fail']);
	if (input.relation !== undefined)
		query.relation = accountMember(input.relation, ['subject', 'actor']);
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
	const scopes = accountList(input.scopes, 64);
	if (
		scopes.length === 0 ||
		new Set(scopes).size !== scopes.length ||
		!scopes.every((scope) => typeof scope === 'string' && tokenScope.test(scope))
	)
		throw new TypeError('Invalid token scopes');
	const expiresAt = accountTime(input.expiresAt);
	if (expiresAt === 0) throw new TypeError('Invalid token expiry');
	return Object.freeze({
		kind: 'createToken',
		description: input.description,
		scopes: Object.freeze([...(scopes as string[])]),
		...(input.academicUnitId === undefined
			? {}
			: { academicUnitId: accountId(input.academicUnitId) }),
		expiresAt
	});
}
function validateToken(value: unknown): AccountToken {
	const t = accountRecord(value);
	const scopes = accountList(t.scopes, 64).map((scope) => {
		if (typeof scope !== 'string' || !tokenScope.test(scope))
			throw new TypeError('Invalid token scope');
		return scope;
	});
	const optionalTime = (key: string) =>
		t[key] === undefined ? {} : { [key]: accountTime(t[key]) };
	return Object.freeze({
		id: accountId(t.id),
		description: accountText(t.description, 512),
		scopes: Object.freeze(scopes),
		...(t.academicUnitId === undefined ? {} : { academicUnitId: accountId(t.academicUnitId) }),
		expiresAt: accountTime(t.expiresAt),
		...optionalTime('lastUsedAt'),
		...optionalTime('disabledAt'),
		...optionalTime('revokedAt'),
		createdAt: accountTime(t.createdAt)
	});
}
function optionalTimes(
	record: Record<string, unknown>,
	keys: readonly string[]
): Record<string, number> {
	const times: Record<string, number> = {};
	for (const key of keys) if (record[key] !== undefined) times[key] = accountTime(record[key]);
	return times;
}
function accountMember<T extends string>(value: unknown, members: readonly T[]): T {
	if (!members.includes(value as T)) throw new TypeError('Invalid account state');
	return value as T;
}
export function validateAccountResponse(value: unknown): AccountResponse {
	const input = accountRecord(value);
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
		return Object.freeze({ kind: 'sessionsEnded', count: accountTime(input.count) });
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
			'invalid'
		].includes(input.reason as string)
	)
		return Object.freeze({ kind: 'error', reason: input.reason as AccountFailure });
	if (input.kind !== 'data') throw new TypeError('Invalid account response');
	const data = accountRecord(input.data);
	let result: AccountData;
	if (data.section === 'profile') {
		const p = accountRecord(data.profile);
		result = {
			section: 'profile',
			profile: Object.freeze({
				username: accountText(p.username),
				displayName: accountText(p.displayName),
				firstName: accountText(p.firstName),
				lastName: accountText(p.lastName),
				...(p.email === undefined ? {} : { email: accountText(p.email) }),
				...(p.emailVerified === undefined
					? {}
					: { emailVerified: accountBoolean(p.emailVerified) }),
				...(p.locale === undefined ? {} : { locale: accountText(p.locale, 128) }),
				...(p.timezone === undefined ? {} : { timezone: accountText(p.timezone, 128) }),
				createdAt: accountTime(p.createdAt)
			})
		};
	} else if (data.section === 'security') {
		const s = accountRecord(data.security);
		const m = s.mfa === undefined ? undefined : accountRecord(s.mfa);
		result = {
			section: 'security',
			security: Object.freeze({
				password: accountBoolean(s.password),
				providers: Object.freeze(
					accountList(s.providers, 64).map((value) => {
						const p = accountRecord(value);
						return Object.freeze({
							name: accountText(p.name),
							type: accountText(p.type, 64)
						});
					})
				),
				mfa:
					m === undefined
						? undefined
						: Object.freeze({
								available: accountBoolean(m.available),
								enabled: accountBoolean(m.enabled),
								pending: accountBoolean(m.pending),
								recoveryRequired: accountBoolean(m.recoveryRequired),
								recoveryCodesRemaining: accountTime(m.recoveryCodesRemaining),
								recoveryCodesTotal: accountTime(m.recoveryCodesTotal),
								...optionalTimes(m, [
									'recoveryCodesGeneratedAt',
									'enabledAt',
									'passwordChangedAt'
								]),
								...(m.method === undefined
									? {}
									: { method: accountMember(m.method, ['authenticatorApp']) })
							})
			})
		};
	} else if (data.section === 'sessions') {
		result = {
			section: 'sessions',
			sessions: Object.freeze(
				accountList(data.sessions).map((value) => {
					const s = accountRecord(value);
					return Object.freeze({
						id: accountId(s.id),
						current: accountBoolean(s.current),
						name: accountText(s.name),
						client: accountText(s.client, 64),
						method: accountText(s.method, 64),
						createdAt: accountTime(s.createdAt),
						lastActivityAt: accountTime(s.lastActivityAt),
						expiresAt: accountTime(s.expiresAt)
					});
				})
			)
		};
	} else if (data.section === 'desktops') {
		result = {
			section: 'desktops',
			desktops: Object.freeze(
				accountList(data.desktops).map((value) => {
					const d = accountRecord(value);
					return Object.freeze({
						id: accountId(d.id),
						current: accountBoolean(d.current),
						name: accountText(d.name),
						platform: accountText(d.platform, 64),
						release: accountText(d.release, 64),
						createdAt: accountTime(d.createdAt),
						lastUsedAt: accountTime(d.lastUsedAt),
						revoked: accountBoolean(d.revoked)
					});
				})
			)
		};
	} else if (data.section === 'tokens') {
		result = {
			section: 'tokens',
			tokens: Object.freeze(accountList(data.tokens).map(validateToken))
		};
		if (new Set(result.tokens.map((token) => token.id)).size !== result.tokens.length)
			throw new TypeError('Ambiguous account resource list');
	} else if (data.section === 'grantableScopes') {
		const g = accountRecord(data.grantable);
		const academicUnits = accountList(g.academicUnits, 50).map((value) => {
			const u = accountRecord(value);
			return Object.freeze({ id: accountId(u.id), name: accountText(u.name, 256) });
		});
		const unitIds = new Set(academicUnits.map((unit) => unit.id));
		const scopes = accountList(g.scopes, 128).map((value) => {
			const c = accountRecord(value);
			if (typeof c.name !== 'string' || !tokenScope.test(c.name))
				throw new TypeError('Invalid token scope');
			const ids = accountList(c.academicUnitIds, 50).map(accountId);
			if (!ids.every((id) => unitIds.has(id))) throw new TypeError('Invalid token scope');
			return Object.freeze({
				name: c.name,
				title: accountText(c.title, 256),
				description: accountText(c.description, 1024),
				institutionWide: accountBoolean(c.institutionWide),
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
				moreAcademicUnits: accountBoolean(g.moreAcademicUnits)
			})
		};
	} else if (data.section === 'history') {
		const entries = accountList(data.entries, 200).map((value) => {
			const e = accountRecord(value);
			const optional = (key: string, limit: number) =>
				e[key] === undefined ? {} : { [key]: accountText(e[key], limit) };
			return Object.freeze({
				id: accountId(e.id),
				createdAt: accountTime(e.createdAt),
				event: historyEventName(e.event),
				failed: accountBoolean(e.failed),
				relation: accountMember(e.relation, ['subject', 'actor'] as const),
				actor: accountMember(e.actor, accountHistoryActors),
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
		result = {
			section: 'history',
			entries: Object.freeze(entries),
			...(data.cursor === undefined ? {} : { cursor: data.cursor })
		};
	} else if (data.section === 'notices') {
		const notices = accountList(data.notices, 200).map((value) => {
			const n = accountRecord(value);
			return Object.freeze({
				retirementId: accountId(n.retirementId),
				examId: accountId(n.examId),
				examTitle: accountText(n.examTitle, 200),
				examSittingId: accountId(n.examSittingId),
				sittingStartAt: accountTime(n.sittingStartAt),
				sittingEndAt: accountTime(n.sittingEndAt),
				submissionId: accountId(n.submissionId),
				category: accountMember(n.category, accountNoticeCategories),
				state: accountMember(n.state, accountNoticeStates),
				createdAt: accountTime(n.createdAt),
				retireAfter: accountTime(n.retireAfter),
				deliveryState: accountMember(n.deliveryState, accountNoticeDeliveryStates),
				...(n.canceledAt === undefined ? {} : { canceledAt: accountTime(n.canceledAt) })
			});
		});
		if (new Set(notices.map((notice) => notice.retirementId)).size !== notices.length)
			throw new TypeError('Ambiguous account resource list');
		result = {
			section: 'notices',
			notices: Object.freeze(notices),
			more: accountBoolean(data.more)
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
