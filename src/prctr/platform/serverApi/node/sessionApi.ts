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
import type { ServerDataTag } from '../common/serverDataTags.js';
import { SessionReads } from './sessionReads.js';
import type { HttpResponse } from './serverHttpTransport.js';
import { ServerEvents } from './serverEvents.js';
import { openRealtimeConnection, type UpgradeAuthorizer } from './serverRealtimeConnection.js';

export interface ApiRequestOptions {
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
	/**
	 * For a change: the tags it writes, so only reads holding them are fenced afterwards.
	 * Without it, a change fences every read of the Session.
	 */
	readonly fence?: readonly ServerDataTag[];
}
export interface SessionApiOptions {
	readonly binding: SessionBinding;
	/** The pinned Institution origin; no request can leave it. */
	readonly origin: string;
	/** Signs and sends one request. The credential never leaves this function. */
	readonly execute: (request: EncodedApiRequest) => Promise<HttpResponse>;
	/** Headers for the authenticated realtime upgrade; without it the Session has no events. */
	readonly authorizeUpgrade?: UpgradeAuthorizer;
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
	/** Live server events. Lost continuity refreshes every observed read once. */
	readonly events: ServerEvents;
	private readonly lifetime = new AbortController();
	private ended = false;

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
			})
		);
		this.reads = this._register(new SessionReads());
		const authorize = options.authorizeUpgrade;
		this.events = this._register(
			new ServerEvents({
				dial: (checkpoint, sink, signal) => {
					if (!authorize) return Promise.reject(new ServerApiError('sessionEnded'));
					const request = encodeRequest(this.origin, 'connectWebSocket', {
						query: checkpoint
							? {
									connection_id: checkpoint.connectionId,
									sequence_number: checkpoint.sequence
								}
							: {}
					});
					return openRealtimeConnection(request.url, authorize, sink, signal);
				}
			})
		);
		this._register(this.events.onDidLoseContinuity(() => this.reads.refresh()));
	}

	/**
	 * Sends one operation. A change fences the reads it wrote afterwards (all of them, unless it
	 * names its tags), so no read started before it can publish older data. Changes are sent
	 * once and never retried here.
	 */
	async request<K extends ApiOperationId>(
		id: K,
		input: ApiInput<K>,
		options: ApiRequestOptions = {}
	): Promise<ApiResponse<K>> {
		this.assertCurrent();
		if (id === 'connectWebSocket') throw new ServerApiError('invalidRequest');
		const request = encodeRequest(this.origin, id, input as ApiRequestInput);
		const { fence: _fence, ...transport } = options;
		const signal = AbortSignal.any([
			this.lifetime.signal,
			...(options.signal ? [options.signal] : [])
		]);
		let response: HttpResponse;
		try {
			response = await this.options.execute({ ...request, ...transport, signal });
		} catch (error) {
			this.assertCurrent();
			if (signal.aborted) throw new ServerApiError('cancelled');
			throw error instanceof ServerApiError ? error : new ServerApiError('network');
		}
		this.assertCurrent();
		if (signal.aborted) throw new ServerApiError('cancelled');
		const decoded = decodeResponse(request.operation, response) as ApiResponse<K>;
		if (!readMethods.has(request.method))
			await (options.fence
				? this.reads.invalidateTags(options.fence)
				: this.reads.invalidate());
		this.assertCurrent();
		if (signal.aborted) throw new ServerApiError('cancelled');
		return decoded;
	}

	setFocused(value: boolean): void {
		this.reads.setFocused(value);
	}
	setOnline(value: boolean): void {
		this.events.setOnline(value);
		this.reads.setOnline(value);
	}

	private assertCurrent(): void {
		if (this.ended) throw new ServerApiError('sessionEnded');
	}
}
