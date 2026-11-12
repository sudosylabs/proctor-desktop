/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../base/common/errors.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ServerApiError } from '../common/serverApi.js';
import {
	isServerEventName,
	serverEventCatalog,
	type ServerEventName
} from '../common/serverEventCatalog.js';
import {
	ServerCommandError,
	type IServerEvents,
	type ServerCommandAction,
	type ServerCommandChannel,
	type ServerCommandOptions,
	type ServerEvent,
	type ServerEventScope,
	type ServerEventSubscription,
	type ServerEventsState
} from '../common/serverEvents.js';
import type {
	RealtimeClose,
	RealtimeEventFrame,
	RealtimeFrame,
	RealtimeSink,
	RealtimeSocket
} from './serverRealtimeConnection.js';

/** The position a reconnect offers so the server can replay what was missed. */
export interface RealtimeCheckpoint {
	readonly connectionId: string;
	readonly sequence: number;
}
/** Opens one connection, offering `checkpoint` to resume. Rejects with a {@link ServerApiError}. */
export type RealtimeDial = (
	checkpoint: RealtimeCheckpoint | undefined,
	sink: RealtimeSink,
	signal: AbortSignal
) => Promise<RealtimeSocket>;

export interface ServerEventsOptions {
	readonly dial: RealtimeDial;
	/** First reconnect delay; doubles per failure up to `retryMaxMs`, with 25% jitter. */
	readonly retryMinMs?: number;
	readonly retryMaxMs?: number;
	/** Least reconnect delay after the server throttled the connection. */
	readonly throttledMs?: number;
	readonly heartbeatMs?: number;
	/** Deadline for the hello and for each command reply. */
	readonly timeoutMs?: number;
	/** How long the connection stays open after its last subscription goes. */
	readonly idleMs?: number;
}

const MAX_SUBSCRIPTIONS = 256;
const MAX_PENDING_COMMANDS = 128;
const MAX_EARLY_FRAMES = 1024;
const MAX_EARLY_BYTES = 8 * 1024 * 1024;
const MAX_TIMER_MS = 2147483647;
const idPattern = /^[a-z0-9]{26}$/u;
const nodePattern = /^[A-Za-z0-9._-]{1,128}$/u;
/** A resource identity as the server spells it; the server authorizes the subscription. */
const resourcePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

interface Listener {
	readonly resourceId: string | undefined;
	readonly receive: (event: ServerEvent<ServerEventName>) => void;
}
interface ResourceSubscription {
	readonly action: string;
	readonly type: string;
	readonly id: string;
	refs: number;
	status: 'pending' | 'active' | 'denied';
	/** The connection the subscribe was last sent on. */
	sentOn: number | undefined;
	readonly waiters: ((accepted: boolean) => void)[];
}
interface PendingCommand {
	resolve(data: unknown): void;
	reject(error: ServerCommandError): void;
	cleanup(): void;
}
interface Connection {
	readonly epoch: number;
	readonly abort: AbortController;
	readonly requested: RealtimeCheckpoint | undefined;
	socket: RealtimeSocket | undefined;
	hello: RealtimeEventFrame | undefined;
	ready: boolean;
	readonly early: RealtimeEventFrame[];
	earlyBytes: number;
	helloDeadline: ReturnType<typeof setTimeout> | undefined;
	heartbeat: ReturnType<typeof setTimeout> | undefined;
}

/**
 * The live server events of one Session over one realtime connection. The connection opens
 * when something needs it and closes when nothing does; it reconnects with bounded, jittered
 * backoff, pauses while offline, resumes from its checkpoint when the server can replay, and
 * reports lost continuity once subscriptions are restored. A listener's error is reported and
 * never affects another listener or the connection.
 */
export class ServerEvents extends Disposable implements IServerEvents {
	private readonly continuity = this._register(new Emitter<void>());
	readonly onDidLoseContinuity = this.continuity.event;
	private readonly stateChange = this._register(new Emitter<ServerEventsState>());
	readonly onDidChangeState = this.stateChange.event;

	private readonly listeners = new Map<ServerEventName, Set<Listener>>();
	private readonly subscriptions = new Map<string, ResourceSubscription>();
	/** Subscriptions dropped while a resumable connection was down; unsubscribed on resume. */
	private readonly forgotten = new Map<string, ResourceSubscription>();
	private readonly pending = new Map<number, PendingCommand>();
	private channel: AttemptCommandChannel | undefined;
	private connection: Connection | undefined;
	private checkpoint: RealtimeCheckpoint | undefined;
	private epoch = 0;
	private commandSequence = 0;
	private failures = 0;
	private wasLive = false;
	private lossPending = false;
	private online = true;
	private ended = false;
	private current: ServerEventsState = 'idle';
	private retry: ReturnType<typeof setTimeout> | undefined;
	private idle: ReturnType<typeof setTimeout> | undefined;
	private readonly retryMinMs: number;
	private readonly retryMaxMs: number;
	private readonly throttledMs: number;
	private readonly heartbeatMs: number;
	private readonly timeoutMs: number;
	private readonly idleMs: number;

	constructor(private readonly options: ServerEventsOptions) {
		super();
		this.retryMinMs = bounded(options.retryMinMs ?? 1000);
		this.retryMaxMs = bounded(options.retryMaxMs ?? 30_000);
		this.throttledMs = bounded(options.throttledMs ?? 30_000);
		this.heartbeatMs = bounded(options.heartbeatMs ?? 30_000);
		this.timeoutMs = bounded(options.timeoutMs ?? 15_000);
		this.idleMs = bounded(options.idleMs ?? 30_000);
		if (this.retryMinMs > this.retryMaxMs) throw new ServerApiError('invalidRequest');
		this._register(toDisposable(() => this.end()));
	}

	get state(): ServerEventsState {
		return this.current;
	}

	on<N extends ServerEventName>(
		name: N,
		scope: ServerEventScope<N>,
		receive: (event: ServerEvent<N>) => void
	): ServerEventSubscription {
		const entry = serverEventCatalog[name];
		if (this.ended) return { accepted: Promise.resolve(false), dispose: () => {} };
		let subscription: ResourceSubscription | undefined;
		let key: string | undefined;
		if (entry.target === 'resource') {
			const resourceId = (scope as { readonly resourceId?: unknown } | undefined)?.resourceId;
			if (typeof resourceId !== 'string' || !resourcePattern.test(resourceId))
				throw new ServerApiError('invalidRequest');
			key = `${entry.action}\u0000${entry.resourceType}\u0000${resourceId}`;
			subscription = this.subscriptions.get(key);
			if (!subscription) {
				if (this.subscriptions.size >= MAX_SUBSCRIPTIONS)
					return { accepted: Promise.resolve(false), dispose: () => {} };
				subscription = this.forgotten.get(key) ?? {
					action: entry.action,
					type: entry.resourceType,
					id: resourceId,
					refs: 0,
					status: 'pending',
					sentOn: undefined,
					waiters: []
				};
				this.forgotten.delete(key);
				this.subscriptions.set(key, subscription);
			}
			subscription.refs++;
		}
		const listener: Listener = {
			resourceId: subscription?.id,
			receive: receive as (event: ServerEvent<ServerEventName>) => void
		};
		let set = this.listeners.get(name);
		if (!set) this.listeners.set(name, (set = new Set()));
		set.add(listener);
		let active = true;
		const accepted = !subscription
			? Promise.resolve(true)
			: subscription.status === 'active'
				? Promise.resolve(true)
				: subscription.status === 'denied'
					? Promise.resolve(false)
					: new Promise<boolean>((resolve) => subscription.waiters.push(resolve));
		if (
			subscription?.status === 'pending' &&
			this.isLive() &&
			subscription.sentOn !== this.connection?.epoch
		)
			void this.subscribe(subscription);
		this.need();
		return {
			accepted,
			dispose: () => {
				if (!active) return;
				active = false;
				set.delete(listener);
				if (subscription && key && --subscription.refs === 0)
					this.release(key, subscription);
				this.release();
			}
		};
	}

	openCommandChannel(): ServerCommandChannel {
		if (this.ended || this.channel) throw new ServerApiError('invalidRequest');
		const channel = new AttemptCommandChannel(
			(action, data, options) => this.request(action, data, options),
			() => {
				if (this.channel === channel) this.channel = undefined;
				this.release();
			}
		);
		this.channel = channel;
		this.need();
		return channel;
	}

	setOnline(online: boolean): void {
		if (this.ended || this.online === online) return;
		this.online = online;
		if (!online) {
			clearTimeout(this.retry);
			this.retry = undefined;
			if (this.connection) this.lost(this.connection.epoch, 'resume');
			else if (this.needed()) this.publish('offline');
		} else this.need();
	}

	// #region Lifetime

	private needed(): boolean {
		return this.subscriptions.size > 0 || this.channel !== undefined || this.hasListeners();
	}
	private hasListeners(): boolean {
		for (const set of this.listeners.values()) if (set.size) return true;
		return false;
	}
	private need(): void {
		if (this.ended) return;
		clearTimeout(this.idle);
		this.idle = undefined;
		if (!this.online) {
			this.publish('offline');
			return;
		}
		if (!this.connection && !this.retry) this.connect();
	}
	/** Drops a subscription nobody listens to, and closes an idle connection after a grace. */
	private release(key?: string, subscription?: ResourceSubscription): void {
		if (key && subscription) {
			this.subscriptions.delete(key);
			for (const resolve of subscription.waiters.splice(0)) resolve(false);
			if (subscription.status === 'active' && this.isLive())
				void this.request('unsubscribe', subscriptionBody(subscription)).catch(() => {});
			else if (subscription.sentOn !== undefined) this.forgotten.set(key, subscription);
		}
		if (this.ended || this.needed() || this.idle) return;
		this.idle = setTimeout(() => {
			this.idle = undefined;
			if (this.needed()) return;
			clearTimeout(this.retry);
			this.retry = undefined;
			if (this.connection) this.close(this.connection);
			// Nobody can have missed anything: nothing was listening.
			this.checkpoint = undefined;
			this.forgotten.clear();
			this.wasLive = false;
			this.lossPending = false;
			this.failures = 0;
			this.publish('idle');
		}, this.idleMs);
		this.idle.unref();
	}

	private connect(): void {
		const epoch = ++this.epoch;
		const connection: Connection = {
			epoch,
			abort: new AbortController(),
			requested: this.checkpoint,
			socket: undefined,
			hello: undefined,
			ready: false,
			early: [],
			earlyBytes: 0,
			helloDeadline: undefined,
			heartbeat: undefined
		};
		this.connection = connection;
		this.publish('connecting');
		connection.helloDeadline = setTimeout(() => this.lost(epoch, 'resume'), this.timeoutMs);
		connection.helloDeadline.unref();
		const sink: RealtimeSink = {
			frame: (frame) => this.receive(connection, frame),
			closed: (reason) => this.lost(epoch, reason)
		};
		this.options.dial(connection.requested, sink, connection.abort.signal).then(
			(socket) => {
				if (this.connection !== connection) {
					socket.dispose();
					return;
				}
				connection.socket = socket;
				this.ready(connection);
			},
			(error: unknown) => this.lost(epoch, refusal(error))
		);
	}

	private close(connection: Connection): void {
		if (this.connection === connection) this.connection = undefined;
		clearTimeout(connection.helloDeadline);
		clearTimeout(connection.heartbeat);
		connection.abort.abort();
		connection.socket?.dispose();
		for (const pending of [...this.pending.values()]) {
			pending.cleanup();
			pending.reject(new ServerCommandError('unconfirmed'));
		}
		for (const subscription of this.subscriptions.values())
			if (subscription.status === 'active') subscription.status = 'pending';
	}

	private lost(epoch: number, reason: RealtimeClose): void {
		const connection = this.connection;
		if (this.ended || !connection || connection.epoch !== epoch) return;
		this.close(connection);
		if (reason !== 'resume' && reason !== 'throttled') this.checkpoint = undefined;
		if (reason === 'fresh' && this.wasLive) this.lossPending = true;
		if (reason === 'ended') {
			this.end();
			return;
		}
		if (!this.online) {
			this.publish('offline');
			return;
		}
		if (!this.needed()) {
			this.publish('idle');
			return;
		}
		const base = Math.min(
			this.retryMaxMs,
			this.retryMinMs * 2 ** Math.min(this.failures++, 16)
		);
		const backoff = Math.min(this.retryMaxMs, base + Math.random() * base * 0.25);
		const delay = reason === 'throttled' ? Math.max(this.throttledMs, backoff) : backoff;
		this.publish('waiting');
		this.retry = setTimeout(() => {
			this.retry = undefined;
			if (!this.ended && this.online && this.needed() && !this.connection) this.connect();
		}, delay);
		this.retry.unref();
	}

	private end(): void {
		if (this.ended) return;
		this.ended = true;
		clearTimeout(this.retry);
		clearTimeout(this.idle);
		if (this.connection) this.close(this.connection);
		for (const subscription of this.subscriptions.values())
			for (const resolve of subscription.waiters.splice(0)) resolve(false);
		this.channel?.end();
		this.publish('ended');
	}

	// #endregion

	// #region Frames

	private receive(connection: Connection, frame: RealtimeFrame): void {
		if (this.ended || this.connection !== connection) return;
		if (frame.kind === 'reply') {
			const pending = this.pending.get(frame.sequence);
			if (!pending) return;
			pending.cleanup();
			if (frame.ok) pending.resolve(frame.data);
			else pending.reject(new ServerCommandError('rejected', frame.problem));
			return;
		}
		if (connection.ready) {
			this.accept(connection, frame);
			return;
		}
		if (frame.name === 'hello' && !connection.hello) {
			connection.hello = frame;
			this.ready(connection);
			return;
		}
		// Replay before a resumed hello, or events racing the socket handover: keep them, bounded.
		connection.earlyBytes += Buffer.byteLength(JSON.stringify(frame));
		if (
			frame.name === 'hello' ||
			(!connection.hello && !connection.requested) ||
			connection.early.length >= MAX_EARLY_FRAMES ||
			connection.earlyBytes > MAX_EARLY_BYTES
		) {
			this.lost(connection.epoch, 'fresh');
			return;
		}
		connection.early.push(frame);
	}

	/** Runs once both the socket and the hello have arrived, in whichever order. */
	private ready(connection: Connection): void {
		const hello = connection.hello;
		if (connection.ready || !hello || !connection.socket) return;
		const data = hello.data as Record<string, unknown> | undefined;
		if (
			!data ||
			typeof data !== 'object' ||
			typeof data.connection_id !== 'string' ||
			!idPattern.test(data.connection_id) ||
			typeof data.node_id !== 'string' ||
			!nodePattern.test(data.node_id) ||
			typeof data.resumed !== 'boolean'
		) {
			this.lost(connection.epoch, 'fresh');
			return;
		}
		const requested = connection.requested;
		const resumed =
			data.resumed &&
			requested !== undefined &&
			data.connection_id === requested.connectionId;
		const replay = connection.early.filter((frame) => frame.sequence < hello.sequence);
		const after = connection.early.filter((frame) => frame.sequence > hello.sequence);
		if ((data.resumed && !resumed) || (!resumed && replay.length)) {
			this.lost(connection.epoch, 'fresh');
			return;
		}
		clearTimeout(connection.helloDeadline);
		connection.helloDeadline = undefined;
		connection.ready = true;
		connection.early.length = 0;
		this.checkpoint = {
			connectionId: data.connection_id,
			sequence: resumed && requested ? requested.sequence : 0
		};
		const lostContinuity = this.lossPending || (this.wasLive && !resumed);
		this.lossPending = false;
		this.wasLive = true;
		this.failures = 0;
		for (const frame of [...replay, hello, ...after])
			if (!this.accept(connection, frame)) return;
		// The server keeps subscriptions only across a resumed connection.
		const restored = [...this.subscriptions.values()]
			.filter((subscription) => !resumed || subscription.status !== 'active')
			.map((subscription) => this.subscribe(subscription));
		if (resumed)
			for (const subscription of this.forgotten.values())
				void this.request('unsubscribe', subscriptionBody(subscription)).catch(() => {});
		this.forgotten.clear();
		this.publish('live');
		this.scheduleHeartbeat(connection);
		if (lostContinuity)
			void Promise.all(restored).then(() => {
				if (this.connection === connection) this.loseContinuity();
			});
	}

	/** Applies one event in sequence; a gap reconnects fresh. Returns whether to continue. */
	private accept(connection: Connection, frame: RealtimeEventFrame): boolean {
		const checkpoint = this.checkpoint;
		if (!checkpoint || frame.sequence !== checkpoint.sequence + 1) {
			this.lossPending = true;
			this.lost(connection.epoch, 'fresh');
			return false;
		}
		this.checkpoint = { connectionId: checkpoint.connectionId, sequence: frame.sequence };
		if (frame.name === 'hello') {
			if (frame !== connection.hello) {
				this.lost(connection.epoch, 'fresh');
				return false;
			}
			return true;
		}
		if (frame.name === 'resync_required') {
			this.loseContinuity();
			return this.connection === connection;
		}
		this.deliver(frame);
		return this.connection === connection;
	}

	private deliver(frame: RealtimeEventFrame): void {
		if (!isServerEventName(frame.name)) return;
		const name = frame.name;
		const entry = serverEventCatalog[name];
		const resourceId =
			entry.target === 'resource'
				? frame.resource?.type === entry.resourceType
					? frame.resource.id
					: undefined
				: undefined;
		if (entry.target === 'resource' && resourceId === undefined) return;
		const listeners = [...(this.listeners.get(name) ?? [])].filter(
			(listener) => entry.target === 'user' || listener.resourceId === resourceId
		);
		if (!listeners.length) return;
		let data: ServerEvent<typeof name>['data'];
		try {
			const fields = frame.data ?? {};
			if (typeof fields !== 'object' || fields === null || Array.isArray(fields))
				throw new TypeError('Invalid event data');
			data = entry.read(fields as Readonly<Record<string, unknown>>) as typeof data;
		} catch {
			// The server changed something Desktop cannot read: treat it as missed.
			this.loseContinuity();
			return;
		}
		const event: ServerEvent<ServerEventName> = Object.freeze({
			name,
			data,
			...(resourceId === undefined ? {} : { resourceId })
		});
		for (const listener of listeners) {
			try {
				listener.receive(event);
			} catch (error) {
				onUnexpectedError(error);
			}
		}
	}

	private loseContinuity(): void {
		this.channel?.needResynchronization();
		this.continuity.fire();
	}

	// #endregion

	// #region Commands

	private subscribe(subscription: ResourceSubscription): Promise<void> {
		subscription.status = 'pending';
		subscription.sentOn = this.connection?.epoch;
		return this.request('subscribe', subscriptionBody(subscription)).then(
			() => {
				if (subscription.refs === 0) return;
				subscription.status = 'active';
				for (const resolve of subscription.waiters.splice(0)) resolve(true);
			},
			(error: unknown) => {
				// A refusal is final for this subscription; a lost reply is resent on the next connection.
				if (error instanceof ServerCommandError && error.outcome === 'rejected') {
					subscription.status = 'denied';
					for (const resolve of subscription.waiters.splice(0)) resolve(false);
				}
			}
		);
	}

	private request(
		action: string,
		data?: unknown,
		options: ServerCommandOptions = {}
	): Promise<unknown> {
		const timeout = options.timeoutMs ?? this.timeoutMs;
		const socket = this.connection?.ready ? this.connection.socket : undefined;
		if (
			!Number.isSafeInteger(timeout) ||
			timeout < 1 ||
			timeout > MAX_TIMER_MS ||
			!socket ||
			options.token?.isCancellationRequested ||
			this.pending.size >= MAX_PENDING_COMMANDS ||
			this.commandSequence >= Number.MAX_SAFE_INTEGER
		)
			return Promise.reject(new ServerCommandError('notSent'));
		const sequence = ++this.commandSequence;
		return new Promise((resolve, reject) => {
			let cancellation: { dispose(): void } | undefined;
			const cleanup = () => {
				this.pending.delete(sequence);
				clearTimeout(timer);
				cancellation?.dispose();
			};
			const unconfirmed = () => {
				cleanup();
				reject(new ServerCommandError('unconfirmed'));
			};
			const timer = setTimeout(unconfirmed, timeout);
			timer.unref();
			cancellation = options.token?.onCancellationRequested(unconfirmed);
			this.pending.set(sequence, { resolve, reject, cleanup });
			try {
				socket.send({ sequence, action, ...(data === undefined ? {} : { data }) });
			} catch {
				// The socket refused it before writing: closed, unsendable or over a bound.
				cleanup();
				reject(new ServerCommandError('notSent'));
			}
		});
	}

	private scheduleHeartbeat(connection: Connection): void {
		clearTimeout(connection.heartbeat);
		connection.heartbeat = setTimeout(() => {
			if (this.connection !== connection) return;
			this.request('ping').then(
				(reply) => {
					if (
						typeof reply !== 'object' ||
						reply === null ||
						(reply as { pong?: unknown }).pong !== true
					)
						this.lost(connection.epoch, 'resume');
					else if (this.connection === connection) this.scheduleHeartbeat(connection);
				},
				() => this.lost(connection.epoch, 'resume')
			);
		}, this.heartbeatMs);
		connection.heartbeat.unref();
	}

	private isLive(): boolean {
		return this.connection?.ready === true;
	}
	private publish(state: ServerEventsState): void {
		if (this.current === state || (this.current === 'ended' && state !== 'ended')) return;
		this.current = state;
		this.stateChange.fire(state);
	}

	// #endregion
}

class AttemptCommandChannel implements ServerCommandChannel {
	private readonly resynchronization = new Emitter<void>();
	readonly onDidNeedResynchronization = this.resynchronization.event;
	private needs = false;
	private closed = false;

	constructor(
		private readonly send_: (
			action: ServerCommandAction,
			data: unknown,
			options?: ServerCommandOptions
		) => Promise<unknown>,
		private readonly released: () => void
	) {}

	get needsResynchronization(): boolean {
		return this.needs;
	}
	send(
		action: ServerCommandAction,
		data: unknown,
		options?: ServerCommandOptions
	): Promise<unknown> {
		if (this.closed || this.needs) return Promise.reject(new ServerCommandError('notSent'));
		return this.send_(action, data, options);
	}
	resynchronized(): void {
		this.needs = false;
	}
	needResynchronization(): void {
		if (this.closed) return;
		this.needs = true;
		this.resynchronization.fire();
	}
	end(): void {
		this.closed = true;
		this.resynchronization.dispose();
	}
	dispose(): void {
		if (this.closed) return;
		this.end();
		this.released();
	}
}

function subscriptionBody(subscription: ResourceSubscription) {
	return {
		action: subscription.action,
		resource: { type: subscription.type, id: subscription.id }
	};
}
/** How a refused or failed dial should be retried. */
function refusal(error: unknown): RealtimeClose {
	if (!(error instanceof ServerApiError)) return 'resume';
	if (error.kind === 'sessionEnded' || error.kind === 'redirectBlocked') return 'ended';
	if (error.kind === 'server') {
		const status = error.status ?? 0;
		if (status === 401 || status === 403) return 'ended';
		if (status === 429 || status === 503) return 'throttled';
	}
	return 'resume';
}
function bounded(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMER_MS)
		throw new ServerApiError('invalidRequest');
	return value;
}
