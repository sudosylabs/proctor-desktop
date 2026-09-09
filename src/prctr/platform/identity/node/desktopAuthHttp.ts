import type { CancellationToken } from '../../../base/common/cancellation.js';
import { DesktopAuthorizationError } from './desktopAuthorizationError.js';

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
		path:
			| '/api/v1/auth/desktop/authorizations'
			| '/api/v1/auth/desktop/token'
			| '/api/v1/auth/refresh'
			| '/api/v1/auth/logout'
			| '/api/v1/users/me/context',
		token: CancellationToken,
		options: {
			readonly body?: unknown;
			readonly proof?: string;
			readonly credential?: string;
		} = {}
	): Promise<DesktopHttpResult> {
		const url = new URL(path, origin);
		if (url.origin !== origin) throw new DesktopAuthorizationError('rejected');
		if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
		const controller = new AbortController();
		const cancellation = token.onCancellationRequested(() => controller.abort());
		const timer = setTimeout(() => controller.abort(), 15000);
		try {
			const response = await this.fetcher(url.href, {
				method: path === '/api/v1/users/me/context' ? 'GET' : 'POST',
				headers: {
					Accept: 'application/json',
					...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
					...(options.proof ? { DPoP: options.proof } : {}),
					...(options.credential ? { Authorization: `DPoP ${options.credential}` } : {})
				},
				...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
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
			if (response.status === 204) {
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
