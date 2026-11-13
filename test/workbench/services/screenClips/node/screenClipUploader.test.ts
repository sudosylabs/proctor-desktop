/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Emitter } from '../../../../../src/prctr/base/common/event.ts';
import type {
	ClipOutcome,
	ClipRange
} from '../../../../../src/prctr/platform/native/common/nativeAgentProtocol.generated.ts';
import type {
	ScreenClipManifest,
	ScreenClipRequest,
	ScreenClipTransport
} from '../../../../../src/prctr/workbench/services/screenClips/common/screenClips.ts';
import {
	ScreenClipUploader,
	clipRange
} from '../../../../../src/prctr/workbench/services/screenClips/node/screenClipUploader.ts';

const CHUNK = 10;

/** Seals `plain` exactly as the agent does: one ChaCha20-Poly1305 record per chunk. */
function sealClip(directory: string, plain: Buffer): Extract<ClipOutcome, { kind: 'ready' }> {
	const key = randomBytes(32);
	const records: Buffer[] = [];
	const hashes: string[] = [];
	for (let index = 0; index * CHUNK < plain.length; index += 1) {
		const chunk = plain.subarray(index * CHUNK, (index + 1) * CHUNK);
		hashes.push(createHash('sha256').update(chunk).digest('hex'));
		const nonce = Buffer.alloc(12);
		nonce.writeBigUInt64BE(BigInt(index), 4);
		const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
		cipher.setAAD(Buffer.from('proctor-screen-clip-v1'), { plaintextLength: chunk.length });
		records.push(cipher.update(chunk), cipher.final(), cipher.getAuthTag());
	}
	const path = join(directory, 'clip.clip');
	writeFileSync(path, Buffer.concat(records));
	return {
		kind: 'ready',
		path,
		key: key.toString('base64url'),
		media_type: 'video/mp4',
		size_bytes: plain.length,
		chunk_bytes: CHUNK,
		chunk_sha256: hashes,
		content_digest: 'd'.repeat(64),
		start_ms: 1_000,
		end_ms: 5_000,
		gaps: []
	};
}

class FakeServer implements ScreenClipTransport {
	public readonly taken: string[] = [];
	public readonly chunks = new Map<number, Buffer>();
	public readonly completed: { content_digest: string; signature: string }[] = [];
	public manifest: ScreenClipManifest | undefined;
	public constructor(
		private readonly requests: ScreenClipRequest[],
		private readonly alreadyReceived: number[] = []
	) {}
	public async list(cursor?: string) {
		return cursor === undefined
			? { items: this.requests.slice(0, 1), next_cursor: 'page-2' }
			: { items: this.requests.slice(1) };
	}
	public async take(clipId: string) {
		this.taken.push(clipId);
	}
	public async declare(_clipId: string, manifest: ScreenClipManifest) {
		this.manifest = manifest;
		return this.alreadyReceived;
	}
	public async putChunk(_clipId: string, index: number, bytes: Uint8Array) {
		this.chunks.set(index, Buffer.from(bytes));
	}
	public async complete(
		_clipId: string,
		completion: { content_digest: string; signature: string }
	) {
		this.completed.push(completion);
	}
}

class FakeRecorder {
	private readonly emitter = new Emitter<{ clipRequestId: string; outcome: ClipOutcome }>();
	public readonly onDidClip = this.emitter.event;
	public readonly saved: { id: string; range: ClipRange }[] = [];
	public readonly released: string[] = [];
	public async recorderSave(id: string, range: ClipRange) {
		this.saved.push({ id, range });
	}
	public async recorderRelease(id: string) {
		this.released.push(id);
	}
	public deliver(clipRequestId: string, outcome: ClipOutcome) {
		this.emitter.fire({ clipRequestId, outcome });
	}
}

function request(id: string, state = 'requested', fromStart = false): ScreenClipRequest {
	return {
		id,
		source: 'manager',
		state,
		range: fromStart
			? { from_session_start: true, end: '2026-11-13T10:00:05.000Z' }
			: {
					from_session_start: false,
					start: '2026-11-13T10:00:01.000Z',
					end: '2026-11-13T10:00:05.000Z'
				},
		revision: 1
	};
}

const signer = { sign: async (digest: string) => `signed-${digest.slice(0, 4)}` };

async function settled(uploader: ScreenClipUploader, clipId: string): Promise<void> {
	for (
		let attempt = 0;
		attempt < 200 && !['uploaded', 'failed'].includes(uploader.state(clipId) ?? '');
		attempt += 1
	)
		await new Promise((resolve) => setTimeout(resolve, 5));
}

void test('server timestamps become the agent range in unix ms', () => {
	assert.deepEqual(clipRange(request('a')), {
		from_session_start: false,
		start_ms: Date.parse('2026-11-13T10:00:01.000Z'),
		end_ms: Date.parse('2026-11-13T10:00:05.000Z')
	});
	assert.deepEqual(clipRange(request('a', 'requested', true)), {
		from_session_start: true,
		end_ms: Date.parse('2026-11-13T10:00:05.000Z')
	});
});

void test('every page is listed; new and own requests are taken and recorded, others skipped', async () => {
	const server = new FakeServer([request('a'), request('b', 'recording'), request('c', 'ready')]);
	const recorder = new FakeRecorder();
	const uploader = new ScreenClipUploader(server, recorder, signer);
	await uploader.poll();
	await uploader.poll();
	assert.deepEqual(server.taken, ['a', 'b'], 'once each, and the ready one is left alone');
	assert.deepEqual(
		recorder.saved.map((saved) => saved.id),
		['a', 'b']
	);
	uploader.dispose();
});

void test('an upload resumes past received chunks, verifies each one, signs, completes and releases', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'prctr-clips-'));
	try {
		const plain = randomBytes(35);
		const server = new FakeServer([request('a')], [1]);
		const recorder = new FakeRecorder();
		const uploader = new ScreenClipUploader(server, recorder, signer);
		await uploader.poll();
		recorder.deliver('a', sealClip(directory, plain));
		await settled(uploader, 'a');
		assert.equal(uploader.state('a'), 'uploaded');
		assert.deepEqual([...server.chunks.keys()], [2, 3, 4], 'chunk 1 was already on the server');
		assert.deepEqual(server.chunks.get(4), plain.subarray(30));
		assert.equal(server.manifest?.size_bytes, 35);
		assert.deepEqual(server.completed, [
			{ content_digest: 'd'.repeat(64), signature: 'signed-dddd' }
		]);
		assert.deepEqual(recorder.released, ['a'], 'released only after completion');
		uploader.dispose();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

void test('a tampered clip file fails and is never completed or released', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'prctr-clips-'));
	try {
		const server = new FakeServer([request('a')]);
		const recorder = new FakeRecorder();
		const uploader = new ScreenClipUploader(server, recorder, signer);
		await uploader.poll();
		const clip = sealClip(directory, randomBytes(25));
		recorder.deliver('a', {
			...clip,
			chunk_sha256: ['0'.repeat(64), ...clip.chunk_sha256.slice(1)]
		});
		await settled(uploader, 'a');
		assert.equal(uploader.state('a'), 'failed');
		assert.equal(server.completed.length, 0);
		assert.equal(recorder.released.length, 0);
		uploader.dispose();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

void test('at submission a clip still recording fails at the deadline', async () => {
	const server = new FakeServer([request('a'), request('b')]);
	const recorder = new FakeRecorder();
	const uploader = new ScreenClipUploader(server, recorder, signer);
	await uploader.poll();
	recorder.deliver('b', { kind: 'failed', code: 'empty' });
	const result = await uploader.drain(20);
	assert.deepEqual(result, { uploaded: 0, failed: 2 });
	assert.equal(uploader.state('a'), 'failed');
	uploader.dispose();
});
