import { ServerApiError } from '../common/serverApi.js';

export interface HttpRequest {
	readonly url: string;
	readonly method: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: NonNullable<Parameters<typeof fetch>[1]>['body'];
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
}
export interface HttpResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly bytes: Uint8Array;
}

/** The single HTTP execution boundary. No redirects, cookies, implicit retries or ambient cache. */
export class ServerHttpTransport {
	constructor(private readonly fetcher: typeof fetch = fetch) {}
	async send(request: HttpRequest): Promise<HttpResponse> {
		let url: URL;
		try {
			url = new URL(request.url);
		} catch {
			throw new ServerApiError('invalidRequest');
		}
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
			throw new ServerApiError('invalidRequest');
		const timeoutMs = request.timeoutMs ?? 15_000;
		const limit = request.maxResponseBytes ?? 2 * 1024 * 1024;
		if (
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			!Number.isSafeInteger(timeoutMs) ||
			timeoutMs < 1 ||
			timeoutMs > 2147483647
		)
			throw new ServerApiError('invalidRequest');
		if (request.signal?.aborted) throw new ServerApiError('cancelled');
		const controller = new AbortController();
		const cancel = () => controller.abort();
		request.signal?.addEventListener('abort', cancel, { once: true });
		let timedOut = false;
		const deadline = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		try {
			const response = await this.fetcher(url.href, {
				method: request.method,
				headers: request.headers,
				body: request.body,
				redirect: 'manual',
				credentials: 'omit',
				cache: 'no-store',
				signal: controller.signal
			});
			if (
				response.redirected ||
				(response.url && response.url !== url.href) ||
				(response.status >= 300 && response.status < 400 && response.status !== 304)
			) {
				await response.body?.cancel();
				throw new ServerApiError('redirectBlocked');
			}
			const length = response.headers.get('content-length');
			if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit)) {
				await response.body?.cancel();
				throw new ServerApiError('invalidResponse');
			}
			const chunks: Uint8Array[] = [];
			let size = 0;
			if (response.body) {
				const reader = response.body.getReader();
				try {
					for (;;) {
						const chunk = await reader.read();
						if (chunk.done) break;
						size += chunk.value.byteLength;
						if (size > limit) throw new ServerApiError('invalidResponse');
						chunks.push(chunk.value);
					}
				} finally {
					await reader.cancel().catch(() => {});
					reader.releaseLock();
				}
			}
			if (request.signal?.aborted) throw new ServerApiError('cancelled');
			if (timedOut) throw new ServerApiError('timeout');
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return {
				status: response.status,
				headers: Object.freeze(Object.fromEntries(response.headers)),
				bytes
			};
		} catch (error) {
			if (request.signal?.aborted) throw new ServerApiError('cancelled');
			if (timedOut) throw new ServerApiError('timeout');
			if (error instanceof ServerApiError) throw error;
			throw new ServerApiError('network');
		} finally {
			clearTimeout(deadline);
			request.signal?.removeEventListener('abort', cancel);
		}
	}
}

export function decodeJson(response: HttpResponse): unknown {
	if (
		!/^application\/(?:json|problem\+json)(?:\s*;|$)/iu.test(
			response.headers['content-type'] ?? ''
		)
	)
		throw new ServerApiError('invalidResponse');
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
	} catch {
		throw new ServerApiError('invalidResponse');
	}
}
