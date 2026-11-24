/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	QueryClient,
	QueryObserver,
	hashKey,
	type Query,
	type QueryFilters
} from '@tanstack/query-core';
import { Disposable, toDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { ServerApiError } from '../common/serverApi.js';
import { anyTagCovered, type ServerDataTag } from '../common/serverDataTags.js';

/** A capability-owned cache key. Its first element names the capability that owns the read. */
export type ReadKey = readonly [capability: string, ...rest: readonly unknown[]];
export interface ReadPolicy {
	/** How long a value stays fresh; defaults to 30 seconds. */
	readonly staleTime?: number;
	/** How long an unobserved value is kept; defaults to 5 minutes. */
	readonly gcTime?: number;
	/** Re-reads while observed, online and focused; at least one second. */
	readonly pollIntervalMs?: number;
	/** What the read holds, known before it answers; a change writing one fences it. */
	readonly tags?: readonly ServerDataTag[];
	/** What else an answer holds, such as one tag per listed row. */
	readonly valueTags?: (value: unknown) => readonly ServerDataTag[];
}
export interface ReadState<T> {
	readonly value: T | undefined;
	readonly error: ServerApiError | undefined;
	/** No value has been read yet. */
	readonly loading: boolean;
	/** A read is in flight; an existing value stays visible meanwhile. */
	readonly fetching: boolean;
}
export interface ReadObservation extends IDisposable {
	/** Re-reads now, joining a read already in flight. */
	refresh(): Promise<void>;
}
/** Loads one value. It throws a {@link ServerApiError} when the server or transport fails. */
export type ReadLoader<T> = (signal: AbortSignal) => Promise<T>;

const transientStatuses = new Set([429, 502, 503, 504]);
/** A server event hints one tag at most this often; later hints in the window join one pass. */
export const TAG_HINT_INTERVAL_MS = 2000;
const MAX_TIMER_MS = 2147483647;

/**
 * The read cache of one Session. Reads are shared and deduplicated by key and retried only for
 * transient failures, honouring Retry-After. Nothing here is persisted, and disposal clears it so
 * a late result can never publish into another Session.
 */
export class SessionReads extends Disposable {
	private readonly queries = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				gcTime: 300_000,
				retry: (count, error) => count < 2 && isTransient(error),
				retryDelay: (count, error) =>
					Math.min(
						MAX_TIMER_MS,
						error instanceof ServerApiError && error.retryAfterMs !== undefined
							? error.retryAfterMs
							: Math.min(30_000, 1000 * 2 ** count)
					),
				networkMode: 'always'
			},
			mutations: { retry: false, networkMode: 'always' }
		}
	});
	private readonly observations = new Set<ReadObservation>();
	private readonly refreshes = new Map<string, QueryFilters>();
	/** The tags of each cached read, by query hash: its policy's, then its last answer's. */
	private readonly tags = new Map<string, ReadonlySet<ServerDataTag>>();
	private readonly hinted = new Map<ServerDataTag, number>();
	private readonly hintTimers = new Map<ServerDataTag, ReturnType<typeof setTimeout>>();
	private refreshing = false;
	private focused = true;
	private online = true;
	private ended = false;

	constructor() {
		super();
		this._register(
			toDisposable(() => {
				this.ended = true;
				this.refreshes.clear();
				for (const timer of this.hintTimers.values()) clearTimeout(timer);
				this.hintTimers.clear();
				for (const observation of [...this.observations]) observation.dispose();
				// A cancelled fetch can finish its Query Core finally block after clear(); keep that
				// detached query from scheduling a fresh garbage-collection timer.
				for (const query of this.queries.getQueryCache().getAll())
					query.setOptions({ ...query.options, gcTime: Infinity });
				this.queries.clear();
				this.tags.clear();
			})
		);
		this._register(
			toDisposable(
				this.queries.getQueryCache().subscribe((event) => {
					if (event.type === 'removed') this.tags.delete(event.query.queryHash);
				})
			)
		);
	}

	read<T>(key: ReadKey, load: ReadLoader<T>, policy: ReadPolicy = {}): Promise<T> {
		this.assertCurrent();
		return this.queries.fetchQuery({
			queryKey: key,
			queryFn: this.tagged(key, load, policy),
			...freshness(policy)
		});
	}

	observe<T>(
		key: ReadKey,
		load: ReadLoader<T>,
		listener: (state: ReadState<T>) => void,
		policy: ReadPolicy = {}
	): ReadObservation {
		this.assertCurrent();
		const poll = policy.pollIntervalMs;
		if (
			poll !== undefined &&
			(!Number.isSafeInteger(poll) || poll < 1000 || poll > MAX_TIMER_MS)
		)
			throw new ServerApiError('invalidRequest');
		const observer = new QueryObserver<T, Error>(this.queries, {
			queryKey: key,
			queryFn: this.tagged(key, load, policy),
			...freshness(policy)
		});
		let active = true;
		let subscribing = true;
		let timer: ReturnType<typeof setInterval> | undefined;
		const observation: ReadObservation = {
			refresh: async () => {
				this.assertCurrent();
				if (!active) throw new ServerApiError('cancelled');
				await observer.refetch({ cancelRefetch: false });
			},
			dispose: () => {
				if (!active) return;
				active = false;
				clearInterval(timer);
				observer.destroy();
				this.observations.delete(observation);
			}
		};
		this.observations.add(observation);
		const publish = () => {
			if (subscribing || !active || this.ended) return;
			const state = observer.getCurrentResult();
			try {
				listener({
					value: state.data,
					loading: state.isPending,
					fetching: state.isFetching,
					error: state.error ? asServerApiError(state.error) : undefined
				});
			} catch {
				observation.dispose();
			}
		};
		try {
			observer.subscribe(publish);
			subscribing = false;
			publish();
			// Query Core's polling assumes a browser; Electron main owns the timer instead.
			if (active && !this.ended && poll !== undefined) {
				timer = setInterval(() => {
					if (this.online && this.focused)
						void observer.refetch({ cancelRefetch: false });
				}, poll);
				timer.unref();
			}
		} catch (error) {
			observation.dispose();
			throw error;
		}
		return observation;
	}

	/**
	 * The fence after a change: cancels reads in flight under `prefix`, which could otherwise
	 * publish data from before the change, then re-reads the observed ones.
	 */
	async invalidate(prefix?: ReadKey): Promise<void> {
		await this.fence(prefix ? { queryKey: prefix } : {});
	}

	/**
	 * The fence after a change that names what it wrote: only reads holding a written tag, or
	 * one below it, are cancelled and re-read.
	 */
	async invalidateTags(written: readonly ServerDataTag[]): Promise<void> {
		if (written.length) await this.fence({ predicate: this.covered(written) });
	}

	/**
	 * A server event's hint that data under `tags` changed. Each tag refreshes at most once per
	 * {@link TAG_HINT_INTERVAL_MS}; a hint inside the window waits for its end and joins one pass.
	 */
	refreshTags(tags: readonly ServerDataTag[]): void {
		if (this.ended) return;
		for (const tag of tags) {
			if (this.hintTimers.has(tag)) continue;
			const wait = (this.hinted.get(tag) ?? -Infinity) + TAG_HINT_INTERVAL_MS - Date.now();
			if (wait <= 0) {
				this.hint(tag);
				continue;
			}
			const timer = setTimeout(() => {
				this.hintTimers.delete(tag);
				this.hint(tag);
			}, wait);
			timer.unref?.();
			this.hintTimers.set(tag, timer);
		}
	}

	private hint(tag: ServerDataTag): void {
		if (this.ended) return;
		this.hinted.set(tag, Date.now());
		this.enqueue(`tag:${tag}`, { predicate: this.covered([tag]) });
	}

	private covered(written: readonly ServerDataTag[]): (query: Query) => boolean {
		return (query) => anyTagCovered(written, this.tags.get(query.queryHash) ?? []);
	}

	/** Remembers a read's tags, then those of each answer, so a change can find it. */
	private tagged<T>(
		key: ReadKey,
		load: ReadLoader<T>,
		policy: ReadPolicy
	): (context: { signal: AbortSignal }) => Promise<T> {
		const hash = hashKey(key);
		const fixed = policy.tags ?? [];
		if (fixed.length && !this.tags.has(hash)) this.tags.set(hash, new Set(fixed));
		return async ({ signal }) => {
			const value = await load(signal);
			if (!this.ended)
				this.tags.set(hash, new Set([...fixed, ...(policy.valueTags?.(value) ?? [])]));
			return value;
		};
	}

	private async fence(filter: QueryFilters): Promise<void> {
		if (this.ended) return;
		// Cancel first: Query Core otherwise reuses a pending initial fetch even with cancelRefetch.
		await this.queries.cancelQueries(filter);
		if (this.ended) return;
		await this.queries.invalidateQueries({ ...filter, refetchType: 'active' });
	}

	/**
	 * A hint that data under `prefix` changed, as a server event says. Hints coalesce: reads in
	 * flight finish, then the observed reads under every hinted prefix are re-read once. A burst
	 * queues one following pass instead of repeatedly aborting a slow read.
	 */
	refresh(prefix?: ReadKey): void {
		if (this.ended) return;
		if (!prefix) this.refreshes.clear();
		this.enqueue(prefix ? hashKey(prefix) : '*', prefix ? { queryKey: prefix } : {});
	}

	private enqueue(id: string, filter: QueryFilters): void {
		if (!this.refreshes.has('*')) this.refreshes.set(id, filter);
		if (this.refreshing) return;
		this.refreshing = true;
		void this.drainRefreshes()
			.finally(() => {
				this.refreshing = false;
			})
			.catch(() => {});
	}

	setFocused(value: boolean): void {
		const changed = this.focused !== value;
		this.focused = value;
		if (changed && value && this.online) this.refetchStale();
	}
	setOnline(value: boolean): void {
		const changed = this.online !== value;
		this.online = value;
		if (changed && value) this.refetchStale();
	}

	private async drainRefreshes(): Promise<void> {
		while (!this.ended && this.refreshes.size) {
			const filters = [...this.refreshes.values()];
			this.refreshes.clear();
			const pending = new Set(
				filters.flatMap((filter) =>
					this.queries
						.getQueryCache()
						.findAll({ ...filter, type: 'active' })
						.map((query) => query.promise)
				)
			);
			await Promise.all([...pending].map((promise) => promise?.catch(() => {})));
			if (this.ended) return;
			await Promise.all(
				filters.map((filter) =>
					this.queries.invalidateQueries(
						{ ...filter, refetchType: 'active' },
						{ cancelRefetch: false }
					)
				)
			);
		}
	}
	private refetchStale(): void {
		if (!this.ended)
			void this.queries.refetchQueries(
				{ type: 'active', stale: true },
				{ cancelRefetch: false }
			);
	}
	private assertCurrent(): void {
		if (this.ended) throw new ServerApiError('sessionEnded');
	}
}

function freshness(policy: ReadPolicy): { staleTime?: number; gcTime?: number } {
	return {
		...(policy.staleTime === undefined ? {} : { staleTime: policy.staleTime }),
		...(policy.gcTime === undefined ? {} : { gcTime: policy.gcTime })
	};
}
function isTransient(error: unknown): boolean {
	return (
		error instanceof ServerApiError &&
		(error.kind === 'network' ||
			error.kind === 'timeout' ||
			(error.kind === 'server' && transientStatuses.has(error.status ?? 0)))
	);
}
/** A read that failed outside the server API, such as a projection that refused the data. */
function asServerApiError(error: Error): ServerApiError {
	return error instanceof ServerApiError ? error : new ServerApiError('invalidResponse');
}
