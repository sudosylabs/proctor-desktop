/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	AccountDesktop,
	AccountHistoryEntry,
	AccountHistoryEvent,
	AccountHistoryQuery,
	AccountGrantableScope,
	AccountGrantableScopes,
	AccountFailure,
	AccountRetentionNotice,
	AccountSecurity,
	AccountSession,
	AccountToken
} from '../../../../platform/account/common/accountProtocol.js';

const DAY = 24 * 60 * 60 * 1000;

// #region Failures

export type FailureMessage =
	| 'failureUnavailable'
	| 'failureSessionEnded'
	| 'failureReauthentication'
	| 'failureStrongAuthentication'
	| 'failureDenied'
	| 'failureNotFound'
	| 'failureUnconfirmed'
	| 'failureConflict'
	| 'failureInvalid'
	| 'failureCancelled'
	| 'failureExpired';

const failureMessages: Readonly<Record<AccountFailure, FailureMessage>> = Object.freeze({
	unavailable: 'failureUnavailable',
	sessionEnded: 'failureSessionEnded',
	reauthenticationRequired: 'failureReauthentication',
	strongAuthenticationRequired: 'failureStrongAuthentication',
	denied: 'failureDenied',
	notFound: 'failureNotFound',
	unconfirmed: 'failureUnconfirmed',
	conflict: 'failureConflict',
	invalid: 'failureInvalid',
	cancelled: 'failureCancelled',
	expired: 'failureExpired'
});

export function failureMessage(reason: AccountFailure): FailureMessage {
	return failureMessages[reason];
}

/** An Account failure named by a page section, which knows failures only as text. */
export function accountFailureOf(reason: string): AccountFailure {
	return Object.hasOwn(failureMessages, reason) ? (reason as AccountFailure) : 'unavailable';
}

/** The outcome is unknown or the item changed, so the list must be read again before a retry. */
export function failureNeedsRead(reason: AccountFailure): boolean {
	return reason === 'unconfirmed' || reason === 'conflict' || reason === 'notFound';
}

/** The shown data no longer belongs to this window, so it is withdrawn rather than kept as stale. */
export function failureWithdrawsData(reason: AccountFailure): boolean {
	return reason === 'sessionEnded' || reason === 'denied' || reason === 'notFound';
}

// #endregion

// #region Profile

export function initialsOf(name: string): string {
	return name
		.trim()
		.split(/\s+/u)
		.slice(0, 2)
		.map((part) => [...part][0] ?? '')
		.join('')
		.toLocaleUpperCase();
}

export type NoticeCategoryMessage =
	'noticeWork' | 'noticeIntegrity' | 'noticeBrowserActivity' | 'noticeSecurityOperational';

const noticeCategories: Readonly<
	Record<AccountRetentionNotice['category'], NoticeCategoryMessage>
> = Object.freeze({
	work: 'noticeWork',
	integrity: 'noticeIntegrity',
	browser_activity: 'noticeBrowserActivity',
	security_operational: 'noticeSecurityOperational'
});

export interface NoticePresentation {
	/** The kind of record the notice covers; the exam title names where it came from. */
	readonly category: NoticeCategoryMessage;
	readonly when: 'noticeDeletedAfter' | 'noticeDeletionCanceled' | 'noticeDeleted';
	readonly date: number | undefined;
}

export function noticePresentation(notice: AccountRetentionNotice): NoticePresentation {
	const category = noticeCategories[notice.category];
	if (notice.state === 'canceled')
		return { category, when: 'noticeDeletionCanceled', date: notice.canceledAt };
	if (notice.state === 'retired') return { category, when: 'noticeDeleted', date: undefined };
	return { category, when: 'noticeDeletedAfter', date: notice.retireAfter };
}

// #endregion

// #region Sign-in and security

export const RECOVERY_CODES_LOW = 3;

export type TwoStepStatus =
	'notOffered' | 'serviceUnavailable' | 'recoveryRequired' | 'pending' | 'on' | 'off';

export interface TwoStepPresentation {
	readonly status: TwoStepStatus;
	/** Present only while two-step verification is on. */
	readonly recovery?: {
		readonly remaining: number;
		/** Size of the issued set; 0 when the server does not know it. */
		readonly total: number;
		readonly low: boolean;
	};
}

export function twoStepPresentation(mfa: AccountSecurity['mfa']): TwoStepPresentation {
	if (mfa === undefined) return { status: 'notOffered' };
	if (!mfa.available) return { status: 'serviceUnavailable' };
	if (mfa.recoveryRequired) return { status: 'recoveryRequired' };
	if (mfa.enabled) {
		const remaining = mfa.recoveryCodesRemaining;
		return {
			status: 'on',
			recovery: {
				remaining,
				total: mfa.recoveryCodesTotal,
				low: remaining <= RECOVERY_CODES_LOW
			}
		};
	}
	if (mfa.pending) return { status: 'pending' };
	return { status: 'off' };
}

export type ProviderKind = 'singleSignOn' | 'other';

/** Institution sign-in providers are single sign-on whatever protocol the server names. */
export function providerKind(type: string): ProviderKind {
	return ['oidc', 'oauth', 'saml', 'cas', 'sso', 'ldap'].includes(type.toLowerCase())
		? 'singleSignOn'
		: 'other';
}

// #endregion

// #region Sessions and devices

/** One signed-in place, with the registered computer it signed in with, if any. */
export interface SignedInEntry {
	readonly session: AccountSession;
	readonly desktop: AccountDesktop | undefined;
}

export interface SessionGroups {
	/** Every Session, this window's first, each computer once. */
	readonly signedIn: readonly SignedInEntry[];
	readonly current: AccountSession | undefined;
	/** Registered computers that no Session signed in with; removed ones are left out. */
	readonly registeredOnly: readonly AccountDesktop[];
}

/**
 * Each computer appears once: a Desktop Session is joined to the registration it signed in
 * with, and the registrations left over are the computers set up for exams but not signed in.
 */
export function groupSessions(
	sessions: readonly AccountSession[],
	desktops: readonly AccountDesktop[] = []
): SessionGroups {
	const byId = new Map(desktops.map((desktop) => [desktop.id, desktop]));
	const joined = new Set<string>();
	const ordered = [
		...sessions.filter((session) => session.current),
		...sessions.filter((session) => !session.current)
	];
	const signedIn = ordered.map((session) => {
		const desktop =
			session.desktopRegistrationId === undefined
				? undefined
				: byId.get(session.desktopRegistrationId);
		if (desktop !== undefined) joined.add(desktop.id);
		return { session, desktop };
	});
	return {
		signedIn,
		current: ordered.find((session) => session.current),
		registeredOnly: orderDesktops(
			desktops.filter((desktop) => !desktop.revoked && !joined.has(desktop.id))
		)
	};
}

/** The current desktop first, then the rest in server order. */
export function orderDesktops(desktops: readonly AccountDesktop[]): readonly AccountDesktop[] {
	return [
		...desktops.filter((desktop) => desktop.current),
		...desktops.filter((desktop) => !desktop.current)
	];
}

export type ClientKind = 'clientWeb' | 'clientDesktop' | 'clientCli' | 'clientOther';

export function clientKind(client: string): ClientKind {
	if (client === 'web') return 'clientWeb';
	if (client === 'desktop') return 'clientDesktop';
	if (client === 'cli') return 'clientCli';
	return 'clientOther';
}

/** A Session the server could not say what it is: the row the page asks you to judge. */
export function sessionUnidentified(session: AccountSession): boolean {
	return clientKind(session.client) === 'clientOther';
}

export type SignInMessage =
	| 'signInPassword'
	| 'signInPasswordTwoStep'
	| 'signInSingleSignOn'
	| 'signInSingleSignOnTwoStep'
	| 'signInOther'
	| 'signInOtherTwoStep';

/** How a Session signed in: "Password, no two-step", "Single sign-on with two-step verification". */
export function signInMessage(session: AccountSession): SignInMessage {
	const twoStep =
		session.authenticationStrength === 'multi_factor' || session.mfaCompletedAt !== undefined;
	const method = session.method.toLowerCase();
	if (method === 'password') return twoStep ? 'signInPasswordTwoStep' : 'signInPassword';
	if (providerKind(method) === 'singleSignOn' || method === 'provider')
		return twoStep ? 'signInSingleSignOnTwoStep' : 'signInSingleSignOn';
	return twoStep ? 'signInOtherTwoStep' : 'signInOther';
}

export type PlatformKind = 'platformMac' | 'platformWindows' | 'platformLinux' | 'platformOther';

export function platformKind(platform: string): PlatformKind {
	if (platform === 'darwin' || platform === 'macos') return 'platformMac';
	if (platform === 'win32' || platform === 'windows') return 'platformWindows';
	if (platform === 'linux') return 'platformLinux';
	return 'platformOther';
}

// #endregion

// #region Access tokens

export type TokenState = 'active' | 'disabled' | 'expired' | 'revoked';

export function tokenState(token: AccountToken, now: number): TokenState {
	if (token.revokedAt !== undefined) return 'revoked';
	if (token.expiresAt <= now) return 'expired';
	if (token.disabledAt !== undefined) return 'disabled';
	return 'active';
}

export interface TokenGroups {
	readonly active: readonly AccountToken[];
	readonly inactive: readonly AccountToken[];
}

export function groupTokens(tokens: readonly AccountToken[], now: number): TokenGroups {
	return {
		active: tokens.filter((token) => tokenState(token, now) === 'active'),
		inactive: tokens.filter((token) => tokenState(token, now) !== 'active')
	};
}

/** An active token stops working within this many days, so it is the one to look at. */
export const TOKEN_EXPIRES_SOON_DAYS = 7;

/** Whole days until an active token expires, when that is soon; otherwise undefined. */
export function tokenExpiresSoon(token: AccountToken, now: number): number | undefined {
	if (tokenState(token, now) !== 'active') return undefined;
	const days = Math.ceil((token.expiresAt - now) / DAY);
	return days <= TOKEN_EXPIRES_SOON_DAYS ? Math.max(days, 1) : undefined;
}

export type TokenAction = 'disable' | 'enable' | 'revoke';

/** A disabled token can be turned back on until it expires; expired and revoked ones are records. */
export function tokenActions(state: TokenState): readonly TokenAction[] {
	if (state === 'active') return ['disable', 'revoke'];
	if (state === 'disabled') return ['enable', 'revoke'];
	return [];
}

/**
 * Whether a scope may go on a token limited to `academicUnitId`, or on an
 * unlimited token when it is absent. The listed units are roots; the server
 * still checks every requested scope against current authority.
 */
export function scopeGrantable(
	scope: AccountGrantableScope,
	academicUnitId: string | undefined
): boolean {
	if (scope.institutionWide) return true;
	return academicUnitId !== undefined && scope.academicUnitIds.includes(academicUnitId);
}

/** A scope's title from the catalogue, or its stable name when the catalogue lacks it. */
export function scopeTitle(scope: string, grantable: AccountGrantableScopes | undefined): string {
	return grantable?.scopes.find((entry) => entry.name === scope)?.title ?? scope;
}

/** The New token grid's fixed columns, in order; a scope's action names its column. */
export const tokenActionColumns = ['view', 'create', 'manage', 'review', 'publish'] as const;
export type TokenActionColumn = (typeof tokenActionColumns)[number];

const columnOfAction: Readonly<Record<string, TokenActionColumn>> = Object.freeze({
	view: 'view',
	create: 'create',
	manage: 'manage',
	review: 'review',
	publish: 'publish',
	// Releasing marked work is publishing it to candidates.
	release: 'publish'
});

/** One row of the New token grid: what the scopes act on, and one scope per action column. */
export interface TokenScopeArea {
	/** The scope names before their action, such as `exam.sitting`. */
	readonly area: string;
	/** Override scopes act on anyone's records, not only your own, so they get a row of their own. */
	readonly anyone: boolean;
	readonly cells: Readonly<Partial<Record<TokenActionColumn, AccountGrantableScope>>>;
	/** Scopes whose action has no column; each is offered on its own beneath the row. */
	readonly other: readonly AccountGrantableScope[];
}

/**
 * Groups grantable scopes such as `exam.view` and `exam.publish.override` into grid rows,
 * in the order the server lists them.
 */
export function tokenScopeAreas(
	scopes: readonly AccountGrantableScope[]
): readonly TokenScopeArea[] {
	const rows = new Map<
		string,
		{
			area: string;
			anyone: boolean;
			cells: Partial<Record<TokenActionColumn, AccountGrantableScope>>;
			other: AccountGrantableScope[];
		}
	>();
	for (const scope of scopes) {
		const parts = scope.name.split('.');
		const anyone = parts.length > 2 && parts.at(-1) === 'override';
		const action = (anyone ? parts.at(-2) : parts.at(-1)) ?? scope.name;
		const area = parts.slice(0, anyone ? -2 : -1).join('.') || scope.name;
		const key = `${area}|${String(anyone)}`;
		let row = rows.get(key);
		if (row === undefined) {
			row = { area, anyone, cells: {}, other: [] };
			rows.set(key, row);
		}
		const column = Object.hasOwn(columnOfAction, action) ? columnOfAction[action] : undefined;
		if (column === undefined || row.cells[column] !== undefined) row.other.push(scope);
		else row.cells[column] = scope;
	}
	return [...rows.values()];
}

export type TokenAreaMessage =
	| 'tokenAreaAcademicProgression'
	| 'tokenAreaAcademicAudit'
	| 'tokenAreaAcademicPeriod'
	| 'tokenAreaAcademicUnit'
	| 'tokenAreaAcademicUnitMembers'
	| 'tokenAreaAudit'
	| 'tokenAreaClass'
	| 'tokenAreaClassMembers'
	| 'tokenAreaBrowserActivity'
	| 'tokenAreaExam'
	| 'tokenAreaSitting'
	| 'tokenAreaInstitution'
	| 'tokenAreaInvitation'
	| 'tokenAreaJob'
	| 'tokenAreaMail'
	| 'tokenAreaOnboarding'
	| 'tokenAreaProgramme'
	| 'tokenAreaProgrammeLevel'
	| 'tokenAreaSession'
	| 'tokenAreaSubmission'
	| 'tokenAreaUser'
	| 'tokenAreaProfilePicture';

const tokenAreaMessages: Readonly<Record<string, TokenAreaMessage>> = Object.freeze({
	'academic.progression': 'tokenAreaAcademicProgression',
	academic_audit: 'tokenAreaAcademicAudit',
	academic_period: 'tokenAreaAcademicPeriod',
	academic_unit: 'tokenAreaAcademicUnit',
	'academic_unit.members': 'tokenAreaAcademicUnitMembers',
	audit: 'tokenAreaAudit',
	class: 'tokenAreaClass',
	'class.members': 'tokenAreaClassMembers',
	'exam.attempt.browser_activity': 'tokenAreaBrowserActivity',
	exam: 'tokenAreaExam',
	'exam.sitting': 'tokenAreaSitting',
	institution: 'tokenAreaInstitution',
	invitation: 'tokenAreaInvitation',
	job: 'tokenAreaJob',
	mail: 'tokenAreaMail',
	onboarding_batch: 'tokenAreaOnboarding',
	programme: 'tokenAreaProgramme',
	programme_level: 'tokenAreaProgrammeLevel',
	session: 'tokenAreaSession',
	submission: 'tokenAreaSubmission',
	user: 'tokenAreaUser',
	'user.profile_picture': 'tokenAreaProfilePicture'
});

/**
 * The area's name in product language; its description is the same key with `Description`.
 * An area added to the catalogue after this release has none, and its row is named by its
 * scopes' own titles instead.
 */
export function tokenAreaMessage(area: string): TokenAreaMessage | undefined {
	return Object.hasOwn(tokenAreaMessages, area) ? tokenAreaMessages[area] : undefined;
}

export const tokenExpiryPresets = Object.freeze([7, 30, 90, 180, 365] as const);
export type TokenExpiryPreset = (typeof tokenExpiryPresets)[number];
export const DEFAULT_TOKEN_EXPIRY: TokenExpiryPreset = 90;

export function tokenExpiry(days: TokenExpiryPreset, now: number): number {
	return now + days * DAY;
}

export const TOKEN_NAME_LIMIT = 256;

export interface TokenDraft {
	readonly name: string;
	readonly scopes: readonly string[];
}

export interface TokenDraftErrors {
	readonly name?: 'tokenNameRequired' | 'tokenNameTooLong' | 'tokenNameInvalid';
	readonly scopes?: 'tokenScopesRequired';
}

/** Mirrors the account capability's own validation, so a draft it would reject is never sent. */
export function validateTokenDraft(draft: TokenDraft): TokenDraftErrors {
	const errors: { name?: TokenDraftErrors['name']; scopes?: TokenDraftErrors['scopes'] } = {};
	if (draft.name.trim().length === 0) errors.name = 'tokenNameRequired';
	else if (draft.name.length > TOKEN_NAME_LIMIT) errors.name = 'tokenNameTooLong';
	else if (/[\u0000-\u001f\u007f]/u.test(draft.name)) errors.name = 'tokenNameInvalid';
	if (draft.scopes.length === 0) errors.scopes = 'tokenScopesRequired';
	return errors;
}

// #endregion

// #region Account history

export const historyEventGroups = [
	{
		id: 'signIn',
		events: [
			'sign_in.succeeded',
			'sign_in.failed',
			'sign_out',
			'desktop.signed_in',
			'session.revoked',
			'sessions.revoked_all',
			'sessions.revoked_others',
			'desktop.registration_revoked'
		]
	},
	{
		id: 'security',
		events: [
			'password.changed',
			'password.enrolled',
			'password.removed',
			'password.reset',
			'mfa.disabled',
			'mfa.enabled',
			'mfa.recovery_codes_regenerated',
			'mfa.reset_by_administrator',
			'mfa.setup_started',
			'provider.unlinked',
			'email.changed',
			'email.change_undone',
			'email.verified',
			'account.recovered_by_administrator'
		]
	},
	{
		id: 'tokens',
		events: [
			'personal_access_token.created',
			'personal_access_token.disabled',
			'personal_access_token.enabled',
			'personal_access_token.revoked'
		]
	},
	{
		id: 'profile',
		events: ['profile.changed', 'profile_picture.changed', 'profile_picture.removed']
	},
	{
		id: 'membership',
		events: [
			'academic_unit.joined',
			'academic_unit.left',
			'class.enrolled',
			'class.transferred_in',
			'class.transferred_out',
			'class.unenrolled',
			'affiliation.started',
			'affiliation.ended',
			'role.granted',
			'role.ended',
			'invitation.accepted'
		]
	},
	{ id: 'status', events: ['account.disabled', 'account.enabled'] }
] as const satisfies readonly {
	readonly id: string;
	readonly events: readonly AccountHistoryEvent[];
}[];
export type HistoryEventGroup = (typeof historyEventGroups)[number]['id'];

/** How far back the history reaches, in days. */
export const historyPeriods = Object.freeze([7, 30, 182, 365, 'all'] as const);
export type HistoryPeriod = (typeof historyPeriods)[number];
export const DEFAULT_HISTORY_PERIOD: HistoryPeriod = 182;

export interface HistoryFilters {
	readonly period: HistoryPeriod;
	/** A kind of change, or every failed attempt whatever its kind. */
	readonly kind: HistoryEventGroup | 'failed' | 'all';
	readonly about: 'subject' | 'actor' | 'all';
	/** When, newest first unless turned round. */
	readonly order: 'desc' | 'asc';
	/** Go to a date: only events before the end of this day, epoch milliseconds. */
	readonly before?: number;
}

export const defaultHistoryFilters: HistoryFilters = Object.freeze({
	period: DEFAULT_HISTORY_PERIOD,
	kind: 'all',
	about: 'all',
	order: 'desc'
});

const MINUTE = 60 * 1000;

/**
 * The server query for a set of filters, without its cursor. The period starts on a whole
 * minute, so re-reads repeat; a date to go to ends the period instead of now.
 */
export function historyQuery(filters: HistoryFilters, now: number): AccountHistoryQuery {
	const group = historyEventGroups.find((entry) => entry.id === filters.kind);
	const end = filters.before ?? now;
	const after =
		filters.period === 'all'
			? undefined
			: Math.floor((end - filters.period * DAY) / MINUTE) * MINUTE;
	return {
		...(after === undefined ? {} : { createdAfter: after }),
		...(filters.before === undefined ? {} : { createdBefore: filters.before }),
		...(group === undefined ? {} : { events: group.events }),
		...(filters.kind === 'failed' ? { status: 'fail' as const } : {}),
		...(filters.about === 'all' ? {} : { relation: filters.about }),
		...(filters.order === 'asc' ? { order: 'asc' as const } : {})
	};
}

/** Adjacent rows of the same change fold into one once there are this many. */
export const HISTORY_FOLD_MIN = 3;

/** One row of the history table: one event, or a run of the same change folded together. */
export interface HistoryRun {
	readonly entries: readonly AccountHistoryEntry[];
}

/**
 * Folds runs of the same change done the same way, such as five profile photos changed in a
 * row, into one row within the page. Shorter runs stay as they are.
 */
export function foldHistory(entries: readonly AccountHistoryEntry[]): readonly HistoryRun[] {
	const runs: AccountHistoryEntry[][] = [];
	for (const entry of entries) {
		const last = runs.at(-1);
		const previous = last?.[0];
		if (
			last !== undefined &&
			previous !== undefined &&
			previous.event === entry.event &&
			previous.actor === entry.actor &&
			previous.relation === entry.relation &&
			previous.failed === entry.failed &&
			previous.client === entry.client &&
			previous.ipAddress === entry.ipAddress
		)
			last.push(entry);
		else runs.push([entry]);
	}
	return runs.flatMap((run) =>
		run.length >= HISTORY_FOLD_MIN
			? [{ entries: run }]
			: run.map((entry) => ({ entries: [entry] }))
	);
}

// #endregion
