import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	operationContract,
	resolveSchema
} from '../../../../src/prctr/platform/serverApi/node/serverContract.js';
import { encodeRequest } from '../../../../src/prctr/platform/serverApi/node/requestEncoding.js';

const origin = 'https://institution.test';
const id = 'y'.repeat(26);

void test('operation inputs reject unknown routes/parameters, traversal and renderer-supplied authentication', () => {
	const request = encodeRequest(origin, 'getUserProfilePicture', { path: { user_id: id } });
	assert.equal(request.url, `${origin}/api/v1/users/${id}/profile-picture`);
	for (const value of ['..', '../me', 'l'.repeat(26)])
		assert.throws(() =>
			encodeRequest(origin, 'getUserProfilePicture', { path: { user_id: value } })
		);
	assert.throws(() =>
		encodeRequest(origin, 'getUserProfilePicture', {
			path: { user_id: id },
			query: { token: 'secret' }
		})
	);
	assert.throws(() =>
		encodeRequest(origin, 'exchangeDesktopAuthorizationCode', {
			header: { DPoP: 'secret' }
		})
	);
});

void test('multipart content keeps bytes and metadata encoding separate', async () => {
	const operation = operationContract('createCandidateExamWorkspaceFile');
	const schema = resolveSchema(operation.requestBody!.content['multipart/form-data'].schema!);
	assert.ok(schema.properties?.content);
	// Invalid metadata is rejected before any network request.
	assert.throws(() =>
		encodeRequest(origin, operation.id, {
			path: { exam_attempt_id: id },
			body: { content: new Uint8Array([0, 255]), metadata: {} }
		})
	);
	const upload = encodeRequest(origin, 'createCandidateExamWorkspaceFile', {
		path: { exam_attempt_id: id },
		header: {
			'X-Proctor-Attempt-Credential': 'a'.repeat(43),
			'X-Proctor-Attempt-Connection-ID': id,
			'Idempotency-Key': 'upload-1'
		},
		body: {
			content: new Uint8Array([0, 255]),
			metadata: {
				participation_id: id,
				generation: 1,
				path: 'main.ts',
				media_type: 'text/plain',
				size: 2,
				sha256: 'a'.repeat(64)
			}
		}
	});
	assert.ok(upload.body instanceof FormData);
	assert.deepEqual([...upload.body.keys()], ['metadata', 'content']);
	const metadata = upload.body.get('metadata');
	const content = upload.body.get('content');
	assert.ok(metadata instanceof Blob && content instanceof Blob);
	assert.equal(JSON.parse(await metadata.text()).size, 2);
	const encoded = await new Request(upload.url, {
		method: upload.method,
		body: upload.body
	}).text();
	assert.match(encoded, /name="metadata"\r\nContent-Type: application\/json/);
	assert.ok(encoded.indexOf('name="metadata"') < encoded.indexOf('name="content"'));
	const correction = encodeRequest(origin, 'stageExamSittingCorrectionResourceContent', {
		path: { exam_id: id, exam_sitting_id: id },
		header: { 'Idempotency-Key': 'stage-1' },
		body: {
			metadata: {
				base_revision_id: id,
				target_kind: 'addition',
				media_type: 'text/plain',
				size: 2,
				sha256: 'a'.repeat(64)
			},
			content: new Uint8Array([1, 2])
		}
	});
	const correctionWire = await new Request(correction.url, {
		method: correction.method,
		body: correction.body
	}).text();
	assert.match(correctionWire, /name="metadata"\r\nContent-Type: application\/json/);
	assert.ok(correctionWire.includes('"target_kind":"addition"'));

	assert.deepEqual(new Uint8Array(await content.arrayBuffer()), new Uint8Array([0, 255]));

	const photo = encodeRequest(origin, 'uploadUserProfilePicture', {
		path: { user_id: id },
		header: { 'If-Match': `"${'a'.repeat(64)}"` },
		mediaType: 'image/png',
		body: new Uint8Array([1, 2, 3])
	});
	assert.deepEqual(photo.body, new Uint8Array([1, 2, 3]));
	assert.equal(photo.headers?.['Content-Type'], 'image/png');
});

void test('a repeated query parameter is sent as every value it was given, in order', () => {
	const url = new URL(
		encodeRequest(origin, 'listCurrentUserAuditEvents', {
			query: { limit: 10, event: ['session.revoked', 'sign_in.succeeded'] }
		}).url
	);
	assert.deepEqual(url.searchParams.getAll('event'), ['session.revoked', 'sign_in.succeeded']);
	assert.equal(url.searchParams.get('limit'), '10');
	const single = new URL(
		encodeRequest(origin, 'listCurrentUserAuditEvents', {
			query: { event: ['session.revoked'] }
		}).url
	);
	assert.deepEqual(single.searchParams.getAll('event'), ['session.revoked']);
});
