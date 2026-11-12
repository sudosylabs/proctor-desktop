/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import {
	ServerApiError,
	type ApiInput,
	type ApiOperationId,
	type ApiResponse
} from '../common/serverApi.js';
import type { SessionBinding } from '../common/projection.js';
import { encodeRequest, type ApiRequestInput, type EncodedApiRequest } from './requestEncoding.js';
import { decodeResponse } from './responseDecoding.js';
import { SessionReads } from './sessionReads.js';
import type { HttpResponse } from './serverHttpTransport.js';
import {
	ServerRealtimeClient,
	type RealtimeEvent,
	type RealtimePolicy
} from './serverRealtimeClient.js';
import { connectServerRealtime, type ConnectionAuthorizer } from './serverRealtime.js';
import type { ReadKey } from './sessionReads.js';

export interface ApiRequestOptions {
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
}
export interface SessionApiOptions {
	readonly binding: SessionBinding;
	/** The pinned Institution origin; no request can leave it. */
	readonly origin: string;
	/** Signs and sends one request. The credential never leaves this function. */
	readonly execute: (request: EncodedApiRequest) => Promise<HttpResponse>;
	/** Headers for the authenticated realtime upgrade. */
	readonly authorizeUpgrade?: ConnectionAuthorizer;
}
export interface ApiRealtimePolicy extends RealtimePolicy {
	/** Domain-owned mapping from an event to the reads it may have changed. */
	readonly invalidate?: (event: RealtimeEvent) => readonly ReadKey[];
}
const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The server API of one authenticated Session: typed operations from the packaged contract and
 * the Session's read cache. Disposal aborts every request and clears the cache, so nothing it
 * started can publish once another Session uses the window.
 */
export class SessionApi extends Disposable {
	readonly binding: SessionBinding;
	readonly origin: string;
	readonly reads: SessionReads;
	private readonly lifetime = new AbortController();
	private readonly connections = new Set<ServerRealtimeClient>();
	private ended = false;
	private online = true;

	constructor(private readonly options: SessionApiOptions) {
		super();
		const url = new URL(options.origin);
		if (
			url.origin !== options.origin ||
			url.username ||
			url.password ||
			!['https:', 'http:'].includes(url.protocol)
		)
			throw new ServerApiError('invalidRequest');
		this.binding = options.binding;
		this.origin = options.origin;
		this._register(
			toDisposable(() => {
				this.ended = true;
				this.lifetime.abort();
				for (const connection of [...this.connections]) connection.dispose();
			})
		);
		this.reads = this._register(new SessionReads());
	}

	/**
	 * Sends one operation. A change fences the Session's reads afterwards, so no read started
	 * before it can publish older data. Changes are sent once and never retried here.
	 */
	async request<K extends ApiOperationId>(
		id: K,
		input: ApiInput<K>,
		options: ApiRequestOptions = {}
	): Promise<ApiResponse<K>> {
		this.assertCurrent();
		if (id === 'connectWebSocket') throw new ServerApiError('invalidRequest');
		const request = encodeRequest(this.origin, id, input as ApiRequestInput);
		const signal = AbortSignal.any([
			this.lifetime.signal,
			...(options.signal ? [options.signal] : [])
		]);
		let response: HttpResponse;
		try {
			response = await this.options.execute({ ...request, ...options, signal });
		} catch (error) {
			this.assertCurrent();
			if (signal.aborted) throw new ServerApiError('cancelled');
			throw error instanceof ServerApiError ? error : new ServerApiError('network');
		}
		this.assertCurrent();
		if (signal.aborted) throw new ServerApiError('cancelled');
		const decoded = decodeResponse(request.operation, response) as ApiResponse<K>;
		if (!readMethods.has(request.method)) await this.reads.invalidate();
		this.assertCurrent();
		if (signal.aborted) throw new ServerApiError('cancelled');
		return decoded;
	}

	createRealtime(options: ApiRealtimePolicy = {}): ServerRealtimeClient {
		const { invalidate: affected, ...policy } = options;
		this.assertCurrent();
		const authorize = this.options.authorizeUpgrade;
		if (!authorize || this.connections.size >= 4) throw new ServerApiError('invalidRequest');
		const client = new ServerRealtimeClient((checkpoint, signal, message, closed) => {
			const request = encodeRequest(this.origin, 'connectWebSocket', {
				query: checkpoint
					? {
							connection_id: checkpoint.connectionId,
							sequence_number: checkpoint.sequence
						}
					: {}
			});
			return connectServerRealtime(request.url, authorize, signal, message, closed);
		}, policy);
		this.connections.add(client);
		client.onEvent((event) => {
			for (const prefix of affected?.(event) ?? []) this.reads.refresh(prefix);
		});
		let needsResync = false;
		client.onState((state) => {
			if (state.needsResync && !needsResync) this.reads.refresh();
			needsResync = state.needsResync;
			if (state.error?.kind === 'sessionEnded') this.connections.delete(client);
		});
		client.setOnline(this.online);
		return client;
	}

	setFocused(value: boolean): void {
		this.reads.setFocused(value);
	}
	setOnline(value: boolean): void {
		this.online = value;
		for (const connection of this.connections) connection.setOnline(value);
		this.reads.setOnline(value);
	}

	private assertCurrent(): void {
		if (this.ended) throw new ServerApiError('sessionEnded');
	}
}
