import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import type {
	ClipOutcome,
	Notification,
	Policy,
	RecordingStart
} from '../../src/prctr/platform/native/common/nativeAgentProtocol.generated.ts';
import {
	NativeAgentConnection,
	NativeAgentConnectionError,
	unsignedDevelopmentVerifier,
	type NativeAgentFailure
} from '../../src/prctr/platform/native/node/nativeAgentConnection.ts';
import { NativeAgentService } from '../../src/prctr/platform/native/electron-main/nativeAgentService.ts';

const EXECUTABLE = join(
	process.cwd(),
	'.build',
	'native-agent',
	process.platform === 'win32' ? 'prctr-agent.exe' : 'prctr-agent'
);
const LAUNCH = {
	executable: EXECUTABLE,
	buildIdentity: 'development',
	verifier: unsignedDevelopmentVerifier
} as const;
const COLLECTION = 'collection-session-0001';

const POLICY: Policy = {
	activations: [{ capability: 'scripted', categories: [] }],
	rules: [
		{
			rule_id: 'count_is_one',
			capability: 'scripted',
			mode: 'enforce',
			phase: 'both',
			reason: 'scripted.reason',
			requirement: { Compare: { field: 'scripted.count', op: 'eq', value: 1 } }
		}
	]
};

function next<T>(
	subscribe: (listener: (value: T) => void) => { dispose(): void },
	accept: (value: T) => boolean,
	timeoutMs = 6_000
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			listener.dispose();
			reject(new Error('timed out waiting for an event'));
		}, timeoutMs);
		const listener = subscribe((value) => {
			if (!accept(value)) return;
			clearTimeout(timer);
			listener.dispose();
			resolve(value);
		});
	});
}

void test('the handshake binds the build identity and the protocol digest', async () => {
	const connection = await NativeAgentConnection.launch(LAUNCH);
	try {
		const response = await connection.request({ kind: 'query', capability: 'scripted' });
		assert.equal(response.kind, 'queried');
		if (response.kind === 'queried') {
			assert.equal(response.fact.capability, 'scripted');
			assert.deepEqual(response.fact.state, { count: 1 });
		}
	} finally {
		await connection.close('delete');
		connection.dispose();
	}
	await assert.rejects(
		NativeAgentConnection.launch({ ...LAUNCH, buildIdentity: 'another-build' }),
		(error: unknown) =>
			error instanceof NativeAgentConnectionError && error.failure === 'handshake'
	);
});

void test('an unregistered or sensitive capability cannot be queried', async () => {
	const connection = await NativeAgentConnection.launch(LAUNCH);
	try {
		const response = await connection.request({ kind: 'query', capability: 'display' });
		assert.deepEqual(response, { kind: 'refused', code: 'unknown_capability' });
	} finally {
		await connection.close('delete');
		connection.dispose();
	}
});

void test('a malformed frame ends the agent with the protocol exit code', async () => {
	const child = spawn(EXECUTABLE, [], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
	let stderr = '';
	child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
	const exited = new Promise<number | null>((resolve) =>
		child.once('exit', (code) => resolve(code))
	);
	const oversized = Buffer.alloc(4);
	oversized.writeUInt32BE(1024 * 1024 + 1, 0);
	child.stdin.write(oversized);
	assert.equal(await exited, 70);
	assert.match(stderr, /prctr-agent:(handshake_mismatch|protocol_error)/);
});

void test('readiness continues into participation without a gap and contains on a violation', async () => {
	const service = new NativeAgentService({ launch: LAUNCH });
	try {
		const opened = await service.openReadiness(COLLECTION, POLICY);
		assert.equal(opened.facts[0]?.sequence, 0);
		assert.deepEqual(
			opened.rules.map((rule) => rule.status),
			['met']
		);
		const begun = await service.beginParticipation();
		assert.equal(
			begun.facts[0]?.source_instance_id,
			opened.facts[0]?.source_instance_id,
			'same session, no reset'
		);
		await service.confirmParticipation();
		assert.equal(service.contained, false);

		const contained = next(service.onDidChangeContainment, (value) => value);
		const fact = next<Notification>(
			service.onDidNotify,
			(notification) => notification.kind === 'fact'
		);
		service.sendHostEvent('scripted', { set: 2 });
		assert.equal(await contained, true);
		const changed = await fact;
		assert.ok(
			changed.kind === 'fact' && changed.fact.sequence === 1,
			'the change is the next sequence'
		);

		const released = next(service.onDidChangeContainment, (value) => !value);
		service.sendHostEvent('scripted', { set: 1 });
		assert.equal(await released, false, 'released after the stability time');

		const gap = next<Notification>(
			service.onDidNotify,
			(notification) => notification.kind === 'gap'
		);
		service.sendHostEvent('scripted', { lose: 3 });
		const reported = await gap;
		assert.ok(
			reported.kind === 'gap' &&
				reported.gap.last_sequence - reported.gap.first_sequence === 2
		);

		const closed = await service.close('delete');
		assert.equal(closed?.facts.length, 1);
	} finally {
		service.dispose();
	}
});

void test('an interruption ends every stream, contains, and a fresh state recovers', async () => {
	const service = new NativeAgentService({ launch: LAUNCH });
	try {
		await service.openReadiness(COLLECTION, POLICY);
		await service.beginParticipation();
		await service.confirmParticipation();

		const interruption = next<Notification>(
			service.onDidNotify,
			(notification) => notification.kind === 'interruption'
		);
		const unknown = next<Notification>(
			service.onDidNotify,
			(notification) =>
				notification.kind === 'rules' &&
				notification.statuses.some(
					(status) => status.status === 'unknown' && status.unknown_cause === 'gap'
				)
		);
		const fresh = next<Notification>(
			service.onDidNotify,
			(notification) => notification.kind === 'fact'
		);
		const contained = next(service.onDidChangeContainment, (value) => value);
		service.sendHostEvent('scripted', { interrupt: 'screen_lock' });
		const reported = await interruption;
		assert.ok(reported.kind === 'interruption' && reported.interruption === 'screen_lock');
		await unknown;
		assert.equal(await contained, true, 'an unknown enforce rule contains');
		const refreshed = await fresh;
		assert.ok(
			refreshed.kind === 'fact' && refreshed.fact.sequence === 1,
			'the unchanged state is delivered again after the gap'
		);

		const released = next(service.onDidChangeContainment, (value) => !value);
		assert.equal(await released, false, 'the fresh state recovers after the stability time');
	} finally {
		service.dispose();
	}
});

type ClipReady = Extract<ClipOutcome, { kind: 'ready' }>;

/** Opens a clip file the way the uploader does: one ChaCha20-Poly1305 record per upload chunk. */
function openClip(clip: ClipReady): Buffer[] {
	const sealed = readFileSync(clip.path);
	const key = Buffer.from(clip.key, 'base64url');
	const chunks: Buffer[] = [];
	for (let offset = 0, index = 0; offset < sealed.length; index += 1) {
		const length = Math.min(clip.chunk_bytes + 16, sealed.length - offset);
		const record = sealed.subarray(offset, offset + length);
		offset += length;
		const nonce = Buffer.alloc(12);
		nonce.writeBigUInt64BE(BigInt(index), 4);
		const decipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
		decipher.setAAD(Buffer.from('proctor-screen-clip-v1'), {
			plaintextLength: record.length - 16
		});
		decipher.setAuthTag(record.subarray(record.length - 16));
		chunks.push(
			Buffer.concat([
				decipher.update(record.subarray(0, record.length - 16)),
				decipher.final()
			])
		);
	}
	return chunks;
}

void test('the recorder records from confirmation, cuts a requested clip, and deletes at submission', async () => {
	const directory = join(mkdtempSync(join(tmpdir(), 'prctr-recording-')), 'attempt');
	const recording: RecordingStart = {
		recording_id: 'recording-0001',
		key: randomBytes(32).toString('base64url'),
		directory
	};
	const service = new NativeAgentService({ launch: LAUNCH });
	try {
		await service.openReadiness(COLLECTION, POLICY);
		await service.beginParticipation();
		const recordingState = next<Notification>(
			service.onDidNotify,
			(notification) => notification.kind === 'recorder' && notification.state === 'recording'
		);
		await service.confirmParticipation(recording);
		await recordingState;

		const clip = next(
			service.onDidClip,
			(value) => value.clipRequestId === 'clip-request-0001',
			10_000
		);
		await service.recorderSave('clip-request-0001', {
			from_session_start: true,
			end_ms: Date.now() + 2_500
		});
		const delivered = await clip;
		assert.equal(delivered.outcome.kind, 'ready');
		if (delivered.outcome.kind !== 'ready') return;
		const ready = delivered.outcome;
		const chunks = openClip(ready);
		const mp4 = Buffer.concat(chunks);
		assert.equal(mp4.length, ready.size_bytes);
		assert.equal(mp4.subarray(4, 8).toString('latin1'), 'ftyp', 'an MP4 file');
		assert.deepEqual(
			chunks.map((chunk) => createHash('sha256').update(chunk).digest('hex')),
			ready.chunk_sha256
		);
		const digest = createHash('sha256');
		digest.update(
			`proctor-screen-clip-v1\nvideo/mp4\n${ready.size_bytes}\n${ready.chunk_bytes}\n`
		);
		for (const chunk of ready.chunk_sha256) digest.update(`${chunk}\n`);
		assert.equal(digest.digest('hex'), ready.content_digest, 'the server formula');
		assert.ok(ready.end_ms - ready.start_ms >= 2_000, 'it waited for the future part');

		await service.recorderRelease('clip-request-0001');
		await assert.rejects(
			service.recorderSave('clip-request-0002', { from_session_start: false, end_ms: 5 }),
			(error: unknown) => error instanceof Error && /invalid_range/.test(error.message)
		);

		await service.close('seal');
		assert.ok(existsSync(join(directory, 'index.seal')), 'kept for re-entry');
		assert.ok(!existsSync(ready.path), 'the released clip is gone');

		const resumed = new NativeAgentService({ launch: LAUNCH });
		try {
			await resumed.openReadiness(COLLECTION, POLICY);
			await resumed.beginParticipation();
			const restarted = next<Notification>(
				resumed.onDidNotify,
				(notification) =>
					notification.kind === 'recorder' &&
					notification.gaps.some((gap) => gap.reason === 'restart')
			);
			await resumed.confirmParticipation(recording);
			await restarted;
			await resumed.close('delete');
			assert.ok(!existsSync(directory), 'deleted at submission');
		} finally {
			resumed.dispose();
		}
	} finally {
		service.dispose();
		rmSync(directory, { recursive: true, force: true });
	}
});

void test('a crash during participation contains, restarts once with fresh instances, then fails', async () => {
	const service = new NativeAgentService({ launch: LAUNCH });
	try {
		const opened = await service.openReadiness(COLLECTION, POLICY);
		await service.beginParticipation();
		await service.confirmParticipation();

		const restarted = next(service.onDidRestart, () => true);
		service.sendHostEvent('scripted', { panic: true });
		const snapshot = await restarted;
		assert.equal(service.phase, 'participation');
		assert.notEqual(
			snapshot.facts[0]?.source_instance_id,
			opened.facts[0]?.source_instance_id,
			'a fresh instance'
		);

		const failed = next<NativeAgentFailure>(service.onDidFail, () => true);
		service.sendHostEvent('scripted', { panic: true });
		assert.equal(await failed, 'exited');
		assert.equal(service.phase, 'failed');
		assert.equal(service.contained, true, 'a second failure stays contained');
	} finally {
		service.dispose();
	}
});

void test('a hung agent is detected by the missing heartbeat', async () => {
	const connection = await NativeAgentConnection.launch(LAUNCH);
	try {
		await connection.request({
			kind: 'open_readiness',
			collection_session_id: COLLECTION,
			policy: POLICY
		});
		const failed = next<NativeAgentFailure>(connection.onDidFail, () => true, 8_000);
		connection.sendHostEvent('scripted', { hang: true });
		assert.equal(await failed, 'hung');
	} finally {
		connection.dispose();
	}
});

void test('an orderly close returns final states and the process exits', async () => {
	const connection = await NativeAgentConnection.launch(LAUNCH);
	const pid = connection.pid;
	await connection.request({
		kind: 'open_readiness',
		collection_session_id: COLLECTION,
		policy: POLICY
	});
	const response = await connection.close('delete');
	assert.equal(response?.kind, 'closed');
	connection.dispose();
	assert.ok(pid !== undefined);
	assert.throws(() => process.kill(pid, 0), 'the agent process has exited');
});
