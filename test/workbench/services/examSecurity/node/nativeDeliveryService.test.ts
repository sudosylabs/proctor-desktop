/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProtectedRecordStore } from '../../../../../src/prctr/platform/protectedStorage/node/protectedRecordStore.ts';
import type { NativeRecord } from '../../../../../src/prctr/workbench/services/examSecurity/common/nativeRecords.ts';
import {
	BATCH_RECORDS,
	NativeDeliveryService,
	type NativeStreamBinding
} from '../../../../../src/prctr/workbench/services/examSecurity/node/nativeDeliveryService.ts';
import type {
	DeclareDeliveryGaps,
	FinalDeliveryDeclaration,
	NativeDeliveryAccess,
	NativeDeliveryTransport,
	NativeSecurityAcknowledgement,
	NativeSecurityBatch,
	NativeSecurityStreamStatus
} from '../../../../../src/prctr/workbench/services/examSecurity/node/nativeDeliveryTransport.ts';
import { canonicalContractDigest } from '../../../../../src/prctr/platform/serverApi/node/canonicalContract.ts';

class Store implements ProtectedRecordStore {
	public readonly records = new Map<string, Uint8Array>();
	public async read(key: string) {
		return this.records.get(key);
	}
	public async write(key: string, bytes: Uint8Array) {
		this.records.set(key, bytes);
	}
	public async delete(key: string) {
		this.records.delete(key);
	}
	public async list(prefix = '') {
		return [...this.records.keys()].filter((key) => key.startsWith(prefix));
	}
	public dispose() {}
}

class Server implements NativeDeliveryTransport {
	public readonly received: NativeSecurityBatch[] = [];
	public readonly accessSeen: (NativeDeliveryAccess | undefined)[] = [];
	public readonly gaps: DeclareDeliveryGaps[] = [];
	public readonly seals: FinalDeliveryDeclaration[] = [];
	public failNext = false;
	public missing: { first: number; last: number }[] = [];
	private contiguous = 0;

	public async append(
		_attemptId: string,
		batch: NativeSecurityBatch,
		idempotencyKey: string,
		access: NativeDeliveryAccess | undefined
	): Promise<NativeSecurityAcknowledgement> {
		if (this.failNext) {
			this.failNext = false;
			throw new Error('network');
		}
		assert.equal(idempotencyKey, canonicalContractDigest(batch));
		this.received.push(batch);
		this.accessSeen.push(access);
		if (batch.batch_sequence === this.contiguous + 1) this.contiguous = batch.batch_sequence;
		return {
			receipt: {
				stream_id: batch.stream_id,
				batch_sequence: batch.batch_sequence,
				request_digest: canonicalContractDigest(batch),
				received_at: new Date(0).toISOString()
			},
			highest_contiguous_batch_sequence: this.contiguous,
			settled_through_batch_sequence: this.contiguous,
			highest_seen_batch_sequence: batch.batch_sequence,
			missing_batch_ranges: this.missing,
			missing_ranges_truncated: false,
			server_time: new Date(0).toISOString()
		};
	}

	public async status(_attemptId: string, streamId: string): Promise<NativeSecurityStreamStatus> {
		return { stream_id: streamId, declaration_revision: 7 } as NativeSecurityStreamStatus;
	}

	public async declareGaps(_attemptId: string, _streamId: string, body: DeclareDeliveryGaps) {
		this.gaps.push(body);
	}

	public async seal(_attemptId: string, _streamId: string, body: FinalDeliveryDeclaration) {
		this.seals.push(body);
	}
}

const binding: NativeStreamBinding = {
	attemptId: 'ybndrfg8ejkmcpqxot1uwisza3',
	streamId: 'stream-1',
	participationId: 'ybndrfg8ejkmcpqxot1uwisza4',
	generation: 1,
	securitySessionId: 'session-1',
	policyDigest: 'sha256:' + 'ab'.repeat(32),
	applicationReleaseId: 'dev-1',
	matrixId: 'matrix-1'
};
const access: NativeDeliveryAccess = { continuityCredential: 'c'.repeat(43), connectionId: 'conn' };

function confirmed(index: number): NativeRecord {
	return { kind: 'participation_confirmed', observed_at: new Date(index).toISOString() };
}

void test('records are batched in order, sent with live access, and acknowledged ones leave the spool', async () => {
	const store = new Store();
	const server = new Server();
	const service = await NativeDeliveryService.open(store, server, binding);
	await service.enqueue(
		Array.from({ length: BATCH_RECORDS + 3 }, (_, index) => confirmed(index))
	);
	assert.equal(await service.deliver(access), 2);
	assert.deepEqual(
		server.received.map((batch) => [
			batch.batch_sequence,
			batch.records.length,
			batch.prior_acknowledgement
		]),
		[
			[1, BATCH_RECORDS, 0],
			[2, 3, 0]
		]
	);
	assert.deepEqual(server.accessSeen, [access, access]);
	assert.equal(service.backlog, 0);
	assert.deepEqual(service.watermark(), {
		family: 'native',
		source_id: 'stream-1',
		allocated_through_sequence: 2,
		acknowledged_through_sequence: 2
	});
});

void test('a failed send keeps the batch and a restart resends the same bytes', async () => {
	const store = new Store();
	const server = new Server();
	const first = await NativeDeliveryService.open(store, server, binding);
	await first.enqueue([confirmed(1)]);
	server.failNext = true;
	await assert.rejects(first.deliver(access));
	const reopened = await NativeDeliveryService.open(store, server, binding);
	assert.equal(reopened.backlog, 1);
	assert.equal(await reopened.deliver(undefined), 1);
	assert.equal(server.received[0]?.batch_sequence, 1);
	assert.deepEqual(server.accessSeen, [undefined], 'after closure no live headers are sent');
});

void test('a missing range that covers only acknowledged batches declares nothing lost', async () => {
	const store = new Store();
	const server = new Server();
	const service = await NativeDeliveryService.open(store, server, binding);
	await service.enqueue([confirmed(1)]);
	await service.deliver(access);
	await service.enqueue([confirmed(2)]);
	server.missing = [{ first: 1, last: 1 }];
	await service.deliver(access);
	assert.equal(server.gaps.length, 0, 'acknowledged batches are never declared lost');
});

void test('sealing declares the final allocated batch at the stream revision', async () => {
	const server = new Server();
	const service = await NativeDeliveryService.open(new Store(), server, binding);
	await service.enqueue([confirmed(1)]);
	await service.deliver(access);
	await service.seal(undefined);
	assert.deepEqual(
		server.seals.map((seal) => [seal.final_sequence, seal.expected_revision]),
		[[1, 7]]
	);
});

void test('a spool from another stream is refused', async () => {
	const store = new Store();
	const service = await NativeDeliveryService.open(store, new Server(), binding);
	await service.enqueue([confirmed(1)]);
	const [key] = await store.list('native_');
	const bytes = store.records.get(key ?? '');
	await assert.rejects(
		NativeDeliveryService.open(
			{
				...store,
				read: async () => bytes,
				write: store.write.bind(store),
				delete: store.delete.bind(store),
				list: store.list.bind(store),
				dispose() {}
			},
			new Server(),
			{ ...binding, generation: 2 }
		)
	);
});
