/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import {
	observableValue,
	transaction,
	type IObservable,
	type ISettableObservable
} from '../../../../base/common/observable.js';
import type {
	AccountClient,
	AccountFailure,
	AccountIntent,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import type {
	AdministrationClient,
	AdministrationFailure,
	AdministrationIntent,
	AdministrationResponse
} from '../../../../platform/administration/common/administrationProtocol.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** An answer slow enough to say so. */
export const SERVER_DATA_SLOW_MS = 8_000;
/** No first answer by now counts as the server being unavailable. */
export const SERVER_DATA_DEADLINE_MS = 15_000;

/** What each capability reads and changes through the service. */
export interface ServerDataCapabilities {
	readonly administration: {
		readonly intent: AdministrationIntent;
		readonly response: AdministrationResponse;
		readonly failure: AdministrationFailure;
	};
	readonly account: {
		readonly intent: AccountIntent;
		readonly response: AccountResponse;
		readonly failure: AccountFailure;
	};
}
export type ServerDataCapability = keyof ServerDataCapabilities;
type Intent<C extends ServerDataCapability> = ServerDataCapabilities[C]['intent'];
type Response<C extends ServerDataCapability> = ServerDataCapabilities[C]['response'];
type Failure<C extends ServerDataCapability> = ServerDataCapabilities[C]['failure'];
/** A successful answer: anything but an error. */
export type ServerDataValue<C extends ServerDataCapability> = Exclude<
	Response<C>,
	{ readonly kind: 'error' }
>;

/** Where one read stands. The data shown, if any, is the observation's `data`. */
export type QueryState<F extends string = string> =
	/** No answer yet; `slow` once it is taking long enough to say so. */
	| { readonly kind: 'loading'; readonly slow: boolean }
	| { readonly kind: 'ready' }
	/** Data is shown and a newer read is in flight. */
	| { readonly kind: 'refreshing' }
	/** The data shown is from the last good read, at `since`, and a newer read failed. */
	| { readonly kind: 'stale'; readonly reason: F; readonly since: number }
	/** Nothing could be read. */
	| { readonly kind: 'failed'; readonly reason: F };

/** One read a view follows. Disposing it lets the read go once no view in the window uses it. */
export interface IQueryObservation<D, F extends string> extends IDisposable {
	readonly state: IObservable<QueryState<F>>;
	/**
	 * The last good answer. A part that did not change keeps its previous object, so a view
	 * can tell an unchanged row by identity.
	 */
	readonly data: IObservable<D | undefined>;
	/** Reads again now; resolves once the answer is applied. */
	refresh(): Promise<void>;
}

export const IServerDataService = createDecorator<IServerDataService>('serverDataService');

/**
 * The window's reads and changes of server data. Views in the window that follow the same read
 * share one observation. Main owns the cache, its freshness and what each change re-reads; this
 * service owns what a view sees while it waits.
 */
export interface IServerDataService {
	readonly _serviceBrand: undefined;

	observe<C extends ServerDataCapability>(
		capability: C,
		intent: Intent<C>
	): IQueryObservation<ServerDataValue<C>, Failure<C>>;
	/**
	 * Sends one change and resolves with its reply. Unrelated changes run together; main queues
	 * changes to the same data, and refuses one as `busy` when too many wait.
	 */
	change<C extends ServerDataCapability>(capability: C, intent: Intent<C>): Promise<Response<C>>;
}

export interface ServerDataClients {
	readonly administration: AdministrationClient;
	readonly account: AccountClient;
}
export interface ServerDataOptions {
	readonly slowMs?: number;
	readonly deadlineMs?: number;
	readonly now?: () => number;
}

type AnyResponse = AdministrationResponse | AccountResponse;
interface Client {
	request(intent: unknown): Promise<AnyResponse>;
	observe?(intent: unknown, listener: (response: AnyResponse) => void): IDisposable;
}

/** One shared read: its observables, its source and how many views use it. */
class Entry extends Disposable {
	readonly state: ISettableObservable<QueryState>;
	readonly data: ISettableObservable<unknown>;
	refs = 0;
	private lastGood = 0;
	private sequence = 0;
	private timers: IDisposable | undefined;

	constructor(
		private readonly client: Client,
		private readonly intent: unknown,
		private readonly options: Required<ServerDataOptions>
	) {
		super();
		this.state = observableValue<QueryState>(this, { kind: 'loading', slow: false });
		this.data = observableValue<unknown>(this, undefined);
		this._register(toDisposable(() => this.clearTimers()));
		this.startDeadline();
		const subscription = client.observe?.(intent, (response) => {
			if (!this._store.isDisposed) this.apply(response);
		});
		if (subscription) this._register(subscription);
		else void this.refresh();
	}

	async refresh(): Promise<void> {
		const sequence = ++this.sequence;
		if (this.data.get() !== undefined) this.state.set({ kind: 'refreshing' }, undefined);
		let response: AnyResponse;
		try {
			response = await this.client.request(this.intent);
		} catch {
			response = { kind: 'error', reason: 'unavailable' };
		}
		if (!this._store.isDisposed && sequence === this.sequence) this.apply(response);
	}

	private apply(response: AnyResponse): void {
		this.clearTimers();
		transaction((tx) => {
			if (response.kind !== 'error') {
				this.data.set(structuralShare(this.data.get(), response), tx);
				this.lastGood = this.options.now();
				this.state.set({ kind: 'ready' }, tx);
				return;
			}
			this.state.set(
				this.data.get() === undefined
					? { kind: 'failed', reason: response.reason }
					: { kind: 'stale', reason: response.reason, since: this.lastGood },
				tx
			);
		});
	}

	private startDeadline(): void {
		const slow = setTimeout(() => {
			if (this.state.get().kind === 'loading')
				this.state.set({ kind: 'loading', slow: true }, undefined);
		}, this.options.slowMs);
		const deadline = setTimeout(() => {
			if (this.state.get().kind === 'loading')
				this.state.set({ kind: 'failed', reason: 'unavailable' }, undefined);
		}, this.options.deadlineMs);
		this.timers = toDisposable(() => {
			clearTimeout(slow);
			clearTimeout(deadline);
		});
	}

	private clearTimers(): void {
		this.timers?.dispose();
		this.timers = undefined;
	}
}

export class ServerDataService extends Disposable implements IServerDataService {
	declare readonly _serviceBrand: undefined;

	private readonly entries = new Map<string, Entry>();
	private readonly options: Required<ServerDataOptions>;

	constructor(
		private readonly clients: ServerDataClients,
		options: ServerDataOptions = {}
	) {
		super();
		this.options = {
			slowMs: options.slowMs ?? SERVER_DATA_SLOW_MS,
			deadlineMs: options.deadlineMs ?? SERVER_DATA_DEADLINE_MS,
			now: options.now ?? Date.now
		};
		this._register(
			toDisposable(() => {
				for (const entry of this.entries.values()) entry.dispose();
				this.entries.clear();
			})
		);
	}

	observe<C extends ServerDataCapability>(
		capability: C,
		intent: Intent<C>
	): IQueryObservation<ServerDataValue<C>, Failure<C>> {
		if (this._store.isDisposed) throw new Error('The server data service is disposed');
		const key = `${capability}:${stableKey(intent)}`;
		let entry = this.entries.get(key);
		if (!entry) {
			entry = new Entry(this.client(capability), intent, this.options);
			this.entries.set(key, entry);
		}
		const shared = entry;
		shared.refs++;
		let disposed = false;
		return {
			state: shared.state as IObservable<QueryState<Failure<C>>>,
			data: shared.data as IObservable<ServerDataValue<C> | undefined>,
			refresh: () => shared.refresh(),
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (--shared.refs > 0) return;
				shared.dispose();
				if (this.entries.get(key) === shared) this.entries.delete(key);
			}
		};
	}

	async change<C extends ServerDataCapability>(
		capability: C,
		intent: Intent<C>
	): Promise<Response<C>> {
		try {
			return (await this.client(capability).request(intent)) as Response<C>;
		} catch {
			// The reply was lost, so the change may have been applied.
			return { kind: 'error', reason: 'unconfirmed' } as Response<C>;
		}
	}

	private client(capability: ServerDataCapability): Client {
		return this.clients[capability] as unknown as Client;
	}
}

/** A key that is the same for equal intents whatever the order of their fields. */
export function stableKey(value: unknown): string {
	return JSON.stringify(value, (_key, field: unknown) =>
		field !== null && typeof field === 'object' && !Array.isArray(field)
			? Object.fromEntries(
					Object.entries(field as Record<string, unknown>).sort(([a], [b]) =>
						a < b ? -1 : a > b ? 1 : 0
					)
				)
			: field
	);
}

/**
 * The next value, reusing every part of the previous one that is deeply equal to it. Plain
 * objects and arrays are compared field by field; anything else is reused only when identical.
 */
export function structuralShare<T>(previous: unknown, next: T): T {
	if (previous === next) return next;
	if (Array.isArray(previous) && Array.isArray(next)) {
		let same = previous.length === next.length;
		const shared = next.map((item, index) => {
			const value = structuralShare(previous[index], item);
			if (value !== previous[index]) same = false;
			return value;
		});
		return (same ? previous : Object.freeze(shared)) as T;
	}
	if (isPlain(previous) && isPlain(next)) {
		const keys = Object.keys(next);
		let same = keys.length === Object.keys(previous).length;
		const shared: Record<string, unknown> = {};
		for (const key of keys) {
			const value = structuralShare(previous[key], next[key]);
			if (value !== previous[key] || !Object.hasOwn(previous, key)) same = false;
			shared[key] = value;
		}
		return (same ? previous : Object.freeze(shared)) as T;
	}
	return next;
}

function isPlain(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}
