import { DesktopAuthorizationError } from './desktopAuthorizationError.js';
import type { DesktopHttpResult } from './desktopAuthHttp.js';
export interface DesktopTokens {
	readonly principalId: string;
	readonly sessionId: string;
	readonly registrationId: string;
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly accessExpiresAt: number;
	readonly refreshExpiresAt: number;
	readonly nonce: string;
}
export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new DesktopAuthorizationError('rejected');
	return value as Record<string, unknown>;
}
export function boundedText(value: unknown, max = 2048): string {
	if (
		typeof value !== 'string' ||
		!value.length ||
		value.length > max ||
		/[\u0000-\u001f\u007f]/.test(value)
	)
		throw new DesktopAuthorizationError('rejected');
	return value;
}
export function identifier(value: unknown): string {
	const text = boundedText(value, 26);
	if (!/^[a-z0-9]{26}$/.test(text)) throw new DesktopAuthorizationError('rejected');
	return text;
}
export function credential(value: unknown): string {
	const text = boundedText(value, 43);
	if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw new DesktopAuthorizationError('rejected');
	return text;
}
/** Reads a server RFC 3339 UTC instant as epoch milliseconds that is still in the future. */
export function expiry(value: unknown): number {
	if (typeof value !== 'string' || value.length > 40 || !/Z$/u.test(value))
		throw new DesktopAuthorizationError('rejected');
	const time = Date.parse(value);
	if (!Number.isSafeInteger(time) || time <= Date.now() || time > 8.64e15)
		throw new DesktopAuthorizationError('rejected');
	return time;
}
export function errorCode(result: DesktopHttpResult): string | undefined {
	if (!result.value || typeof result.value !== 'object') return undefined;
	const error = result.value as Record<string, unknown>;
	return typeof error.code === 'string' ? error.code : undefined;
}
/**
 * Reads issued tokens. The server may omit `DPoP-Nonce` on success; the nonce the request just
 * used was accepted, so it stays current until a challenge says otherwise.
 */
export function parseTokens(result: DesktopHttpResult, requestNonce: string): DesktopTokens {
	if (result.status !== 200) throw new DesktopAuthorizationError('rejected');
	const body = record(result.value);
	const session = record(body.session);
	const tokens = record(body.tokens);
	if (
		session.client_type !== 'desktop' ||
		session.mfa_recovery_required !== false ||
		session.revoked_at ||
		tokens.token_type !== 'DPoP'
	)
		throw new DesktopAuthorizationError('rejected');
	return Object.freeze({
		principalId: identifier(session.user_id),
		sessionId: identifier(session.id),
		registrationId: identifier(session.desktop_registration_id),
		accessToken: credential(tokens.access_token),
		refreshToken: credential(tokens.refresh_token),
		accessExpiresAt: expiry(tokens.access_expires_at),
		refreshExpiresAt: expiry(tokens.refresh_expires_at),
		nonce: credential(result.nonce ?? requestNonce)
	});
}
