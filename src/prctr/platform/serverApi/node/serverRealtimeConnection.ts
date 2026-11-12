/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import WebSocket from 'ws';
import { ServerApiError } from '../common/serverApi.js';
import type { ServerCommandProblem } from '../common/serverEvents.js';
import { parseStrictContractJson } from './canonicalContract.js';

/** The server's own frame limit; a larger frame closes the connection. */
export const MAX_FRAME_BYTES = 256 * 1024;
/** Unsent bytes allowed to queue before a send is refused rather than buffered without bound. */
const MAX_BUFFERED_BYTES = 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const namePattern = /^[A-Za-z0-9_.:-]{1,128}$/u;
const noncePattern = /^[A-Za-z0-9_-]{43}$/u;

export interface RealtimeEventFrame {
	readonly kind: 'event';
	readonly sequence: number;
	readonly name: string;
	readonly userId?: string;
	readonly resource?: { readonly type: string; readonly id: string };
	readonly data: unknown;
}
export interface RealtimeReplyFrame {
	readonly kind: 'reply';
	readonly sequence: number;
	readonly ok: boolean;
	readonly data: unknown;
	readonly problem?: ServerCommandProblem;
}
export type RealtimeFrame = RealtimeEventFrame | RealtimeReplyFrame;
export interface RealtimeRequest {
	readonly sequence: number;
	readonly action: string;
	readonly data?: unknown;
}

/**
 * What a closed connection asks of its owner.
 * - `ended`: never reopen; the Session ended or refused the connection.
 * - `fresh`: reopen without resuming; the old position cannot be trusted.
 * - `resume`: reopen and offer the old position, after the usual backoff.
 * - `throttled`: reopen and resume after a long backoff; the server is shedding load.
 */
export type RealtimeClose = 'ended' | 'fresh' | 'resume' | 'throttled';

export interface RealtimeSink {
	/** Called for every valid frame, in arrival order, from the upgrade's first read onward. */
	frame(frame: RealtimeFrame): void;
	/** Called once when an opened connection closes. */
	closed(reason: RealtimeClose): void;
}
export interface RealtimeSocket {
	/** Throws `invalidRequest` for an unsendable or unbounded command, `sessionEnded` once closed. */
	send(request: RealtimeRequest): void;
	dispose(): void;
}
/** Headers for the upgrade; `challenge` carries the nonce a refused upgrade issued. */
export type UpgradeAuthorizer = (
	url: string,
	challenge?: { readonly nonce?: string }
) => Promise<Readonly<Record<string, string>>>;

/**
 * Opens one authenticated realtime connection. Redirects are refused, and a refused upgrade that
 * issues a DPoP nonce is retried once with a fresh proof. Every inbound frame is parsed strictly
 * and checked as an envelope before `sink` sees it; an invalid frame closes the connection.
 */
export async function openRealtimeConnection(
	url: string,
	authorize: UpgradeAuthorizer,
	sink: RealtimeSink,
	signal: AbortSignal
): Promise<RealtimeSocket> {
	let challenge: { nonce: string } | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (signal.aborted) throw new ServerApiError('cancelled');
		const headers = await authorize(url, challenge);
		if (signal.aborted) throw new ServerApiError('cancelled');
		const outcome = await upgrade(url, headers, sink, signal, attempt === 0);
		if ('socket' in outcome) return outcome.socket;
		challenge = { nonce: outcome.nonce };
	}
	throw new ServerApiError('server', { status: 401 });
}

function upgrade(
	url: string,
	headers: Readonly<Record<string, string>>,
	sink: RealtimeSink,
	signal: AbortSignal,
	mayRetry: boolean
): Promise<{ socket: RealtimeSocket } | { nonce: string }> {
	const target = new URL(url);
	target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
	const socket = new WebSocket(target, {
		headers,
		followRedirects: false,
		handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
		maxPayload: MAX_FRAME_BYTES,
		perMessageDeflate: false
	});
	let opened = false;
	let ended = false;
	let violated = false;
	const abort = () => socket.terminate();
	signal.addEventListener('abort', abort, { once: true });
	const finish = (): void => {
		if (ended) return;
		ended = true;
		signal.removeEventListener('abort', abort);
		socket.terminate();
	};
	// Listen before the upgrade completes: a hello can arrive in the same read as the upgrade.
	socket.on('message', (bytes, binary) => {
		if (ended || signal.aborted) return;
		const frame = binary ? undefined : readFrame(bytes);
		if (!frame) {
			violated = true;
			socket.terminate();
			return;
		}
		sink.frame(frame);
	});
	socket.on('close', (code) => {
		signal.removeEventListener('abort', abort);
		if (!opened || ended) return;
		ended = true;
		sink.closed(violated ? 'fresh' : closeReason(code));
	});
	return new Promise((resolve, reject) => {
		socket.once('open', () => {
			opened = true;
			resolve({
				socket: {
					send(request) {
						if (ended || socket.readyState !== WebSocket.OPEN)
							throw new ServerApiError('sessionEnded');
						if (
							!Number.isSafeInteger(request.sequence) ||
							request.sequence < 1 ||
							!namePattern.test(request.action)
						)
							throw new ServerApiError('invalidRequest');
						const text = JSON.stringify(request);
						if (
							Buffer.byteLength(text) > MAX_FRAME_BYTES ||
							socket.bufferedAmount > MAX_BUFFERED_BYTES
						)
							throw new ServerApiError('invalidRequest');
						socket.send(text);
					},
					dispose: finish
				}
			});
		});
		socket.once('error', () => {
			if (!opened) reject(new ServerApiError(signal.aborted ? 'cancelled' : 'network'));
		});
		socket.once('unexpected-response', (_request, response) => {
			const status = response.statusCode ?? 0;
			const nonce = response.headers['dpop-nonce'];
			response.destroy();
			finish();
			if (status === 401 && mayRetry && typeof nonce === 'string' && noncePattern.test(nonce))
				resolve({ nonce });
			else
				reject(
					new ServerApiError(
						status >= 300 && status < 400 ? 'redirectBlocked' : 'server',
						{
							status
						}
					)
				);
		});
	});
}

/** Close codes the server documents; anything else is an ordinary loss. */
function closeReason(code: number): RealtimeClose {
	switch (code) {
		case 4001: // Session revoked.
			return 'ended';
		case 4003: // Authorization changed: subscriptions must be authorized again.
			return 'fresh';
		case 4004: // Connection limit.
		case 4005: // Rate limited.
			return 'throttled';
		default: // 1000, 4000 server, 4002 backpressure, network.
			return 'resume';
	}
}

function readFrame(raw: WebSocket.RawData): RealtimeFrame | undefined {
	try {
		const bytes = Buffer.isBuffer(raw)
			? raw
			: raw instanceof ArrayBuffer
				? new Uint8Array(raw)
				: Buffer.concat(raw);
		const value = parseStrictContractJson(bytes, {
			integerNumbersOnly: false,
			maxBytes: MAX_FRAME_BYTES
		});
		if (!isRecord(value) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0)
			return undefined;
		const sequence = Number(value.sequence);
		if ('event' in value) {
			if (typeof value.event !== 'string' || !namePattern.test(value.event)) return undefined;
			if (value.id !== undefined && (typeof value.id !== 'string' || value.id.length > 64))
				return undefined;
			if (value.user_id !== undefined && typeof value.user_id !== 'string') return undefined;
			let resource: RealtimeEventFrame['resource'];
			if (value.resource !== undefined) {
				const candidate = value.resource;
				if (
					!isRecord(candidate) ||
					typeof candidate.type !== 'string' ||
					typeof candidate.id !== 'string' ||
					candidate.type.length > 64 ||
					candidate.id.length > 64
				)
					return undefined;
				resource = { type: candidate.type, id: candidate.id };
			}
			return {
				kind: 'event',
				sequence,
				name: value.event,
				...(typeof value.user_id === 'string' ? { userId: value.user_id } : {}),
				...(resource ? { resource } : {}),
				data: value.data
			};
		}
		if (value.status !== 'ok' && value.status !== 'error') return undefined;
		let problem: ServerCommandProblem | undefined;
		if (value.error !== undefined) {
			const error = value.error;
			if (
				!isRecord(error) ||
				typeof error.code !== 'string' ||
				!namePattern.test(error.code) ||
				typeof error.message !== 'string'
			)
				return undefined;
			problem = error as ServerCommandProblem;
		}
		if (value.status === 'error' && !problem) return undefined;
		return {
			kind: 'reply',
			sequence,
			ok: value.status === 'ok',
			data: value.data,
			...(problem ? { problem } : {})
		};
	} catch {
		return undefined;
	}
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
