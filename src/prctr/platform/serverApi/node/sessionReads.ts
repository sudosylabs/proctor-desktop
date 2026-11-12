/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { QueryClient, QueryObserver, hashKey, type QueryKey } from '@tanstack/query-core';
import { Disposable, toDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { ServerApiError } from '../common/serverApi.js';

/** A capability-owned cache key. Its first element names the capability that owns the read. */
export type ReadKey = readonly [capability: string, ...rest: readonly unknown[]];
export interface ReadPolicy {
	/** How long a value stays fresh; defaults to 30 seconds. */
	readonly staleTime?: number;
	/** How long an unobserved value is kept; defaults to 5 minutes. */
	readonly gcTime?: number;
	/** Re-reads while observed, online and focused; at least one second. */
	readonly pollIntervalMs?: number;
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
	private readonly refreshes = new Map<string, QueryKey | undefined>();
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
				for (const observation of [...this.observations]) observation.dispose();
				// A cancelled fetch can finish its Query Core finally block after clear(); keep that
				// detached query from scheduling a fresh garbage-collection timer.
				for (const query of this.queries.getQueryCache().getAll())
					query.setOptions({ ...query.options, gcTime: Infinity });
				this.queries.clear();
			})
		);
	}

	read<T>(key: ReadKey, load: ReadLoader<T>, policy: ReadPolicy = {}): Promise<T> {
		this.assertCurrent();
		return this.queries.fetchQuery({
			queryKey: key,
			queryFn: ({ signal }) => load(signal),
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
			queryFn: ({ signal }) => load(signal),
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
		if (this.ended) return;
		const filter = prefix ? { queryKey: prefix } : {};
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
		if (!this.refreshes.has('*')) this.refreshes.set(prefix ? hashKey(prefix) : '*', prefix);
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
			const filters = [...this.refreshes.values()].map((queryKey) =>
				queryKey ? { queryKey } : {}
			);
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
