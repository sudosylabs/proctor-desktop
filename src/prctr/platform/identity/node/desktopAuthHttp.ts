import type { ServerApiError } from '../../serverApi/common/serverApi.js';
import type { DesktopExchangeResult } from './desktopAuthProtocol.js';
import { DesktopAuthorizationError } from './desktopAuthorizationError.js';

export type DesktopHttpPath =
	| `/api/v1/users/me/exam-activity?limit=20${string}`
	| `/api/v1/exam-attempts/${string}/result`
	| '/api/v1/auth/desktop/authorizations'
	| '/api/v1/auth/desktop/token'
	| '/api/v1/auth/desktop/reauthentications'
	| '/api/v1/auth/desktop/reauthentications/complete'
	| '/api/v1/auth/refresh'
	| '/api/v1/auth/logout'
	| '/api/v1/users/me/settings'
	| '/api/v1/users/me/context'
	| '/api/v1/users/me'
	| '/api/v1/authentication-methods'
	| '/api/v1/users/me/mfa'
	| '/api/v1/users/me/sessions'
	| '/api/v1/users/me/sessions/revoke'
	| '/api/v1/users/me/sessions/revoke-others'
	| `/api/v1/users/me/audits?limit=${number}${string}`
	| '/api/v1/users/me/tokens/grantable-scopes'
	| '/api/v1/users/me/desktop-registrations'
	| `/api/v1/users/me/desktop-registrations/${string}`
	| '/api/v1/users/me/tokens'
	| `/api/v1/users/me/tokens/${string}`
	| '/api/v1/users/me/retention-notices?limit=200'
	| '/api/v1/auth/email-verification/request'
	| `/api/v1/users/${string}/profile-picture`;
export interface DesktopSettingsRequest {
	readonly operation: 'GET' | 'PUT';
	readonly idempotencyKey?: string;
}
export interface DesktopPhotoRequest {
	readonly operation: 'GET' | 'PUT' | 'DELETE';
	readonly bytes?: Uint8Array;
	readonly mediaType?: string;
	readonly etag?: string;
}
export function desktopHttpMethod(
	path: DesktopHttpPath,
	photo?: DesktopPhotoRequest,
	settings?: DesktopSettingsRequest,
	body = false
): 'GET' | 'POST' | 'DELETE' | 'PUT' {
	const method = desktopHttpRoute(path, photo, settings, body);
	if (body && (method === 'GET' || method === 'DELETE'))
		throw new DesktopAuthorizationError('rejected');
	return method;
}
function desktopHttpRoute(
	path: DesktopHttpPath,
	photo: DesktopPhotoRequest | undefined,
	settings: DesktopSettingsRequest | undefined,
	body: boolean
): 'GET' | 'POST' | 'DELETE' | 'PUT' {
	if (settings) {
		if (
			path !== '/api/v1/users/me/settings' ||
			photo ||
			(settings.operation !== 'GET' && settings.operation !== 'PUT')
		)
			throw new DesktopAuthorizationError('rejected');
		if (
			settings.operation === 'PUT' &&
			!/^[A-Za-z0-9._~-]{1,128}$/u.test(settings.idempotencyKey ?? '')
		)
			throw new DesktopAuthorizationError('rejected');
		return settings.operation;
	}
	if (/^\/api\/v1\/users\/[ybndrfg8ejkmcpqxot1uwisza345h769]{26}\/profile-picture$/u.test(path))
		return photo?.operation ?? 'GET';
	if (photo) throw new DesktopAuthorizationError('rejected');
	if (/^\/api\/v1\/exam-attempts\/[ybndrfg8ejkmcpqxot1uwisza345h769]{26}\/result$/u.test(path))
		return 'GET';
	if (
		/^\/api\/v1\/users\/me\/exam-activity\?limit=20(?:&cursor=(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-F]{2}){1,6144})?$/u.test(
			path
		)
	)
		return 'GET';
	if (
		/^\/api\/v1\/users\/me\/desktop-registrations\/[ybndrfg8ejkmcpqxot1uwisza345h769]{26}$/u.test(
			path
		)
	)
		return 'DELETE';
	if (/^\/api\/v1\/users\/me\/tokens\/[ybndrfg8ejkmcpqxot1uwisza345h769]{26}$/u.test(path))
		return 'DELETE';
	if (
		/^\/api\/v1\/users\/me\/tokens\/[ybndrfg8ejkmcpqxot1uwisza345h769]{26}\/(?:disable|enable)$/u.test(
			path
		)
	)
		return 'POST';
	if (path === '/api/v1/users/me/tokens') return body ? 'POST' : 'GET';
	if (
		/^\/api\/v1\/users\/me\/audits\?limit=(?:[1-9]|10)(?:&(?:created_after|created_before|event|status|relation|order|cursor)=(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-F]{2}){1,2048}){0,70}$/u.test(
			path
		)
	)
		return 'GET';
	if (
		[
			'/api/v1/users/me/retention-notices?limit=200',
			'/api/v1/users/me/context',
			'/api/v1/users/me',
			'/api/v1/authentication-methods',
			'/api/v1/users/me/mfa',
			'/api/v1/users/me/sessions',
			'/api/v1/users/me/desktop-registrations',
			'/api/v1/users/me/tokens/grantable-scopes'
		].includes(path)
	)
		return 'GET';
	if (
		[
			'/api/v1/auth/desktop/authorizations',
			'/api/v1/auth/desktop/token',
			'/api/v1/auth/desktop/reauthentications',
			'/api/v1/auth/desktop/reauthentications/complete',
			'/api/v1/auth/refresh',
			'/api/v1/auth/logout',
			'/api/v1/users/me/sessions/revoke',
			'/api/v1/users/me/sessions/revoke-others',
			'/api/v1/auth/email-verification/request'
		].includes(path)
	)
		return 'POST';
	throw new DesktopAuthorizationError('rejected');
}
export interface DesktopHttpResult extends DesktopExchangeResult {
	/** Privileged-only failure metadata; renderer projections never carry this field. */
	readonly failure?: ServerApiError;
}
