import type { CancellationToken } from '../../../base/common/cancellation.js';
import {
	normalizeServerOrigin,
	validateDesktopReleaseTarget,
	type DesktopReleaseTarget,
	type PublicReadinessResponse,
	type PublicRequestFailure,
	type ServerReadinessProbe,
	type ServerReadinessTransport
} from './serverReadiness.js';

const MAX_RESPONSE_BYTES = 64 * 1024;

/** Public requests only: no credentials, cookies, redirects, retry loop, or arbitrary request API. */
export class HttpServerReadinessTransport implements ServerReadinessTransport {
	constructor(
		private readonly request: typeof fetch = fetch,
		private readonly timeoutMs = 10_000
	) {
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
			throw new TypeError('Invalid readiness deadline');
	}

	async probe(
		origin: string,
		target: DesktopReleaseTarget,
		token: CancellationToken
	): Promise<ServerReadinessProbe> {
		if (normalizeServerOrigin(origin, true) !== origin)
			throw new TypeError('Readiness requires a normalized origin');
		validateDesktopReleaseTarget(target);
		const ping = new URL('/api/v1/system/ping', origin);
		ping.searchParams.set('desktop_release', target.release);
		ping.searchParams.set('desktop_build_id', target.buildId);
		ping.searchParams.set('platform', target.platform);
		ping.searchParams.set('architecture', target.architecture);
		ping.searchParams.set('realtime_protocol', String(target.realtimeProtocol));
		const [system, discovery] = await Promise.all([
			this.#read(ping.href, token),
			this.#read(new URL('/api/v1/discovery', origin).href, token)
		]);
		return { system, discovery };
	}

	async #read(url: string, token: CancellationToken): Promise<PublicReadinessResponse> {
		const controller = new AbortController();
		const subscription = token.onCancellationRequested(() => controller.abort());
		if (token.isCancellationRequested) controller.abort();
		let timedOut = false;
		const deadline = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, this.timeoutMs);
		try {
			const response = await this.request(url, {
				method: 'GET',
				headers: { Accept: 'application/json' },
				credentials: 'omit',
				redirect: 'manual',
				cache: 'no-store',
				signal: controller.signal
			});
			if (
				response.redirected ||
				(response.status >= 300 && response.status < 400) ||
				(response.url && response.url !== url)
			) {
				await response.body?.cancel();
				return failure('redirectBlocked');
			}
			if (response.status !== 200) {
				await response.body?.cancel();
				return failure('unreachable');
			}
			if (
				!/^application\/json(?:\s*;|$)/iu.test(
					response.headers.get('content-type') ?? ''
				) ||
				response.body === null
			) {
				await response.body?.cancel();
				return failure('invalidResponse');
			}
			const declaredLength = response.headers.get('content-length');
			if (
				declaredLength !== null &&
				(!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)
			) {
				await response.body.cancel();
				return failure('invalidResponse');
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder('utf-8', { fatal: true });
			let bytes = 0;
			let json = '';
			try {
				for (;;) {
					const chunk = await reader.read();
					if (chunk.done) break;
					bytes += chunk.value.byteLength;
					if (bytes > MAX_RESPONSE_BYTES) return failure('invalidResponse');
					try {
						json += decoder.decode(chunk.value, { stream: true });
					} catch {
						return failure('invalidResponse');
					}
				}
				try {
					json += decoder.decode();
					return { ok: true, value: JSON.parse(json) as unknown };
				} catch {
					return failure('invalidResponse');
				}
			} finally {
				await reader.cancel().catch(() => undefined);
				reader.releaseLock();
			}
		} catch {
			return failure(timedOut ? 'timedOut' : 'unreachable');
		} finally {
			clearTimeout(deadline);
			subscription.dispose();
		}
	}
}

function failure(reason: PublicRequestFailure): PublicReadinessResponse {
	return { ok: false, reason };
}
