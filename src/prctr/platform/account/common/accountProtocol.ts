import type { ObservableApiCapability } from '../../serverApi/common/apiObservation.js';
export const ACCOUNT_CHANNEL = 'prctr:authenticated:account';
export const accountSections = ['profile', 'security', 'sessions', 'desktops'] as const;
export type AccountSection = (typeof accountSections)[number];
export type AccountIntent =
	| { readonly kind: 'read'; readonly section: AccountSection }
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
	| { readonly kind: 'revokeDesktop'; readonly id: string };
export interface AccountProfile {
	readonly username: string;
	readonly displayName: string;
	readonly firstName: string;
	readonly lastName: string;
	readonly email?: string;
	readonly emailVerified?: boolean;
	readonly locale?: string;
	readonly timezone?: string;
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
export type AccountData =
	| { readonly section: 'profile'; readonly profile: AccountProfile }
	| { readonly section: 'security'; readonly security: AccountSecurity }
	| { readonly section: 'sessions'; readonly sessions: readonly AccountSession[] }
	| { readonly section: 'desktops'; readonly desktops: readonly AccountDesktop[] };
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
	| { readonly kind: 'success' }
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
	if (input.kind === 'openSecurity' && Object.keys(input).length === 1)
		return Object.freeze({ kind: 'openSecurity' });
	if (Object.keys(input).length !== 2) throw new TypeError('Invalid account action');
	if (input.kind === 'read' && accountSections.includes(input.section as AccountSection))
		return Object.freeze({ kind: 'read', section: input.section as AccountSection });
	if (input.kind === 'revokeSession' || input.kind === 'revokeDesktop')
		return Object.freeze({ kind: input.kind, id: accountId(input.id) });
	throw new TypeError('Invalid account action');
}
export function validateAccountResponse(value: unknown): AccountResponse {
	const input = accountRecord(value);
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
				...(p.timezone === undefined ? {} : { timezone: accountText(p.timezone, 128) })
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
								recoveryCodesRemaining: accountTime(m.recoveryCodesRemaining)
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
