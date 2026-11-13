/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ProtectedRecordStore } from '../../../../platform/protectedStorage/node/protectedRecordStore.js';
import {
	canonicalContractBytes,
	canonicalContractDigest,
	parseStrictContractJson
} from '../../../../platform/serverApi/node/canonicalContract.js';
import { ServerApiError } from '../../../../platform/serverApi/common/serverApi.js';
import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import type { NativeRecord } from '../common/nativeRecords.js';
import type {
	NativeDeliveryAccess,
	NativeDeliveryTransport,
	NativeSecurityBatch
} from './nativeDeliveryTransport.js';

/** One Participation's native stream, as the server admitted it. */
export interface NativeStreamBinding {
	readonly attemptId: string;
	readonly streamId: string;
	readonly participationId: string;
	readonly generation: number;
	readonly securitySessionId: string;
	readonly policyDigest: string;
	readonly applicationReleaseId: string;
	readonly matrixId: string;
}

/** One delivery source's position, as `security_control.delivery_watermarks` carries it. */
export interface DeliveryWatermark {
	readonly family: 'native' | 'browser';
	readonly source_id: string;
	readonly allocated_through_sequence: number;
	readonly acknowledged_through_sequence: number;
}

interface StoredBatch {
	readonly body: NativeSecurityBatch;
	readonly digest: string;
}

interface Snapshot {
	readonly binding: NativeStreamBinding;
	/** The highest batch sequence allocated. */
	readonly allocated: number;
	/** The server's highest contiguous acknowledged batch sequence. */
	readonly acknowledged: number;
	readonly batches: readonly StoredBatch[];
	readonly pending: readonly NativeRecord[];
	readonly declaredLost: readonly number[];
}

/** The most records and bytes one batch carries (the server allows 64 and 256 KiB). */
export const BATCH_RECORDS = 64;
export const BATCH_BYTES = 240 * 1024;
/** The most bytes the protected spool holds for one stream before refusing new records. */
export const SPOOL_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_BYTES = SPOOL_BYTES + 512 * 1024;
const DECLARED_LOST = 4_096;

export class NativeSpoolCapacityError extends Error {
	public constructor() {
		super('the protected native spool is full');
		this.name = 'NativeSpoolCapacityError';
	}
}

function key(streamId: string): string {
	return `native_${streamId}`;
}

function bytes(value: unknown): number {
	return canonicalContractBytes(value, SNAPSHOT_BYTES).byteLength;
}

/**
 * Delivers one Participation's native records. Records are spooled in an encrypted protected
 * store before anything is sent, cut into batches in order, and each batch is retried with its
 * original bytes (including its original prior acknowledgement) until the server's receipt names
 * its exact digest. A batch the server reports missing that is no longer held is declared lost,
 * never invented.
 */
export class NativeDeliveryService {
	private serial: Promise<unknown> = Promise.resolve();
	private disposed = false;

	private constructor(
		private readonly store: ProtectedRecordStore,
		private readonly transport: NativeDeliveryTransport,
		private snapshot: Snapshot
	) {}

	/** Opens the stream's spool, restoring what a previous run left behind. */
	public static async open(
		store: ProtectedRecordStore,
		transport: NativeDeliveryTransport,
		binding: NativeStreamBinding
	): Promise<NativeDeliveryService> {
		const stored = await store.read(key(binding.streamId));
		let snapshot: Snapshot = {
			binding,
			allocated: 0,
			acknowledged: 0,
			batches: [],
			pending: [],
			declaredLost: []
		};
		if (stored !== undefined) {
			const restored = parseStrictContractJson(stored, {
				maxBytes: SNAPSHOT_BYTES
			}) as Snapshot;
			if (canonicalContractDigest(restored.binding) !== canonicalContractDigest(binding))
				throw new TypeError('the protected native spool belongs to another stream');
			snapshot = restored;
		}
		return new NativeDeliveryService(store, transport, snapshot);
	}

	public get binding(): NativeStreamBinding {
		return this.snapshot.binding;
	}

	/** What `security_control` reports for this stream. */
	public watermark(): DeliveryWatermark {
		return {
			family: 'native',
			source_id: this.snapshot.binding.streamId,
			allocated_through_sequence: this.snapshot.allocated,
			acknowledged_through_sequence: this.snapshot.acknowledged
		};
	}

	/** Records waiting to be acknowledged, batched or not. */
	public get backlog(): number {
		return (
			this.snapshot.pending.length +
			this.snapshot.batches.reduce((total, batch) => total + batch.body.records.length, 0)
		);
	}

	/** Spools records in order. Refuses when the spool is full: the caller must contain. */
	public enqueue(records: readonly NativeRecord[]): Promise<void> {
		if (records.length === 0) return Promise.resolve();
		return this.exclusive(async () => {
			const next = { ...this.snapshot, pending: [...this.snapshot.pending, ...records] };
			if (bytes(next.pending) + bytes(next.batches) > SPOOL_BYTES)
				throw new NativeSpoolCapacityError();
			await this.persist(next);
		});
	}

	/**
	 * Cuts pending records into batches and sends every unacknowledged batch in order. Returns
	 * how many batches the server acknowledged in this call.
	 */
	public deliver(access: NativeDeliveryAccess | undefined): Promise<number> {
		return this.exclusive(async () => {
			await this.cut();
			let acknowledged = 0;
			for (const batch of [...this.snapshot.batches]) {
				if (batch.body.batch_sequence <= this.snapshot.acknowledged) continue;
				const answer = await this.transport.append(
					this.snapshot.binding.attemptId,
					batch.body,
					batch.digest,
					access
				);
				if (answer.receipt.request_digest !== batch.digest)
					throw new ServerApiError('invalidResponse');
				acknowledged++;
				await this.settle(answer.highest_contiguous_batch_sequence);
				await this.declareLost(answer.missing_batch_ranges, access);
			}
			return acknowledged;
		});
	}

	/** After server-owned closure: declare the final batch sequence. */
	public seal(access: NativeDeliveryAccess | undefined): Promise<void> {
		return this.exclusive(async () => {
			const status = await this.transport.status(
				this.snapshot.binding.attemptId,
				this.snapshot.binding.streamId,
				access
			);
			await this.transport.seal(
				this.snapshot.binding.attemptId,
				this.snapshot.binding.streamId,
				{
					declaration_id: `seal-${this.snapshot.binding.streamId}-${this.snapshot.allocated}`,
					expected_revision: status.declaration_revision,
					final_sequence: this.snapshot.allocated
				},
				access
			);
		});
	}

	/** Deletes the spool once everything is acknowledged or the upload deadline has passed. */
	public async discard(): Promise<void> {
		await this.exclusive(() => this.store.delete(key(this.snapshot.binding.streamId)));
		this.disposed = true;
	}

	private async cut(): Promise<void> {
		if (this.snapshot.pending.length === 0) return;
		const batches = [...this.snapshot.batches];
		let allocated = this.snapshot.allocated;
		let records: NativeRecord[] = [];
		const close = () => {
			if (records.length === 0) return;
			allocated++;
			const body: NativeSecurityBatch = {
				stream_id: this.snapshot.binding.streamId,
				batch_sequence: allocated,
				prior_acknowledgement: this.snapshot.acknowledged,
				participation_id: this.snapshot.binding.participationId,
				generation: this.snapshot.binding.generation,
				security_session_id: this.snapshot.binding.securitySessionId,
				policy_digest: this.snapshot.binding.policyDigest,
				application_release_id: this.snapshot.binding.applicationReleaseId,
				matrix_id: this.snapshot.binding.matrixId,
				records
			};
			batches.push({ body, digest: canonicalContractDigest(body) });
			records = [];
		};
		for (const record of this.snapshot.pending) {
			if (records.length > 0 && bytes([...records, record]) > BATCH_BYTES) close();
			records.push(record);
			if (records.length === BATCH_RECORDS) close();
		}
		close();
		await this.persist({ ...this.snapshot, allocated, batches, pending: [] });
	}

	private async settle(contiguous: number): Promise<void> {
		if (contiguous <= this.snapshot.acknowledged) return;
		const acknowledged = Math.min(contiguous, this.snapshot.allocated);
		await this.persist({
			...this.snapshot,
			acknowledged,
			batches: this.snapshot.batches.filter(
				(batch) => batch.body.batch_sequence > acknowledged
			)
		});
	}

	private async declareLost(
		ranges: readonly components['schemas']['SequenceRange'][],
		access: NativeDeliveryAccess | undefined
	): Promise<void> {
		const held = new Set(this.snapshot.batches.map((batch) => batch.body.batch_sequence));
		const declared = new Set(this.snapshot.declaredLost);
		const lost: number[] = [];
		for (const range of ranges)
			for (
				let sequence = range.first;
				sequence <= range.last && lost.length < DECLARED_LOST;
				sequence++
			)
				if (
					sequence > this.snapshot.acknowledged &&
					sequence <= this.snapshot.allocated &&
					!held.has(sequence) &&
					!declared.has(sequence)
				)
					lost.push(sequence);
		if (lost.length === 0) return;
		const merged = mergeRanges(lost).slice(0, 32);
		const status = await this.transport.status(
			this.snapshot.binding.attemptId,
			this.snapshot.binding.streamId,
			access
		);
		await this.transport.declareGaps(
			this.snapshot.binding.attemptId,
			this.snapshot.binding.streamId,
			{
				declaration_id: `gaps-${this.snapshot.binding.streamId}-${merged[0]?.first ?? 0}-${lost.length}`,
				expected_revision: status.declaration_revision,
				allocated_through_sequence: this.snapshot.allocated,
				ranges: merged,
				reason: 'spool_lost'
			},
			access
		);
		await this.persist({
			...this.snapshot,
			declaredLost: [...this.snapshot.declaredLost, ...lost].slice(-DECLARED_LOST)
		});
	}

	private async persist(next: Snapshot): Promise<void> {
		await this.store.write(
			key(next.binding.streamId),
			canonicalContractBytes(next, SNAPSHOT_BYTES)
		);
		this.snapshot = next;
	}

	private exclusive<T>(work: () => Promise<T>): Promise<T> {
		if (this.disposed) return Promise.reject(new Error('the native delivery stream is closed'));
		const run = this.serial.then(work, work);
		this.serial = run.catch(() => undefined);
		return run;
	}
}

function mergeRanges(sequences: readonly number[]): components['schemas']['SequenceRange'][] {
	const sorted = [...new Set(sequences)].sort((a, b) => a - b);
	const ranges: components['schemas']['SequenceRange'][] = [];
	for (const sequence of sorted) {
		const last = ranges.at(-1);
		if (last && last.last + 1 === sequence)
			ranges[ranges.length - 1] = { ...last, last: sequence };
		else ranges.push({ first: sequence, last: sequence });
	}
	return ranges;
}
