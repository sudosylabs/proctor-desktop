import { ServerHttpTransport, decodeJson } from '../../serverApi/node/serverHttpTransport.js';
import { ServerApiError } from '../../serverApi/common/serverApi.js';
import type { CancellationToken } from '../../../base/common/cancellation.js';
import { DesktopAuthorizationError } from './desktopAuthorizationError.js';

export type DesktopHttpPath =
	| `/api/v1/users/me/exam-activity?limit=20${string}`
	| `/api/v1/exam-attempts/${string}/result`
	| '/api/v1/auth/desktop/authorizations'
	| '/api/v1/auth/desktop/token'
	| '/api/v1/auth/refresh'
	| '/api/v1/auth/logout'
	| '/api/v1/users/me/settings'
	| '/api/v1/users/me/context'
	| '/api/v1/users/me'
	| '/api/v1/authentication-methods'
	| '/api/v1/users/me/mfa'
	| '/api/v1/users/me/sessions'
	| '/api/v1/users/me/sessions/revoke'
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
		[
			'/api/v1/users/me/retention-notices?limit=200',
			'/api/v1/users/me/context',
			'/api/v1/users/me',
			'/api/v1/authentication-methods',
			'/api/v1/users/me/mfa',
			'/api/v1/users/me/sessions',
			'/api/v1/users/me/desktop-registrations'
		].includes(path)
	)
		return 'GET';
	if (
		[
			'/api/v1/auth/desktop/authorizations',
			'/api/v1/auth/desktop/token',
			'/api/v1/auth/refresh',
			'/api/v1/auth/logout',
			'/api/v1/users/me/sessions/revoke',
			'/api/v1/auth/email-verification/request'
		].includes(path)
	)
		return 'POST';
	throw new DesktopAuthorizationError('rejected');
}
export interface DesktopHttpResult {
	/** Privileged-only failure metadata; renderer projections never carry this field. */
	readonly failure?: ServerApiError;
	readonly status: number;
	readonly value: unknown;
	readonly nonce?: string;
}
/** Compatibility for the authentication handshake; all I/O belongs to ServerHttpTransport. */
export class DesktopAuthHttp {
	readonly transport: ServerHttpTransport;
	constructor(fetcher: typeof fetch = fetch) {
		this.transport = new ServerHttpTransport(fetcher);
	}
	async request(
		origin: string,
		path: DesktopHttpPath,
		token: CancellationToken,
		options: {
			readonly body?: unknown;
			readonly proof?: string;
			readonly credential?: string;
			readonly photo?: DesktopPhotoRequest;
			readonly settings?: DesktopSettingsRequest;
		} = {}
	): Promise<DesktopHttpResult> {
		const method = desktopHttpMethod(
			path,
			options.photo,
			options.settings,
			options.body !== undefined
		);
		const url = new URL(path, origin);
		if (url.origin !== origin) throw new DesktopAuthorizationError('rejected');
		const controller = new AbortController();
		const cancellation = token.onCancellationRequested(() => controller.abort());
		if (token.isCancellationRequested) controller.abort();
		try {
			const response = await this.transport.send({
				url: url.href,
				method,
				signal: controller.signal,
				maxResponseBytes:
					options.photo || options.settings
						? 2 * 1024 * 1024
						: path.startsWith('/api/v1/users/me/exam-activity?')
							? 512 * 1024
							: 65536,
				headers: {
					Accept: options.photo?.operation === 'GET' ? 'image/webp' : 'application/json',
					...(options.photo?.mediaType
						? { 'Content-Type': options.photo.mediaType }
						: {}),
					...(options.photo?.etag ? { 'If-Match': options.photo.etag } : {}),
					...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
					...(options.settings?.idempotencyKey
						? { 'Idempotency-Key': options.settings.idempotencyKey }
						: {}),
					...(options.proof ? { DPoP: options.proof } : {}),
					...(options.credential ? { Authorization: `DPoP ${options.credential}` } : {})
				},
				...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
				...(options.photo?.bytes ? { body: Buffer.from(options.photo.bytes) } : {})
			});
			const nonce = response.headers['dpop-nonce'];
			if (nonce && !/^[A-Za-z0-9_-]{43}$/u.test(nonce))
				throw new DesktopAuthorizationError('rejected');
			let value: unknown;
			if (options.photo?.operation === 'GET' && response.status === 200) {
				const bytes = Buffer.from(response.bytes);
				if (
					response.headers['content-type'] !== 'image/webp' ||
					bytes.toString('ascii', 0, 4) !== 'RIFF' ||
					bytes.toString('ascii', 8, 12) !== 'WEBP'
				)
					throw new DesktopAuthorizationError('rejected');
				value = {
					kind: 'photo',
					dataUrl: `data:image/webp;base64,${bytes.toString('base64')}`,
					etag: response.headers.etag
				};
			} else if (response.status !== 204) value = decodeJson(response);
			return { status: response.status, value, ...(nonce ? { nonce } : {}) };
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
}
