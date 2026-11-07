/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	AccountDesktop,
	AccountFailure,
	AccountRetentionNotice,
	AccountSecurity,
	AccountSession,
	AccountToken
} from '../../../../platform/account/common/accountProtocol.js';

/**
 * How a row's status reads at a glance. Shape carries the meaning, so colour is
 * never the only signal: filled is active, outlined is idle, dashed is off.
 */
export type StatusShape = 'active' | 'idle' | 'off' | 'attention' | 'failure';

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
	| 'failureInvalid';

const failureMessages: Readonly<Record<AccountFailure, FailureMessage>> = Object.freeze({
	unavailable: 'failureUnavailable',
	sessionEnded: 'failureSessionEnded',
	reauthenticationRequired: 'failureReauthentication',
	strongAuthenticationRequired: 'failureStrongAuthentication',
	denied: 'failureDenied',
	notFound: 'failureNotFound',
	unconfirmed: 'failureUnconfirmed',
	conflict: 'failureConflict',
	invalid: 'failureInvalid'
});

export function failureMessage(reason: AccountFailure): FailureMessage {
	return failureMessages[reason];
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

// #region Time

/** Whole calendar days from `time` to `now` in the local time zone: 0 is today, 1 is yesterday. */
export function calendarDaysBefore(time: number, now: number): number {
	const day = (value: number): number => {
		const date = new Date(value);
		return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	};
	return Math.round((day(now) - day(time)) / DAY);
}

export type RelativeDay = 'today' | 'yesterday' | 'other';

export function relativeDay(time: number, now: number): RelativeDay {
	const days = calendarDaysBefore(time, now);
	if (days === 0) return 'today';
	if (days === 1) return 'yesterday';
	return 'other';
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
	/** The record kind; notices carry identifiers, not exam titles, so the category names the record. */
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
	readonly shape: StatusShape;
	/** Present only while two-step verification is on. */
	readonly recovery?: { readonly remaining: number; readonly low: boolean };
}

export function twoStepPresentation(mfa: AccountSecurity['mfa']): TwoStepPresentation {
	if (mfa === undefined) return { status: 'notOffered', shape: 'off' };
	if (!mfa.available) return { status: 'serviceUnavailable', shape: 'attention' };
	if (mfa.recoveryRequired) return { status: 'recoveryRequired', shape: 'attention' };
	if (mfa.enabled) {
		const remaining = mfa.recoveryCodesRemaining;
		return {
			status: 'on',
			shape: 'active',
			recovery: { remaining, low: remaining <= RECOVERY_CODES_LOW }
		};
	}
	if (mfa.pending) return { status: 'pending', shape: 'attention' };
	return { status: 'off', shape: 'off' };
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

export interface SessionGroups {
	readonly current: AccountSession | undefined;
	readonly others: readonly AccountSession[];
}

export function groupSessions(sessions: readonly AccountSession[]): SessionGroups {
	return {
		current: sessions.find((session) => session.current),
		others: sessions.filter((session) => !session.current)
	};
}

/** The current desktop first, then the rest in server order. */
export function orderDesktops(desktops: readonly AccountDesktop[]): readonly AccountDesktop[] {
	return [
		...desktops.filter((desktop) => desktop.current),
		...desktops.filter((desktop) => !desktop.current)
	];
}

export function desktopShape(desktop: AccountDesktop): StatusShape {
	if (desktop.revoked) return 'off';
	return desktop.current ? 'active' : 'idle';
}

export type ClientKind = 'clientWeb' | 'clientDesktop' | 'clientCli' | 'clientOther';

export function clientKind(client: string): ClientKind {
	if (client === 'web') return 'clientWeb';
	if (client === 'desktop') return 'clientDesktop';
	if (client === 'cli') return 'clientCli';
	return 'clientOther';
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

export type TokenAction = 'disable' | 'enable' | 'revoke';

/** A disabled token can be turned back on until it expires; expired and revoked ones are records. */
export function tokenActions(state: TokenState): readonly TokenAction[] {
	if (state === 'active') return ['disable', 'revoke'];
	if (state === 'disabled') return ['enable', 'revoke'];
	return [];
}

export function tokenShape(state: TokenState): StatusShape {
	if (state === 'active') return 'active';
	if (state === 'disabled') return 'idle';
	return 'off';
}

export type TokenScopeMessage = 'scopeExaminationsRead';

/**
 * Scopes this window offers for a new token. The server contract publishes no
 * scope catalogue; it names only `examinations:read`, so that is the one offered.
 * The server still validates every requested scope against current authority.
 */
export const tokenScopeCatalog: readonly {
	readonly scope: string;
	readonly label: TokenScopeMessage;
}[] = Object.freeze([{ scope: 'examinations:read', label: 'scopeExaminationsRead' }]);

export function scopeLabel(scope: string): TokenScopeMessage | undefined {
	return tokenScopeCatalog.find((entry) => entry.scope === scope)?.label;
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
