import { ServerHttpTransport } from '../../serverApi/node/serverHttpTransport.js';
import { decodeJsonBody } from '../../serverApi/node/responseDecoding.js';
import { ServerApiError } from '../../serverApi/common/serverApi.js';
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
	private readonly transport: ServerHttpTransport;
	constructor(
		request: typeof fetch | ServerHttpTransport = fetch,
		private readonly timeoutMs = 10_000
	) {
		this.transport =
			request instanceof ServerHttpTransport ? request : new ServerHttpTransport(request);
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
		try {
			const response = await this.transport.send({
				url,
				method: 'GET',
				headers: { Accept: 'application/json' },
				signal: controller.signal,
				timeoutMs: this.timeoutMs,
				maxResponseBytes: MAX_RESPONSE_BYTES
			});
			if (response.status !== 200) return failure('unreachable');
			return { ok: true, value: decodeJsonBody(response) };
		} catch (error) {
			return failure(
				error instanceof ServerApiError
					? error.kind === 'redirectBlocked'
						? 'redirectBlocked'
						: error.kind === 'timeout'
							? 'timedOut'
							: error.kind === 'invalidResponse'
								? 'invalidResponse'
								: 'unreachable'
					: 'unreachable'
			);
		} finally {
			subscription.dispose();
		}
	}
}

function failure(reason: PublicRequestFailure): PublicReadinessResponse {
	return { ok: false, reason };
}
