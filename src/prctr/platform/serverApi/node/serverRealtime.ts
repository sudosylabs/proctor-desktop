import WebSocket from 'ws';
import { ServerApiError } from '../common/serverApi.js';

export type RealtimeMessage =
	| {
			readonly event: string;
			readonly sequence: number;
			readonly id: string;
			readonly data?: unknown;
			readonly [key: string]: unknown;
	  }
	| {
			readonly status: 'ok' | 'error';
			readonly sequence: number;
			readonly data?: unknown;
			readonly error?: {
				readonly code: string;
				readonly message: string;
				readonly [key: string]: unknown;
			};
			readonly [key: string]: unknown;
	  };
export interface RealtimeRequest {
	readonly sequence: number;
	readonly action: string;
	readonly data?: unknown;
}
export interface ApiRealtimeConnection {
	send(request: RealtimeRequest): void;
	dispose(): void;
}
export type ConnectionAuthorizer = (
	url: string,
	challenge?: { readonly status: number; readonly nonce?: string }
) => Promise<Readonly<Record<string, string>>>;

/** Transport ownership only. Attempt services own replay, commands and participation semantics. */
export async function connectServerRealtime(
	url: string,
	authorize: ConnectionAuthorizer,
	signal: AbortSignal,
	onMessage: (message: RealtimeMessage) => void,
	onClose: (error: ServerApiError | undefined) => void
): Promise<ApiRealtimeConnection> {
	let challenge: { status: number; nonce?: string } | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (signal.aborted) throw new ServerApiError('cancelled');
		const headers = await authorize(url, challenge);
		if (signal.aborted) throw new ServerApiError('cancelled');
		const target = new URL(url);
		target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(target, {
			headers,
			followRedirects: false,
			handshakeTimeout: 15_000,
			maxPayload: 256 * 1024,
			perMessageDeflate: false
		});
		const abort = () => socket.terminate();
		signal.addEventListener('abort', abort, { once: true });
		let opened = false;
		let ended = false;
		let failed: ServerApiError | undefined;
		socket.on('error', () => {
			failed = new ServerApiError('network');
		});
		socket.on('close', (code) => {
			signal.removeEventListener('abort', abort);
			if (opened && !ended)
				onClose(
					signal.aborted
						? new ServerApiError('cancelled')
						: (failed ??
								(code === 4001
									? new ServerApiError('sessionEnded')
									: code === 4003
										? new ServerApiError('server', 403)
										: code === 4004
											? new ServerApiError('server', 429)
											: code === 1000
												? undefined
												: new ServerApiError('network')))
				);
		});
		// Install before awaiting open: a hello can arrive in the same network read as the upgrade.
		socket.on('message', (bytes, binary) => {
			if (ended || signal.aborted) return;
			try {
				if (binary) throw new Error('Expected JSON envelope');
				const value: unknown = JSON.parse(
					new TextDecoder('utf-8', { fatal: true }).decode(
						Buffer.isBuffer(bytes)
							? bytes
							: bytes instanceof ArrayBuffer
								? new Uint8Array(bytes)
								: Buffer.concat(bytes)
					)
				);
				if (!value || typeof value !== 'object' || Array.isArray(value))
					throw new Error('Invalid envelope');
				const message = value as Record<string, unknown>;
				if (!Number.isSafeInteger(message.sequence) || Number(message.sequence) < 0)
					throw new Error('Invalid sequence');
				if ('event' in message) {
					if (
						typeof message.event !== 'string' ||
						!/^[A-Za-z0-9_.:-]{1,128}$/u.test(message.event) ||
						typeof message.id !== 'string'
					)
						throw new Error('Invalid event');
				} else {
					if (message.status !== 'ok' && message.status !== 'error')
						throw new Error('Invalid result');
					if (message.error !== undefined) {
						const error = message.error;
						if (
							!error ||
							typeof error !== 'object' ||
							Array.isArray(error) ||
							!('code' in error) ||
							typeof error.code !== 'string' ||
							!('message' in error) ||
							typeof error.message !== 'string'
						)
							throw new Error('Invalid result error');
					}
					if (message.status === 'error' && message.error === undefined)
						throw new Error('Missing result error');
				}
				onMessage(message as RealtimeMessage);
			} catch {
				failed = new ServerApiError('invalidResponse');
				socket.terminate();
			}
		});
		const outcome = await new Promise<'open' | 'challenge'>((resolve, reject) => {
			socket.once('open', () => {
				opened = true;
				resolve('open');
			});
			socket.once('error', () =>
				reject(new ServerApiError(signal.aborted ? 'cancelled' : 'network'))
			);
			socket.once('unexpected-response', (_request, response) => {
				const status = response.statusCode ?? 0;
				const nonce = response.headers['dpop-nonce'];
				response.destroy();
				if (
					status === 401 &&
					typeof nonce === 'string' &&
					/^[A-Za-z0-9_-]{43}$/u.test(nonce) &&
					attempt === 0
				) {
					challenge = { status, nonce };
					resolve('challenge');
				} else
					reject(
						new ServerApiError(
							status >= 300 && status < 400 ? 'redirectBlocked' : 'server',
							status
						)
					);
				socket.terminate();
			});
		});
		if (outcome === 'challenge') continue;
		return {
			send(request) {
				if (ended || signal.aborted || socket.readyState !== WebSocket.OPEN)
					throw new ServerApiError('sessionEnded');
				if (
					!Number.isSafeInteger(request.sequence) ||
					request.sequence < 1 ||
					!/^[A-Za-z0-9_.:-]{1,128}$/u.test(request.action)
				)
					throw new ServerApiError('invalidRequest');
				const data = JSON.stringify(request);
				if (Buffer.byteLength(data) > 256 * 1024 || socket.bufferedAmount > 1024 * 1024)
					throw new ServerApiError('invalidRequest');
				socket.send(data);
			},
			dispose() {
				if (ended) return;
				ended = true;
				signal.removeEventListener('abort', abort);
				socket.terminate();
			}
		};
	}
	throw new ServerApiError('server', 401);
}
