/*---------------------------------------------------------------------------------------------
 * Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import { createServer, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CancellationToken } from '../../../base/common/cancellation.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import { DesktopAuthorizationError } from './desktopAuthorizationError.js';

/** Trusted, localized HTML supplied by the owning presentation composition. */
export interface LoopbackCallbackPages {
	readonly received: string;
	readonly invalid: string;
	readonly expired: string;
	readonly styleHash: string;
}

/** Exact, single-use callback owned by one privileged authorization transaction. */
export class LoopbackAuthServer {
	readonly #server: Server;
	readonly #path = `/${randomBytes(32).toString('base64url')}`;
	readonly #result: Promise<string>;
	#resolve!: (code: string) => void;
	#reject!: (error: DesktopAuthorizationError) => void;
	#settled = false;
	#stopped = false;
	#stop: Promise<void> | undefined;
	#callbackURL: string | undefined;
	#cancellation: IDisposable | undefined;
	#deadline: ReturnType<typeof setTimeout> | undefined;

	private constructor(
		private readonly state: string,
		private readonly pages: LoopbackCallbackPages
	) {
		this.#result = new Promise<string>((resolve, reject) => {
			this.#resolve = resolve;
			this.#reject = reject;
		});
		// A browser can return while its opener is still resolving.
		void this.#result.catch(() => undefined);
		this.#server = createServer(
			{ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 },
			(request, response) => {
				const finish = (status: number, text = this.pages.invalid): void => {
					response.writeHead(status, {
						'Content-Type': 'text/html; charset=utf-8',
						'Cache-Control': 'no-store',
						'Content-Security-Policy': `default-src 'none'; style-src 'sha256-${this.pages.styleHash}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
						'Referrer-Policy': 'no-referrer',
						'X-Content-Type-Options': 'nosniff',
						Connection: 'close'
					});
					response.end(text);
				};
				if (!this.#callbackURL || this.#settled || this.#stopped) {
					finish(410, this.pages.expired);
					return;
				}
				if (request.method !== 'GET') {
					finish(405);
					return;
				}
				const expected = new URL(this.#callbackURL);
				if (
					request.headers.host !== expected.host ||
					!request.url?.startsWith('/') ||
					request.url.startsWith('//') ||
					request.url.length > 4096
				) {
					finish(400);
					return;
				}
				let url: URL;
				try {
					url = new URL(request.url, expected.origin);
				} catch {
					finish(400);
					return;
				}
				if (url.origin !== expected.origin || url.pathname !== this.#path) {
					finish(404);
					return;
				}
				const validState = url.searchParams.getAll('state');
				const code = url.searchParams.getAll('code');
				const received = Buffer.from(validState[0] ?? '', 'utf8');
				const wanted = Buffer.from(this.state, 'utf8');
				if (
					validState.length !== 1 ||
					received.length !== wanted.length ||
					!timingSafeEqual(received, wanted) ||
					code.length !== 1 ||
					!/^[A-Za-z0-9_-]{43}$/.test(code[0]!) ||
					[...url.searchParams.keys()].some((key) => key !== 'code' && key !== 'state')
				) {
					finish(400);
					this.#fail('callbackInvalid', response);
					return;
				}
				this.#settled = true;
				finish(200, this.pages.received);
				this.#resolve(code[0]!);
			}
		);
		this.#server.maxConnections = 8;
		this.#server.setTimeout(10000, (socket) => socket.destroy());
		this.#server.on('error', () => this.#fail('unavailable'));
	}

	static async start(
		state: string,
		pages: LoopbackCallbackPages,
		token: CancellationToken,
		timeoutMs = 300000
	): Promise<LoopbackAuthServer> {
		if (
			!/^[A-Za-z0-9_-]{43}$/.test(state) ||
			[pages.received, pages.invalid, pages.expired].some(
				(page) => typeof page !== 'string' || Buffer.byteLength(page) > 131072
			) ||
			!/^[A-Za-z0-9+/]{43}=$/.test(pages.styleHash) ||
			!Number.isSafeInteger(timeoutMs) ||
			timeoutMs < 1 ||
			timeoutMs > 300000
		)
			throw new TypeError('Invalid callback configuration');
		if (token.isCancellationRequested) throw new DesktopAuthorizationError('cancelled');
		const owner = new LoopbackAuthServer(state, Object.freeze({ ...pages }));
		owner.#cancellation = token.onCancellationRequested(() => owner.#fail('cancelled'));
		owner.#deadline = setTimeout(() => owner.#fail('timedOut'), timeoutMs);
		try {
			await Promise.race([
				new Promise<void>((resolve, reject) => {
					const timer = setTimeout(
						() => reject(new DesktopAuthorizationError('timedOut')),
						5000
					);
					const cleanup = (): void => {
						clearTimeout(timer);
						owner.#server.off('error', failed);
					};
					const failed = (): void => {
						cleanup();
						reject(new DesktopAuthorizationError('unavailable'));
					};
					owner.#server.once('error', failed);
					owner.#server.listen(0, '127.0.0.1', () => {
						cleanup();
						if (owner.#stopped) {
							owner.#server.closeAllConnections();
							owner.#server.close();
						}
						resolve();
					});
				}),
				owner.#result.then(() => undefined)
			]);
			if (owner.#stopped || token.isCancellationRequested)
				throw new DesktopAuthorizationError('cancelled');
			const address = owner.#server.address();
			if (!address || typeof address === 'string')
				throw new DesktopAuthorizationError('unavailable');
			owner.#callbackURL = `http://127.0.0.1:${address.port}${owner.#path}`;
			return owner;
		} catch (error) {
			await owner.stop();
			throw error instanceof DesktopAuthorizationError
				? error
				: new DesktopAuthorizationError('unavailable');
		}
	}

	get callbackURL(): string {
		if (!this.#callbackURL) throw new DesktopAuthorizationError('unavailable');
		return this.#callbackURL;
	}
	waitForCode(): Promise<string> {
		return this.#result;
	}
	/** The server may shorten the local five-minute transaction deadline. */
	expireAt(deadline: number): void {
		if (!Number.isSafeInteger(deadline)) throw new TypeError('Invalid callback deadline');
		clearTimeout(this.#deadline);
		this.#deadline = setTimeout(
			() => this.#fail('timedOut'),
			Math.max(0, Math.min(300000, deadline - Date.now()))
		);
	}

	#fail(reason: DesktopAuthorizationError['reason'], response?: ServerResponse): void {
		if (this.#settled) return;
		this.#settled = true;
		this.#reject(new DesktopAuthorizationError(reason));
		if (response && !response.writableFinished)
			response.once('finish', () => {
				void this.stop();
			});
		else void this.stop();
	}

	stop(): Promise<void> {
		if (this.#stop) return this.#stop;
		this.#stopped = true;
		if (!this.#settled) {
			this.#settled = true;
			this.#reject(new DesktopAuthorizationError('cancelled'));
		}
		this.#cancellation?.dispose();
		clearTimeout(this.#deadline);
		this.#stop = new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.#server.closeAllConnections();
				resolve();
			}, 500);
			this.#server.close(() => {
				clearTimeout(timer);
				resolve();
			});
			this.#server.closeIdleConnections();
		});
		return this.#stop;
	}
}
