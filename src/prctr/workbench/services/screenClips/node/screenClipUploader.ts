/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecipheriv, createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	ClipOutcome,
	ClipRange
} from '../../../../platform/native/common/nativeAgentProtocol.generated.js';
import type {
	ScreenClipRecorder,
	ScreenClipRequest,
	ScreenClipSigner,
	ScreenClipState,
	ScreenClipTransport
} from '../common/screenClips.js';

type ClipReady = Extract<ClipOutcome, { kind: 'ready' }>;

/** Requests the agent should record: new ones, and ones this Participation already took. */
const ACTIONABLE = new Set(['requested', 'recording']);
const CLIP_AAD = Buffer.from('proctor-screen-clip-v1');
const TAG_BYTES = 16;
const MAX_PAGES = 64;

export class ScreenClipUploadError extends Error {
	public constructor(public readonly reason: 'chunk_mismatch' | 'deadline') {
		super(`screen clip upload failed: ${reason}`);
		this.name = 'ScreenClipUploadError';
	}
}

/** Decrypts record `index` of a clip file: chunk plus tag, nonce = 4 zero bytes and the index. */
async function readChunk(clip: ClipReady, index: number): Promise<Buffer> {
	const offset = index * (clip.chunk_bytes + TAG_BYTES);
	const length =
		Math.min(clip.chunk_bytes, clip.size_bytes - index * clip.chunk_bytes) + TAG_BYTES;
	const file = await open(clip.path, 'r');
	try {
		const record = Buffer.alloc(length);
		const { bytesRead } = await file.read(record, 0, length, offset);
		const sealed = record.subarray(0, bytesRead);
		const nonce = Buffer.alloc(12);
		nonce.writeBigUInt64BE(BigInt(index), 4);
		const decipher = createDecipheriv(
			'chacha20-poly1305',
			Buffer.from(clip.key, 'base64url'),
			nonce,
			{
				authTagLength: TAG_BYTES
			}
		);
		decipher.setAAD(CLIP_AAD, { plaintextLength: sealed.length - TAG_BYTES });
		decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
		return Buffer.concat([
			decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
			decipher.final()
		]);
	} finally {
		await file.close();
	}
}

/** The agent's range for a server request: unix ms, the end inclusive of the future. */
export function clipRange(request: ScreenClipRequest): ClipRange {
	const end = Date.parse(request.range.end);
	if (request.range.from_session_start) return { from_session_start: true, end_ms: end };
	return {
		from_session_start: false,
		start_ms: Date.parse(request.range.start ?? ''),
		end_ms: end
	};
}

/**
 * Uploads the screen clips the server asks for during one Participation. It takes each request,
 * has the agent record it, then uploads only the chunks the server lacks (resumable), verifying
 * each decrypted chunk against the agent's hash, completes with the signed content digest and
 * releases the local clip. Nothing is uploaded that the server did not request.
 */
export class ScreenClipUploader extends Disposable {
	private readonly _onDidChangeState = this._register(
		new Emitter<{ readonly clipId: string; readonly state: ScreenClipState }>()
	);
	public readonly onDidChangeState = this._onDidChangeState.event;

	private readonly states = new Map<string, ScreenClipState>();
	private readonly uploads = new Map<string, Promise<void>>();
	private readonly waiting = new Map<string, () => void>();

	public constructor(
		private readonly transport: ScreenClipTransport,
		private readonly recorder: ScreenClipRecorder,
		private readonly signer: ScreenClipSigner
	) {
		super();
		this._register(
			recorder.onDidClip(({ clipRequestId, outcome }) => this.receive(clipRequestId, outcome))
		);
	}

	public state(clipId: string): ScreenClipState | undefined {
		return this.states.get(clipId);
	}

	private setState(clipId: string, state: ScreenClipState): void {
		if (this.states.get(clipId) === state) return;
		this.states.set(clipId, state);
		this._onDidChangeState.fire({ clipId, state });
		if (state === 'uploaded' || state === 'failed') this.waiting.get(clipId)?.();
	}

	/** Lists requests and starts every new one. Called on connect, on resume and on the realtime hint. */
	public async poll(): Promise<void> {
		let cursor: string | undefined;
		for (let page = 0; page < MAX_PAGES; page += 1) {
			const listed = await this.transport.list(cursor);
			for (const request of listed.items) {
				if (ACTIONABLE.has(request.state) && !this.states.has(request.id))
					await this.start(request);
			}
			cursor = listed.next_cursor;
			if (cursor === undefined) return;
		}
	}

	private async start(request: ScreenClipRequest): Promise<void> {
		this.setState(request.id, 'recording');
		try {
			await this.transport.take(request.id);
			await this.recorder.recorderSave(request.id, clipRange(request));
		} catch {
			this.setState(request.id, 'failed');
		}
	}

	private receive(clipId: string, outcome: ClipOutcome): void {
		if (outcome.kind === 'failed') {
			this.setState(clipId, 'failed');
			return;
		}
		if (this.uploads.has(clipId)) return;
		const upload = this.upload(clipId, outcome).catch(() => this.setState(clipId, 'failed'));
		this.uploads.set(clipId, upload);
	}

	private async upload(clipId: string, clip: ClipReady): Promise<void> {
		this.setState(clipId, 'uploading');
		const received = new Set(
			await this.transport.declare(clipId, {
				media_type: clip.media_type,
				size_bytes: clip.size_bytes,
				chunk_sha256: clip.chunk_sha256
			})
		);
		for (let index = 0; index < clip.chunk_sha256.length; index += 1) {
			if (received.has(index + 1)) continue;
			const chunk = await readChunk(clip, index);
			if (createHash('sha256').update(chunk).digest('hex') !== clip.chunk_sha256[index])
				throw new ScreenClipUploadError('chunk_mismatch');
			await this.transport.putChunk(clipId, index + 1, chunk);
		}
		const signature = await this.signer.sign(clip.content_digest);
		await this.transport.complete(clipId, { content_digest: clip.content_digest, signature });
		this.setState(clipId, 'uploaded');
		// The server holds the clip now, so releasing its file is best effort: a closed agent
		// refuses it, and the file then goes with the recording when that is deleted.
		await this.recorder.recorderRelease(clipId).catch(() => undefined);
	}

	/**
	 * At submission: waits until every clip in flight is uploaded or failed, at most `deadlineMs`;
	 * the rest fail. Electron main then closes the agent with `delete`.
	 */
	public async drain(
		deadlineMs: number
	): Promise<{ readonly uploaded: number; readonly failed: number }> {
		const pending = [...this.states].filter(
			([, state]) => state === 'recording' || state === 'uploading'
		);
		const settled = pending.map(
			([clipId]) => new Promise<void>((resolve) => this.waiting.set(clipId, resolve))
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.all(settled),
			new Promise<void>((resolve) => (timer = setTimeout(resolve, deadlineMs)))
		]);
		clearTimeout(timer);
		for (const [clipId] of pending) {
			const state = this.states.get(clipId);
			if (state === 'recording' || state === 'uploading') this.setState(clipId, 'failed');
		}
		const states = [...this.states.values()];
		return {
			uploaded: states.filter((state) => state === 'uploaded').length,
			failed: states.filter((state) => state === 'failed').length
		};
	}
}
