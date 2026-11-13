/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeRequest } from '../../../../../src/prctr/platform/serverApi/node/requestEncoding.ts';
import type { SessionApi } from '../../../../../src/prctr/platform/serverApi/node/sessionApi.ts';
import {
	ServerScreenClipTransport,
	type ScreenClipAccess
} from '../../../../../src/prctr/workbench/services/screenClips/node/serverScreenClipTransport.ts';

interface Seen {
	readonly operation: string;
	readonly input: Record<string, unknown>;
}

function fakeApi(seen: Seen[], value: unknown): Pick<SessionApi, 'request'> {
	return {
		request: (async (operation: string, input: Record<string, unknown>) => {
			seen.push({ operation, input });
			return { status: 200, value, headers: {} };
		}) as unknown as SessionApi['request']
	};
}

const ATTEMPT = 'ybndrfg8ejkmcpqxot1uwisza3';
const live: ScreenClipAccess = { continuityCredential: 'c'.repeat(43), connectionId: 'conn-1' };

void test('listing and taking requests need the live Participation and send its headers', async () => {
	const seen: Seen[] = [];
	let access: ScreenClipAccess | undefined = live;
	const transport = new ServerScreenClipTransport(
		fakeApi(seen, { items: [] }),
		ATTEMPT,
		() => access
	);
	await transport.list();
	await transport.take('clip-1');
	assert.deepEqual(
		seen.map((entry) => [entry.operation, entry.input['header']]),
		[
			[
				'listCandidateScreenClipRequests',
				{
					'X-Proctor-Attempt-Credential': live.continuityCredential,
					'X-Proctor-Attempt-Connection-ID': 'conn-1'
				}
			],
			[
				'takeCandidateScreenClipRequest',
				{
					'X-Proctor-Attempt-Credential': live.continuityCredential,
					'X-Proctor-Attempt-Connection-ID': 'conn-1'
				}
			]
		]
	);
	access = undefined;
	await assert.rejects(transport.list(), 'no requests are taken after the Participation closes');
});

void test('an upload continues without the live headers after closure', async () => {
	const seen: Seen[] = [];
	const transport = new ServerScreenClipTransport(
		fakeApi(seen, { received_chunks: [1] }),
		ATTEMPT,
		() => undefined
	);
	assert.deepEqual(
		await transport.declare('clip-1', {
			media_type: 'video/mp4',
			size_bytes: 10,
			chunk_sha256: ['a'.repeat(64)]
		}),
		[1]
	);
	await transport.complete('clip-1', {
		content_digest: 'b'.repeat(64),
		signature: 's'.repeat(86)
	});
	assert.deepEqual(
		seen.map((entry) => [entry.operation, entry.input['header']]),
		[
			['beginCandidateScreenClipUpload', {}],
			['completeCandidateScreenClipUpload', {}]
		]
	);
});

void test('a chunk is sent as the raw request body with its index from 1', async () => {
	const seen: Seen[] = [];
	const transport = new ServerScreenClipTransport(fakeApi(seen, {}), ATTEMPT, () => live);
	const bytes = new Uint8Array([1, 2, 3]);
	await transport.putChunk('clip-1', 1, bytes);
	assert.equal(seen[0]?.operation, 'uploadCandidateScreenClipChunk');
	assert.deepEqual(seen[0]?.input['path'], {
		exam_attempt_id: ATTEMPT,
		screen_clip_id: 'clip-1',
		chunk: 1
	});
	assert.equal(seen[0]?.input['mediaType'], 'application/octet-stream');
	assert.equal(seen[0]?.input['body'], bytes);
});

void test('the packaged contract accepts a chunk as a raw octet-stream body', () => {
	const request = encodeRequest('https://example.edu', 'uploadCandidateScreenClipChunk', {
		path: { exam_attempt_id: ATTEMPT, screen_clip_id: 'ybndrfg8ejkmcpqxot1uwisza4', chunk: 1 },
		mediaType: 'application/octet-stream',
		body: new Uint8Array([1, 2, 3])
	});
	assert.equal(request.method, 'PUT');
	assert.equal(request.headers?.['Content-Type'], 'application/octet-stream');
});
