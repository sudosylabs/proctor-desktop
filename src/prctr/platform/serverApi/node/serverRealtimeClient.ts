import { ServerApiError } from '../common/serverApi.js';
import type { ApiSubscription } from '../common/apiObservation.js';
import type { ApiRealtimeConnection, RealtimeMessage } from './serverRealtime.js';

export type RealtimeEvent = Extract<RealtimeMessage, { event: string }>;
export type RealtimeReply = Extract<RealtimeMessage, { status: string }>;
export interface RealtimeState {
	readonly phase: 'idle' | 'connecting' | 'connected' | 'waiting' | 'closed';
	readonly needsResync: boolean;
	readonly error?: ServerApiError;
}
export interface RealtimePolicy {
	/** Ordinary session consumers may opt in; Attempt coordinators retain their reconnect gate. */
	readonly reconnect?: boolean;
	readonly retryMinMs?: number;
	readonly retryMaxMs?: number;
	readonly heartbeatMs?: number;
	readonly timeoutMs?: number;
}
export interface RealtimeCheckpoint {
	readonly connectionId: string;
	readonly sequence: number;
}
export type RealtimeDial = (
	checkpoint: RealtimeCheckpoint | undefined,
	signal: AbortSignal,
	message: (message: RealtimeMessage) => void,
	closed: (error: ServerApiError | undefined) => void
) => Promise<ApiRealtimeConnection>;
export class RealtimeCommandError extends ServerApiError {
	constructor(
		readonly outcome: 'notSent' | 'unconfirmed' | 'rejected',
		readonly reply?: RealtimeReply
	) {
		super(reply ? 'server' : 'network');
	}
}
interface PendingCommand {
	resolve(reply: RealtimeReply): void;
	reject(error: Error): void;
	cleanup(): void;
}
const isEvent = (message: RealtimeMessage): message is RealtimeEvent =>
	typeof message.event === 'string';
const idPattern = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{26}$/u;

/** Session transport lifecycle. Domain owners reconcile state and explicitly acknowledge resync. */
export class ServerRealtimeClient {
	private socket: ApiRealtimeConnection | undefined;
	private attempt: AbortController | undefined;
	private epoch = 0;
	private disposed = false;
	private running = false;
	private terminated = false;
	private online = true;
	private connecting: Promise<void> | undefined;
	private checkpoint: RealtimeCheckpoint | undefined;
	private commandSequence = 0;
	private failures = 0;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private heartbeat: ReturnType<typeof setTimeout> | undefined;
	private helloDeadline: ReturnType<typeof setTimeout> | undefined;
	private helloReject: ((error: Error) => void) | undefined;
	private readonly pending = new Map<number, PendingCommand>();
	private readonly events = new Set<(event: RealtimeEvent) => void>();
	private readonly states = new Set<(state: RealtimeState) => void>();
	private current: RealtimeState = { phase: 'idle', needsResync: false };
	private readonly policy: Required<RealtimePolicy>;
	constructor(
		private readonly dial: RealtimeDial,
		policy: RealtimePolicy = {}
	) {
		this.policy = {
			reconnect: false,
			retryMinMs: 1000,
			retryMaxMs: 30000,
			heartbeatMs: 30000,
			timeoutMs: 15000,
			...policy
		};
		for (const value of [
			this.policy.retryMinMs,
			this.policy.retryMaxMs,
			this.policy.heartbeatMs,
			this.policy.timeoutMs
		])
			if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)
				throw new ServerApiError('invalidRequest');
		if (this.policy.retryMinMs > this.policy.retryMaxMs)
			throw new ServerApiError('invalidRequest');
	}
	get state(): RealtimeState {
		return this.current;
	}
	onEvent(listener: (event: RealtimeEvent) => void): ApiSubscription {
		if (this.disposed) throw new ServerApiError('sessionEnded');
		this.events.add(listener);
		return { dispose: () => this.events.delete(listener) };
	}
	onState(listener: (state: RealtimeState) => void): ApiSubscription {
		if (this.disposed) throw new ServerApiError('sessionEnded');
		this.states.add(listener);
		return { dispose: () => this.states.delete(listener) };
	}
	start(): Promise<void> {
		if (this.disposed || this.terminated)
			return Promise.reject(new ServerApiError('sessionEnded'));
		if (this.current.phase === 'connected') return Promise.resolve();
		if (this.connecting) return this.connecting;
		this.running = true;
		if (!this.online) return Promise.reject(new ServerApiError('network'));
		clearTimeout(this.retry);
		this.retry = undefined;
		const epoch = ++this.epoch;
		this.connecting = Promise.resolve()
			.then(() => this.open(epoch))
			.finally(() => {
				if (epoch === this.epoch) this.connecting = undefined;
			});
		return this.connecting;
	}
	private async open(epoch: number): Promise<void> {
		const attempt = (this.attempt = new AbortController());
		this.publish({ phase: 'connecting', needsResync: this.current.needsResync });
		if (this.disposed || epoch !== this.epoch) throw new ServerApiError('sessionEnded');
		const requested = this.checkpoint;
		let receivedHello = false;
		let replay: RealtimeEvent[] = [];
		let replayBytes = 0;
		let ready!: () => void;
		const hello = new Promise<void>((resolve, reject) => {
			ready = resolve;
			this.helloReject = reject;
		});
		// Install a rejection handler before the socket upgrade can fail.
		void hello.catch(() => {});
		this.helloDeadline = setTimeout(
			() => this.lost(epoch, new ServerApiError('timeout')),
			this.policy.timeoutMs
		);
		this.helloDeadline.unref();
		const accept = (message: RealtimeMessage) => {
			if (epoch !== this.epoch || this.disposed) return;
			if (!isEvent(message)) {
				const pending = this.pending.get(message.sequence);
				if (pending) {
					this.pending.delete(message.sequence);
					pending.cleanup();
					if (message.status === 'error')
						pending.reject(new RealtimeCommandError('rejected', message));
					else pending.resolve(message);
				}
				return;
			}
			if (!receivedHello) {
				if (message.event !== 'hello') {
					replayBytes += Buffer.byteLength(JSON.stringify(message));
					if (!requested || replay.length >= 1024 || replayBytes > 8 * 1024 * 1024) {
						this.resync(epoch);
						return;
					}
					replay.push(message);
					return;
				}
				const data = message.data as Record<string, unknown> | undefined;
				if (
					!data ||
					typeof data.connection_id !== 'string' ||
					!idPattern.test(data.connection_id) ||
					typeof data.node_id !== 'string' ||
					!/^[A-Za-z0-9._-]{1,128}$/u.test(data.node_id) ||
					typeof data.resumed !== 'boolean'
				) {
					this.lost(epoch, new ServerApiError('invalidResponse'));
					return;
				}
				if (data.resumed && (!requested || data.connection_id !== requested.connectionId)) {
					this.resync(epoch);
					return;
				}
				if (!data.resumed && replay.length) {
					this.resync(epoch);
					return;
				}
				const needsResync = this.current.needsResync || (!!requested && !data.resumed);
				this.current = { ...this.current, needsResync };
				this.checkpoint = {
					connectionId: data.connection_id,
					sequence: data.resumed ? requested!.sequence : 0
				};
				receivedHello = true;
				for (const event of [...replay, message]) {
					if (!this.acceptEvent(epoch, event)) return;
				}
				replay = [];
				clearTimeout(this.helloDeadline);
				this.helloDeadline = undefined;
				this.helloReject = undefined;
				this.failures = 0;
				this.publish({ phase: 'connected', needsResync: this.current.needsResync });
				ready();
				this.scheduleHeartbeat(epoch);
				return;
			}
			if (message.event === 'hello') {
				this.resync(epoch);
				return;
			}
			this.acceptEvent(epoch, message);
		};
		try {
			// Buffer messages delivered in the upgrade's network read until ownership is installed.
			const early: RealtimeMessage[] = [];
			let owned = false;
			let earlyBytes = 0;
			const dialing = this.dial(
				requested,
				attempt.signal,
				(message) => {
					if (epoch !== this.epoch || this.disposed) return;
					if (owned) accept(message);
					else {
						earlyBytes += Buffer.byteLength(JSON.stringify(message));
						if (early.length < 1024 && earlyBytes <= 8 * 1024 * 1024)
							early.push(message);
						else this.resync(epoch);
					}
				},
				(error) => this.lost(epoch, error ?? new ServerApiError('network'))
			).then((socket) => {
				if (epoch !== this.epoch || this.disposed) socket.dispose();
				return socket;
			});
			const socket = await Promise.race([
				dialing,
				hello.then<ApiRealtimeConnection>(() => {
					throw new ServerApiError('invalidResponse');
				})
			]);
			if (epoch !== this.epoch || this.disposed) {
				socket.dispose();
				throw new ServerApiError('cancelled');
			}
			this.socket = socket;
			owned = true;
			for (const message of early) accept(message);
			await hello;
			if (epoch !== this.epoch || this.disposed) throw new ServerApiError('cancelled');
		} catch (error) {
			const failure = error instanceof ServerApiError ? error : new ServerApiError('network');
			this.lost(epoch, failure);
			throw failure;
		}
	}
	private acceptEvent(epoch: number, event: RealtimeEvent): boolean {
		if (epoch !== this.epoch || this.disposed) return false;
		if (!this.checkpoint || event.sequence !== this.checkpoint.sequence + 1) {
			this.resync(epoch);
			return false;
		}
		this.checkpoint = { connectionId: this.checkpoint.connectionId, sequence: event.sequence };
		if (event.event === 'resync_required') this.publish({ ...this.current, needsResync: true });
		for (const listener of [...this.events]) {
			if (epoch !== this.epoch || this.disposed) return false;
			try {
				listener(event);
			} catch {
				this.resync(epoch);
				return false;
			}
		}
		return epoch === this.epoch && !this.disposed;
	}
	/** Call only after the owning service has re-read authoritative state and restored subscriptions. */
	acknowledgeResync(): void {
		if (this.disposed || this.current.phase !== 'connected')
			throw new ServerApiError('sessionEnded');
		this.publish({ ...this.current, needsResync: false });
	}
	request(
		action: string,
		data?: unknown,
		options: { signal?: AbortSignal; timeoutMs?: number } = {}
	): Promise<RealtimeReply> {
		const timeout = options.timeoutMs ?? this.policy.timeoutMs;
		if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647)
			return Promise.reject(new ServerApiError('invalidRequest'));
		if (
			this.disposed ||
			this.current.phase !== 'connected' ||
			!this.socket ||
			options.signal?.aborted ||
			(this.current.needsResync && !['ping', 'subscribe', 'unsubscribe'].includes(action))
		)
			return Promise.reject(new RealtimeCommandError('notSent'));
		if (this.pending.size >= 128 || this.commandSequence >= Number.MAX_SAFE_INTEGER)
			return Promise.reject(new RealtimeCommandError('notSent'));
		const sequence = ++this.commandSequence;
		return new Promise((resolve, reject) => {
			const finish = () => {
				this.pending.delete(sequence);
				clearTimeout(timer);
				options.signal?.removeEventListener('abort', cancel);
			};
			const cancel = () => {
				finish();
				reject(new RealtimeCommandError('unconfirmed'));
			};
			const timer = setTimeout(cancel, timeout);
			timer.unref();
			this.pending.set(sequence, { resolve, reject, cleanup: finish });
			options.signal?.addEventListener('abort', cancel, { once: true });
			try {
				this.socket!.send({ sequence, action, ...(data === undefined ? {} : { data }) });
			} catch (error) {
				finish();
				reject(
					new RealtimeCommandError(
						error instanceof ServerApiError &&
							['invalidRequest', 'sessionEnded'].includes(error.kind)
							? 'notSent'
							: 'unconfirmed'
					)
				);
			}
		});
	}
	private scheduleHeartbeat(epoch: number): void {
		clearTimeout(this.heartbeat);
		if (epoch !== this.epoch || this.disposed) return;
		this.heartbeat = setTimeout(() => {
			void this.request('ping')
				.then((reply) => {
					const data = reply.data;
					if (
						!data ||
						typeof data !== 'object' ||
						!('pong' in data) ||
						data.pong !== true
					)
						throw new ServerApiError('invalidResponse');
					this.scheduleHeartbeat(epoch);
				})
				.catch(() => this.lost(epoch, new ServerApiError('timeout')));
		}, this.policy.heartbeatMs);
		this.heartbeat.unref();
	}
	private resync(epoch: number): void {
		if (epoch !== this.epoch || this.disposed) return;
		this.checkpoint = undefined;
		this.current = { ...this.current, needsResync: true };
		this.lost(epoch, new ServerApiError('invalidResponse'));
	}
	private lost(epoch: number, error: ServerApiError): void {
		if (epoch !== this.epoch || this.disposed) return;
		++this.epoch;
		this.connecting = undefined;
		this.attempt?.abort();
		this.attempt = undefined;
		this.socket?.dispose();
		this.socket = undefined;
		clearTimeout(this.helloDeadline);
		clearTimeout(this.heartbeat);
		this.helloReject?.(error);
		this.helloReject = undefined;
		for (const pending of [...this.pending.values()]) {
			pending.cleanup();
			pending.reject(new RealtimeCommandError('unconfirmed'));
		}
		const terminal =
			error.kind === 'sessionEnded' ||
			error.kind === 'redirectBlocked' ||
			(error.kind === 'server' && [401, 403].includes(error.status ?? 0));
		if (terminal) {
			this.running = false;
			this.terminated = true;
		}
		this.publish({
			phase: this.running && this.policy.reconnect ? 'waiting' : 'closed',
			needsResync: this.current.needsResync,
			error
		});
		if (
			!this.disposed &&
			!this.connecting &&
			this.current.phase === 'waiting' &&
			this.running &&
			this.online &&
			this.policy.reconnect
		) {
			const base = Math.min(
				this.policy.retryMaxMs,
				this.policy.retryMinMs * 2 ** Math.min(this.failures++, 16)
			);
			const delay = Math.min(this.policy.retryMaxMs, base + Math.random() * base * 0.25);
			this.retry = setTimeout(() => {
				this.retry = undefined;
				void this.start().catch(() => {});
			}, delay);
			this.retry.unref();
		}
	}
	setOnline(online: boolean): void {
		if (this.disposed || this.online === online) return;
		this.online = online;
		if (!online) {
			clearTimeout(this.retry);
			this.retry = undefined;
			if (this.attempt || this.socket) this.lost(this.epoch, new ServerApiError('network'));
		} else if (this.running && this.policy.reconnect) void this.start().catch(() => {});
	}
	private publish(state: RealtimeState): void {
		this.current = Object.freeze(state);
		for (const listener of [...this.states]) {
			if (this.disposed && state.phase !== 'closed') break;
			try {
				listener(this.current);
			} catch {
				this.states.delete(listener);
			}
		}
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.running = false;
		++this.epoch;
		this.attempt?.abort();
		this.attempt = undefined;
		this.socket?.dispose();
		this.socket = undefined;
		this.helloReject?.(new ServerApiError('sessionEnded'));
		this.helloReject = undefined;
		for (const pending of [...this.pending.values()]) {
			pending.cleanup();
			pending.reject(new RealtimeCommandError('unconfirmed'));
		}
		clearTimeout(this.retry);
		clearTimeout(this.heartbeat);
		clearTimeout(this.helloDeadline);
		this.publish({
			phase: 'closed',
			needsResync: this.current.needsResync,
			error: new ServerApiError('sessionEnded')
		});
		this.events.clear();
		this.states.clear();
	}
}
