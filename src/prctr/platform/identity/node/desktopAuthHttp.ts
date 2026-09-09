import type { CancellationToken } from '../../../base/common/cancellation.js';
import { DesktopAuthorizationError } from './desktopAuthorizationError.js';

export type DesktopHttpPath =
	| '/api/v1/auth/desktop/authorizations'
	| '/api/v1/auth/desktop/token'
	| '/api/v1/auth/refresh'
	| '/api/v1/auth/logout'
	| '/api/v1/users/me/context'
	| '/api/v1/users/me'
	| '/api/v1/authentication-methods'
	| '/api/v1/users/me/mfa'
	| '/api/v1/users/me/sessions'
	| '/api/v1/users/me/sessions/revoke'
	| '/api/v1/users/me/desktop-registrations'
	| `/api/v1/users/me/desktop-registrations/${string}`
	| `/api/v1/users/${string}/profile-picture`;
export interface DesktopPhotoRequest {
	readonly operation: 'GET' | 'PUT' | 'DELETE';
	readonly bytes?: Uint8Array;
	readonly mediaType?: string;
	readonly etag?: string;
}
export function desktopHttpMethod(
	path: DesktopHttpPath,
	photo?: DesktopPhotoRequest
): 'GET' | 'POST' | 'DELETE' | 'PUT' {
	if (/^\/api\/v1\/users\/[ybndrfg8ejkmcpqxot1uwisza345h769]{26}\/profile-picture$/u.test(path))
		return photo?.operation ?? 'GET';
	if (photo) throw new DesktopAuthorizationError('rejected');
	if (
		/^\/api\/v1\/users\/me\/desktop-registrations\/[ybndrfg8ejkmcpqxot1uwisza345h769]{26}$/u.test(
			path
		)
	)
		return 'DELETE';
	if (
		[
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
			'/api/v1/users/me/sessions/revoke'
		].includes(path)
	)
		return 'POST';
	throw new DesktopAuthorizationError('rejected');
}
export interface DesktopHttpResult {
	readonly status: number;
	readonly value: unknown;
	readonly nonce?: string;
}
/** Private to identity: callers choose only fixed contract paths; no renderer request surface. */
export class DesktopAuthHttp {
	constructor(private readonly fetcher: typeof fetch = fetch) {}
	async request(
		origin: string,
		path: DesktopHttpPath,
		token: CancellationToken,
		options: {
			readonly body?: unknown;
			readonly proof?: string;
			readonly credential?: string;
			readonly photo?: DesktopPhotoRequest;
		} = {}
	): Promise<DesktopHttpResult> {
		const method = desktopHttpMethod(path, options.photo);
		const url = new URL(path, origin);
		if (url.origin !== origin) throw new DesktopAuthorizationError('rejected');
		if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
		const controller = new AbortController();
		const cancellation = token.onCancellationRequested(() => controller.abort());
		const timer = setTimeout(() => controller.abort(), 15000);
		try {
			const response = await this.fetcher(url.href, {
				method,
				headers: {
					Accept: options.photo?.operation === 'GET' ? 'image/webp' : 'application/json',
					...(options.photo?.mediaType
						? { 'Content-Type': options.photo.mediaType }
						: {}),
					...(options.photo?.etag ? { 'If-Match': options.photo.etag } : {}),
					...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
					...(options.proof ? { DPoP: options.proof } : {}),
					...(options.credential ? { Authorization: `DPoP ${options.credential}` } : {})
				},
				...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
				...(options.photo?.bytes ? { body: Buffer.from(options.photo.bytes) } : {}),
				redirect: 'manual',
				credentials: 'omit',
				cache: 'no-store',
				signal: controller.signal
			});
			if (
				response.redirected ||
				(response.url && response.url !== url.href) ||
				(response.status >= 300 && response.status < 400)
			) {
				await response.body?.cancel();
				throw new DesktopAuthorizationError('rejected');
			}
			const nonce = response.headers.get('DPoP-Nonce');
			if (nonce !== null && !/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
				await response.body?.cancel();
				throw new DesktopAuthorizationError('rejected');
			}
			let value: unknown;
			if (options.photo?.operation === 'GET' && response.status === 200) {
				if (response.headers.get('content-type') !== 'image/webp' || !response.body) {
					await response.body?.cancel();
					throw new DesktopAuthorizationError('rejected');
				}
				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let length = 0;
				try {
					for (;;) {
						const next = await reader.read();
						if (next.done) break;
						length += next.value.byteLength;
						if (length > 2 * 1024 * 1024)
							throw new DesktopAuthorizationError('rejected');
						chunks.push(next.value);
					}
				} finally {
					await reader.cancel().catch(() => {});
					reader.releaseLock();
				}
				const bytes = Buffer.concat(chunks);
				if (
					bytes.toString('ascii', 0, 4) !== 'RIFF' ||
					bytes.toString('ascii', 8, 12) !== 'WEBP'
				)
					throw new DesktopAuthorizationError('rejected');
				value = {
					kind: 'photo',
					dataUrl: `data:image/webp;base64,${bytes.toString('base64')}`,
					etag: response.headers.get('ETag')
				};
			} else if (response.status === 204) {
				await response.body?.cancel();
				value = undefined;
			} else {
				if (
					!/^application\/(?:json|problem\+json)(?:\s*;|$)/i.test(
						response.headers.get('content-type') ?? ''
					) ||
					!response.body
				) {
					await response.body?.cancel();
					throw new DesktopAuthorizationError('rejected');
				}
				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let length = 0;
				try {
					for (;;) {
						const next = await reader.read();
						if (next.done) break;
						length += next.value.byteLength;
						if (length > 65536) throw new DesktopAuthorizationError('rejected');
						chunks.push(next.value);
					}
					value = JSON.parse(
						new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
					);
				} finally {
					await reader.cancel().catch(() => undefined);
					reader.releaseLock();
				}
			}
			return { status: response.status, value, ...(nonce === null ? {} : { nonce }) };
		} catch (error) {
			if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
			if (error instanceof DesktopAuthorizationError) throw error;
			throw new DesktopAuthorizationError('verificationRequired');
		} finally {
			clearTimeout(timer);
			cancellation.dispose();
		}
	}
}
