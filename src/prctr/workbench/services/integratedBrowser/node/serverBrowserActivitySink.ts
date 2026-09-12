/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import {
	validateBrowserActivityRecord,
	type BrowserActivityKind,
	type BrowserActivityRecord,
	type BrowserActivitySeal
} from '../../../../platform/integratedBrowser/common/browserActivity.js';
import type { BrowserPolicy } from '../../../../platform/integratedBrowser/common/browserPolicy.js';
import type {
	BrowserActivitySink,
	BrowserActivitySinkFactory
} from '../common/integratedBrowserCoordinator.js';
import {
	browserRecordToWire,
	canonicalBrowserBytes,
	type BrowserSourceBinding,
	type BrowserStartTransition
} from './browserServerContract.js';
import type { BrowserDeliveryService } from './browserDeliveryService.js';

export interface BrowserActivitySinkOwner {
	readonly participationId: string;
	/** Synchronous containment on a failed protected append; never log captured records. */
	unavailable(): void;
	/** Notify the Attempt's shared delivery scheduler after durable capture. */
	pending(source: string): void;
	now(): number;
}

/** View lifetimes may end without terminating server source authority or its historical tail. */
export class ServerBrowserActivitySinkFactory implements BrowserActivitySinkFactory {
	private current: BrowserSourceBinding | undefined;
	private pendingStart: BrowserStartTransition | undefined;
	constructor(
		private readonly delivery: BrowserDeliveryService,
		private readonly owner: BrowserActivitySinkOwner
	) {}
	async reset(
		policy: BrowserPolicy,
		reason: 'coordinator_restarted' | 'spool_unavailable' | 'source_corrupt'
	): Promise<BrowserActivitySink> {
		if (this.current && this.pendingStart?.kind === 'runtime_reset') {
			if (
				this.current.policyRevision !== policy.revision ||
				this.current.policyDigest !== policy.digest
			)
				throw new Error('Browser reset retry changed policy');
			await this.delivery.start(this.current, this.pendingStart);
			this.pendingStart = undefined;
			return new ServerBrowserActivitySink(this.current, this.delivery, this.owner);
		}
		const prior = this.current;
		if (
			!prior ||
			prior.policyRevision !== policy.revision ||
			prior.policyDigest !== policy.digest
		)
			throw new Error('Browser reset requires its current source');
		const next = { ...prior, sourceInstanceId: randomUUID() };
		this.current = next;
		this.pendingStart = {
			kind: 'runtime_reset',
			predecessor_source_session_id: prior.sourceInstanceId,
			reason
		};
		await this.delivery.start(next, this.pendingStart);
		this.pendingStart = undefined;
		return new ServerBrowserActivitySink(next, this.delivery, this.owner);
	}
	async create(policy: BrowserPolicy): Promise<BrowserActivitySink> {
		if (!this.current) {
			this.current = this.delivery.currentSource(
				this.owner.participationId,
				policy.participationGeneration
			);
			if (this.current && !this.delivery.status(this.current.sourceInstanceId))
				await this.delivery.retryStart(this.current.sourceInstanceId);
		}
		let binding = this.current;
		if (!binding || binding.policyRevision !== policy.revision) {
			const prior = binding;
			binding = {
				attemptId: policy.attemptId,
				participationId: this.owner.participationId,
				participationGeneration: policy.participationGeneration,
				policyRevision: policy.revision,
				policyDigest: policy.digest,
				sourceInstanceId: randomUUID()
			};
			// Retain the declaration even if the response is lost. A retry uses this UUID.
			this.current = binding;
			this.pendingStart = prior
				? {
						kind: 'policy_correction',
						predecessor_source_session_id: prior.sourceInstanceId
					}
				: { kind: 'initial' };
			await this.delivery.start(binding, this.pendingStart);
			this.pendingStart = undefined;
		} else {
			if (
				binding.attemptId !== policy.attemptId ||
				binding.participationGeneration !== policy.participationGeneration ||
				binding.policyDigest !== policy.digest
			)
				throw new TypeError('Browser source factory scope changed');
			if (this.pendingStart) {
				await this.delivery.start(binding, this.pendingStart);
				this.pendingStart = undefined;
			}
			const existing = this.delivery.status(binding.sourceInstanceId);
			if (!existing) throw new Error('Browser source start requires reconciliation');
			if (existing.closure.closed_at) throw new Error('Browser source authority is closed');
		}
		return new ServerBrowserActivitySink(binding, this.delivery, this.owner);
	}
}

class ServerBrowserActivitySink implements BrowserActivitySink {
	readonly scope: BrowserSourceBinding;
	private sequence: number;
	private pending: Promise<void> = Promise.resolve();
	private failure: unknown;
	private sealed = false;
	private queuedRecords = 0;
	private queuedBytes = 0;
	constructor(
		binding: BrowserSourceBinding,
		private readonly delivery: BrowserDeliveryService,
		private readonly owner: BrowserActivitySinkOwner
	) {
		this.scope = Object.freeze({ ...binding });
		this.sequence = delivery.allocated(binding.sourceInstanceId);
	}
	append(
		kind: BrowserActivityKind,
		details: Parameters<BrowserActivitySink['append']>[1] = {}
	): BrowserActivityRecord {
		if (this.sealed || this.failure) throw new Error('Browser capture sink is unavailable');
		const record = validateBrowserActivityRecord({
			sourceInstanceId: this.scope.sourceInstanceId,
			sequence: this.sequence + 1,
			participationGeneration: this.scope.participationGeneration,
			kind,
			clientOccurredAtMs: this.owner.now(),
			...details
		});
		const wire = browserRecordToWire(record, this.scope);
		const size = canonicalBrowserBytes(wire).byteLength;
		if (this.queuedRecords >= 256 || this.queuedBytes + size > 1024 * 1024) {
			this.failure = new Error('Browser capture queue requires containment');
			this.owner.unavailable();
			throw this.failure;
		}
		this.queuedRecords++;
		this.queuedBytes += size;
		this.sequence = record.sequence;
		const { sequence: expected, policy_revision_id: _policy, ...event } = wire;
		// Submit synchronously to the privileged allocation queue so capture permission is
		// evaluated before a subsequent pause, while disk writes remain serialized.
		const capture = this.delivery
			.append(this.scope.sourceInstanceId, event)
			.then((stored) => {
				if (stored && stored.sequence !== expected)
					throw new Error('Browser capture allocation changed');
				this.owner.pending(this.scope.sourceInstanceId);
			})
			.catch((error) => {
				this.failure = error;
				this.owner.unavailable();
			})
			.finally(() => {
				this.queuedRecords--;
				this.queuedBytes -= size;
			});
		this.pending = Promise.all([this.pending, capture]).then(() => {});
		return record;
	}
	seal(): BrowserActivitySeal {
		this.sealed = true;
		return Object.freeze({
			sourceInstanceId: this.scope.sourceInstanceId,
			participationGeneration: this.scope.participationGeneration,
			highestAcknowledged:
				this.delivery.status(this.scope.sourceInstanceId)?.highest_contiguous_sequence ?? 0,
			finalSequence: this.sequence,
			gaps: Object.freeze([]),
			sealed: true
		});
	}
	async flush(): Promise<void> {
		await this.pending;
		if (this.failure) throw this.failure;
	}
	dispose(): void {
		this.sealed = true;
	}
}
