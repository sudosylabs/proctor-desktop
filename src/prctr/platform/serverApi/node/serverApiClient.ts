import {
	ServerRealtimeClient,
	type RealtimePolicy,
	type RealtimeEvent
} from './serverRealtimeClient.js';
import { connectServerRealtime, type ConnectionAuthorizer } from './serverRealtime.js';
import { QueryClient, QueryObserver, hashKey, type QueryKey } from '@tanstack/query-core';
import {
	ServerApiError,
	type ApiInput,
	type ApiOperationId,
	type ApiQueryState,
	type ApiResponse
} from '../common/serverApi.js';
import {
	encodeRequest,
	isCacheableRequest,
	type ApiRequestInput,
	type EncodedApiRequest
} from './requestEncoding.js';
import { decodeResponse } from './responseDecoding.js';
import { ServerHttpTransport, type HttpResponse } from './serverHttpTransport.js';

export interface ApiRealtimePolicy extends RealtimePolicy {
	/** Domain-owned mapping; terminal output and unrelated events need not invalidate HTTP data. */
	readonly invalidate?: (event: RealtimeEvent) => readonly QueryKey[];
}
export interface ApiQueryPolicy {
	readonly staleTime?: number;
	readonly gcTime?: number;
	readonly pollIntervalMs?: number;
}
export interface ApiRequestOptions {
	readonly signal?: AbortSignal;
	readonly maxResponseBytes?: number;
	readonly timeoutMs?: number;
}
export type ApiExecutor = (request: EncodedApiRequest) => Promise<HttpResponse>;
export interface ApiObservation {
	dispose(): void;
	refresh(): Promise<void>;
}

/** One server/session owns one client. Its cache and requests never survive disposal. */
export class ServerApiClient {
	private readonly queries = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				gcTime: 300_000,
				retry: (count, error) =>
					count < 2 &&
					error instanceof ServerApiError &&
					(error.kind === 'network' ||
						error.kind === 'timeout' ||
						(error.kind === 'server' &&
							[429, 502, 503, 504].includes(error.status ?? 0))),
				retryDelay: (count, error) =>
					Math.min(
						2147483647,
						error instanceof ServerApiError && error.retryAfterMs !== undefined
							? error.retryAfterMs
							: Math.min(30_000, 1000 * 2 ** count)
					),
				networkMode: 'always'
			},
			mutations: { retry: false, networkMode: 'always' }
		}
	});
	private readonly lifetime = new AbortController();
	private readonly observations = new Set<ApiObservation>();
	private focused = true;
	private online = true;
	private disposed = false;
	private readonly realtimeInvalidations = new Map<string, QueryKey | undefined>();
	private refreshingRealtime = false;
	private readonly connections = new Set<ServerRealtimeClient>();
	constructor(
		readonly origin: string,
		private readonly execute: ApiExecutor = (request) =>
			new ServerHttpTransport().send(request),
		private readonly authorizeConnection?: ConnectionAuthorizer
	) {
		const url = new URL(origin);
		if (
			url.origin !== origin ||
			url.username ||
			url.password ||
			!['https:', 'http:'].includes(url.protocol)
		)
			throw new ServerApiError('invalidRequest');
	}
	createRealtime(options: ApiRealtimePolicy = {}): ServerRealtimeClient {
		const { invalidate: affectedQueries, ...policy } = options;
		this.assertCurrent();
		if (!this.authorizeConnection || this.connections.size >= 4)
			throw new ServerApiError('invalidRequest');
		const authorize = this.authorizeConnection;
		const client = new ServerRealtimeClient((checkpoint, signal, message, closed) => {
			const input: ApiInput<'connectWebSocket'> = {
				query: checkpoint
					? {
							connection_id: checkpoint.connectionId,
							sequence_number: checkpoint.sequence
						}
					: {}
			};
			const request = encodeRequest(this.origin, 'connectWebSocket', input);
			return connectServerRealtime(request.url, authorize, signal, message, closed);
		}, policy);
		this.connections.add(client);
		client.onEvent((event) => {
			for (const prefix of affectedQueries?.(event) ?? [])
				this.queueRealtimeInvalidation(prefix);
		});
		let needsResync = false;
		client.onState((state) => {
			if (state.needsResync && !needsResync) this.queueRealtimeInvalidation();
			needsResync = state.needsResync;
			if (state.error?.kind === 'sessionEnded') this.connections.delete(client);
		});
		client.setOnline(this.online);
		return client;
	}

	private queueRealtimeInvalidation(prefix?: QueryKey): void {
		if (this.disposed) return;
		if (!prefix) this.realtimeInvalidations.clear();
		if (!this.realtimeInvalidations.has('*'))
			this.realtimeInvalidations.set(prefix ? hashKey(prefix) : '*', prefix);
		if (this.refreshingRealtime) return;
		this.refreshingRealtime = true;
		void Promise.resolve()
			.then(async () => {
				try {
					while (!this.disposed && this.realtimeInvalidations.size) {
						const prefixes = [...this.realtimeInvalidations.values()];
						this.realtimeInvalidations.clear();
						// Let older reads finish, then fetch authoritative data. Bursts queue a following pass
						// rather than repeatedly aborting slow requests as mutation fencing must do.
						const filters = prefixes.map((queryKey) => (queryKey ? { queryKey } : {}));
						const pending = new Set(
							filters.flatMap((filter) =>
								this.queries
									.getQueryCache()
									.findAll({ ...filter, type: 'active' })
									.map((query) => query.promise)
							)
						);
						await Promise.all([...pending].map((promise) => promise?.catch(() => {})));
						if (this.disposed) return;
						await Promise.all(
							filters.map((filter) =>
								this.queries.invalidateQueries(
									{ ...filter, refetchType: 'active' },
									{ cancelRefetch: false }
								)
							)
						);
					}
				} finally {
					this.refreshingRealtime = false;
				}
			})
			.catch(() => {});
	}

	async request<K extends ApiOperationId>(
		id: K,
		input: ApiInput<K>,
		options: ApiRequestOptions = {}
	): Promise<ApiResponse<K>> {
		this.assertCurrent();
		const prepared = encodeRequest(this.origin, id, input as ApiRequestInput);
		if (id === 'connectWebSocket') throw new ServerApiError('invalidRequest');
		const signal = AbortSignal.any([
			this.lifetime.signal,
			...(options.signal ? [options.signal] : [])
		]);
		let result: HttpResponse;
		try {
			result = await this.execute({ ...prepared, ...options, signal });
		} catch (error) {
			this.assertCurrent();
			if (signal.aborted) throw new ServerApiError('cancelled');
			throw error instanceof ServerApiError ? error : new ServerApiError('network');
		}
		this.assertCurrent();
		if (signal.aborted) throw new ServerApiError('cancelled');
		const response = decodeResponse(prepared.operation, result) as ApiResponse<K>;
		if (!['GET', 'HEAD', 'OPTIONS'].includes(prepared.method)) await this.invalidate();
		this.assertCurrent();
		if (signal.aborted) throw new ServerApiError('cancelled');
		return response;
	}
	fetch<K extends ApiOperationId>(
		id: K,
		input: ApiInput<K>,
		policy: ApiQueryPolicy = {}
	): Promise<ApiResponse<K>> {
		if (
			!isCacheableRequest(encodeRequest(this.origin, id, input as ApiRequestInput)) ||
			id === 'connectWebSocket'
		)
			throw new ServerApiError('invalidRequest');
		return this.fetchTask(
			['operation', id, input],
			(signal) => this.request(id, input, { signal }),
			policy
		);
	}
	observe<K extends ApiOperationId>(
		id: K,
		input: ApiInput<K>,
		listener: (state: ApiQueryState<ApiResponse<K>>) => void,
		policy: ApiQueryPolicy = {}
	): ApiObservation {
		if (
			!isCacheableRequest(encodeRequest(this.origin, id, input as ApiRequestInput)) ||
			id === 'connectWebSocket'
		)
			throw new ServerApiError('invalidRequest');
		return this.observeTask(
			['operation', id, input],
			(signal) => this.request(id, input, { signal }),
			listener,
			policy
		);
	}
	/** Privileged projections use this same cache without publishing raw server DTOs over IPC. */
	fetchTask<T>(
		key: QueryKey,
		read: (signal: AbortSignal) => Promise<T>,
		policy: ApiQueryPolicy = {}
	): Promise<T> {
		this.assertCurrent();
		return this.queries.fetchQuery({
			queryKey: key,
			queryFn: ({ signal }) => read(signal),
			...(policy.staleTime === undefined ? {} : { staleTime: policy.staleTime }),
			...(policy.gcTime === undefined ? {} : { gcTime: policy.gcTime })
		});
	}
	observeTask<T>(
		key: QueryKey,
		read: (signal: AbortSignal) => Promise<T>,
		listener: (state: ApiQueryState<T>) => void,
		policy: ApiQueryPolicy = {}
	): ApiObservation {
		this.assertCurrent();
		if (
			policy.pollIntervalMs !== undefined &&
			(!Number.isSafeInteger(policy.pollIntervalMs) ||
				policy.pollIntervalMs < 1000 ||
				policy.pollIntervalMs > 2147483647)
		)
			throw new ServerApiError('invalidRequest');
		const observer = new QueryObserver<T, Error>(this.queries, {
			queryKey: key,
			queryFn: ({ signal }) => read(signal),
			...(policy.staleTime === undefined ? {} : { staleTime: policy.staleTime }),
			...(policy.gcTime === undefined ? {} : { gcTime: policy.gcTime })
		});
		let active = true;
		let subscribing = true;
		let timer: ReturnType<typeof setInterval> | undefined;
		const observation: ApiObservation = {
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
			if (subscribing || !active || this.disposed) return;
			const state = observer.getCurrentResult();
			try {
				listener({
					data: state.data,
					loading: state.isPending,
					fetching: state.isFetching,
					error: state.error
						? state.error instanceof ServerApiError
							? state.error
							: new ServerApiError('invalidResponse')
						: undefined
				});
			} catch {
				observation.dispose();
			}
		};
		try {
			observer.subscribe(publish);
			subscribing = false;
			publish();
			// Query Core disables browser polling in Node; main owns the observation timer.
			if (active && !this.disposed && policy.pollIntervalMs !== undefined) {
				timer = setInterval(() => {
					if (this.online && this.focused)
						void observer.refetch({ cancelRefetch: false });
				}, policy.pollIntervalMs);
				timer.unref();
			}
		} catch (error) {
			observation.dispose();
			throw error;
		}
		return observation;
	}
	async invalidate(prefix?: QueryKey): Promise<void> {
		if (this.disposed) return;
		const filter = prefix ? { queryKey: prefix } : {};
		// Cancel first: Query Core otherwise reuses a pending initial fetch even with cancelRefetch.
		await this.queries.cancelQueries(filter);
		if (this.disposed) return;
		await this.queries.invalidateQueries({ ...filter, refetchType: 'active' });
	}

	setFocused(value: boolean): void {
		const changed = this.focused !== value;
		this.focused = value;
		if (changed && value && this.online && !this.disposed)
			void this.queries.refetchQueries(
				{ type: 'active', stale: true },
				{ cancelRefetch: false }
			);
	}
	setOnline(value: boolean): void {
		const changed = this.online !== value;
		this.online = value;
		for (const connection of this.connections) connection.setOnline(value);
		if (changed && value && !this.disposed)
			void this.queries.refetchQueries(
				{ type: 'active', stale: true },
				{ cancelRefetch: false }
			);
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.lifetime.abort();
		this.realtimeInvalidations.clear();
		for (const observation of [...this.observations]) observation.dispose();
		for (const connection of [...this.connections]) connection.dispose();
		// A cancelled fetch can finish its Query Core finally block after clear().
		// Prevent that detached query from scheduling a fresh garbage-collection timer.
		for (const query of this.queries.getQueryCache().getAll())
			query.setOptions({ ...query.options, gcTime: Infinity });
		this.queries.clear();
	}
	private assertCurrent(): void {
		if (this.disposed) throw new ServerApiError('sessionEnded');
	}
}
