/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import { ServerApiError } from '../../../../platform/serverApi/common/serverApi.js';
import type { ServerApiClient } from '../../../../platform/serverApi/node/serverApiClient.js';
import {
	RealtimeCommandError,
	type ServerRealtimeClient
} from '../../../../platform/serverApi/node/serverRealtimeClient.js';
import {
	canonicalBrowserDigest,
	readBrowserSchema,
	type BrowserSourceBinding,
	type BrowserSourceStatus,
	type BrowserStartTransition,
	type BrowserWireRecord
} from './browserServerContract.js';

/** Main-process only. The Attempt owner withdraws access synchronously before async reconciliation. */
export interface BrowserCurrentAccess {
	readonly participationId: string;
	readonly generation: number;
	readonly connectionId: string;
	readonly continuityCredential: string;
}
export class BrowserSourceStartRefused extends Error {
	constructor(readonly predecessor: BrowserSourceStatus) {
		super('Browser successor was refused after predecessor closure');
	}
}
export interface BrowserSourceTransport {
	budget(binding: BrowserSourceBinding): Promise<components['schemas']['DeliveryBudgetSnapshot']>;
	stopDetails(
		binding: BrowserSourceBinding,
		idempotencyKey: string
	): Promise<components['schemas']['StopDeliveryDetailsResult']>;
	start(
		binding: BrowserSourceBinding,
		transition: BrowserStartTransition
	): Promise<BrowserSourceStatus>;
	status(binding: BrowserSourceBinding): Promise<BrowserSourceStatus>;
	append(
		binding: BrowserSourceBinding,
		records: readonly BrowserWireRecord[]
	): Promise<components['schemas']['BrowserActivityAcknowledgement']>;
	receipts(
		binding: BrowserSourceBinding,
		first: number
	): Promise<components['schemas']['BrowserReceiptPage']>;
	gaps(
		binding: BrowserSourceBinding,
		declaration: components['schemas']['DeclareDeliveryGaps']
	): Promise<components['schemas']['BrowserDeliveryGapResult']>;
	seal(
		binding: BrowserSourceBinding,
		declaration: components['schemas']['FinalDeliveryDeclaration']
	): Promise<BrowserSourceStatus>;
	summary(
		binding: BrowserSourceBinding,
		declaration: components['schemas']['UnretainedDeliverySummary'],
		idempotencyKey: string
	): Promise<components['schemas']['BrowserDeliverySummaryResult']>;
}

export class ServerBrowserSourceTransport implements BrowserSourceTransport {
	constructor(
		private readonly api: Pick<ServerApiClient, 'request'>,
		private readonly realtime: Pick<ServerRealtimeClient, 'request'>,
		private readonly currentAccess: () => BrowserCurrentAccess | undefined
	) {}
	async budget(binding: BrowserSourceBinding) {
		const result = await this.api.request('deliveryBudget', {
			path: { exam_attempt_id: binding.attemptId },
			header: this.headers(binding),
			query: { participation_id: binding.participationId }
		});
		if (result.status !== 200) throw new ServerApiError('server', result.status);
		if (
			result.value.participation_id !== binding.participationId ||
			result.value.generation !== binding.participationGeneration
		)
			throw new ServerApiError('invalidResponse');
		return result.value;
	}
	async stopDetails(binding: BrowserSourceBinding, idempotencyKey: string) {
		const access = this.access(binding, true)!;
		const result = await this.api.request('stopDeliveryDetails', {
			path: { exam_attempt_id: binding.attemptId },
			header: {
				'X-Proctor-Attempt-Credential': access.continuityCredential,
				'X-Proctor-Attempt-Connection-ID': access.connectionId,
				'Idempotency-Key': idempotencyKey
			},
			body: { family: 'browser', reason: 'local_loss_inventory_exhausted' }
		});
		if (result.status !== 200) throw new ServerApiError('server', result.status);
		if (
			result.value.budget.participation_id !== binding.participationId ||
			result.value.budget.generation !== binding.participationGeneration
		)
			throw new ServerApiError('invalidResponse');
		return result.value;
	}
	private access(
		binding: BrowserSourceBinding,
		required = false
	): BrowserCurrentAccess | undefined {
		const current = this.currentAccess();
		if (
			current &&
			current.participationId === binding.participationId &&
			current.generation === binding.participationGeneration
		)
			return current;
		if (required) throw new ServerApiError('sessionEnded');
		return undefined;
	}
	private headers(binding: BrowserSourceBinding) {
		const access = this.access(binding);
		return access
			? {
					'X-Proctor-Attempt-Credential': access.continuityCredential,
					'X-Proctor-Attempt-Connection-ID': access.connectionId
				}
			: {};
	}
	private path(binding: BrowserSourceBinding) {
		return { exam_attempt_id: binding.attemptId, source_session_id: binding.sourceInstanceId };
	}
	async start(
		binding: BrowserSourceBinding,
		transition: BrowserStartTransition
	): Promise<BrowserSourceStatus> {
		const access = this.access(binding, true)!;
		try {
			const reply = await this.realtime.request('exam_attempt.browser_activity.start', {
				...batchIdentity(binding),
				continuity_credential: access.continuityCredential,
				transition
			});
			const status = readBrowserSchema('BrowserSourceStatus', reply.data);
			assertBrowserSourceStatus(binding, status);
			return status;
		} catch (error) {
			if (
				error instanceof RealtimeCommandError &&
				error.reply?.error?.browser_source_status !== undefined
			) {
				const predecessor = readBrowserSchema(
					'BrowserSourceStatus',
					error.reply.error.browser_source_status
				);
				if (
					transition.kind === 'initial' ||
					predecessor.source_session_id !== transition.predecessor_source_session_id ||
					predecessor.attempt_id !== binding.attemptId ||
					predecessor.participation_id !== binding.participationId ||
					predecessor.generation !== binding.participationGeneration ||
					!predecessor.closure.closed_at
				)
					throw new ServerApiError('invalidResponse');
				throw new BrowserSourceStartRefused(predecessor);
			}
			throw error;
		}
	}
	async status(binding: BrowserSourceBinding): Promise<BrowserSourceStatus> {
		const result = await this.api.request('browserSourceStatus', {
			path: this.path(binding),
			header: this.headers(binding)
		});
		if (result.status !== 200) throw new ServerApiError('server', result.status);
		assertBrowserSourceStatus(binding, result.value);
		return result.value;
	}
	async append(binding: BrowserSourceBinding, events: readonly BrowserWireRecord[]) {
		const body = { ...batchIdentity(binding), events };
		readBrowserSchema('BrowserActivityBatch', body);
		const access = this.access(binding);
		if (access) {
			const reply = await this.realtime.request('exam_attempt.browser_activity.append', {
				...body,
				continuity_credential: access.continuityCredential
			});
			const result = readBrowserSchema('BrowserActivityAcknowledgement', reply.data);
			if (result.source_session_id !== binding.sourceInstanceId)
				throw new ServerApiError('invalidResponse');
			return result;
		}
		const result = await this.api.request('appendHistoricalBrowserDelivery', {
			path: this.path(binding),
			header: { 'Idempotency-Key': canonicalBrowserDigest(body) },
			body
		});
		if (result.status !== 200) throw new ServerApiError('server', result.status);
		if (result.value.source_session_id !== binding.sourceInstanceId)
			throw new ServerApiError('invalidResponse');
		return result.value;
	}
	async receipts(binding: BrowserSourceBinding, first: number) {
		const result = await this.api.request('browserDeliveryReceipts', {
			path: this.path(binding),
			header: this.headers(binding),
			query: { first_sequence: first, limit: 256 }
		});
		if (result.status !== 200) throw new ServerApiError('server', result.status);
		return result.value;
	}
	async gaps(binding: BrowserSourceBinding, body: components['schemas']['DeclareDeliveryGaps']) {
		const result = await this.api.request('declareBrowserDeliveryGaps', {
			path: this.path(binding),
			header: { ...this.headers(binding), 'Idempotency-Key': body.declaration_id },
			body
		});
		if (result.status !== 200) throw new ServerApiError('server', result.status);
		assertBrowserSourceStatus(binding, result.value.status);
		return result.value;
	}
	async seal(
		binding: BrowserSourceBinding,
		body: components['schemas']['FinalDeliveryDeclaration']
	) {
		const result = await this.api.request('sealBrowserDelivery', {
			path: this.path(binding),
			header: { ...this.headers(binding), 'Idempotency-Key': body.declaration_id },
			body
		});
		if (result.status !== 200) throw new ServerApiError('server', result.status);
		assertBrowserSourceStatus(binding, result.value);
		return result.value;
	}
	async summary(
		binding: BrowserSourceBinding,
		body: components['schemas']['UnretainedDeliverySummary'],
		idempotencyKey: string
	) {
		const result = await this.api.request('updateBrowserDeliverySummary', {
			path: this.path(binding),
			header: { ...this.headers(binding), 'Idempotency-Key': idempotencyKey },
			body
		});
		if (result.status !== 200) throw new ServerApiError('server', result.status);
		assertBrowserSourceStatus(binding, result.value.status);
		return result.value;
	}
}
export function assertBrowserSourceStatus(
	binding: BrowserSourceBinding,
	status: BrowserSourceStatus
): void {
	if (
		status.attempt_id !== binding.attemptId ||
		status.participation_id !== binding.participationId ||
		status.generation !== binding.participationGeneration ||
		status.source_session_id !== binding.sourceInstanceId ||
		status.policy_revision_id !== binding.policyRevision ||
		status.policy_digest !== binding.policyDigest
	)
		throw new ServerApiError('invalidResponse');
}
function batchIdentity(binding: BrowserSourceBinding) {
	return {
		source_session_id: binding.sourceInstanceId,
		participation_id: binding.participationId,
		generation: binding.participationGeneration,
		policy_revision_id: binding.policyRevision,
		policy_digest: binding.policyDigest
	};
}
