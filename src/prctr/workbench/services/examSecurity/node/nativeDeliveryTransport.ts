/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import { ServerApiError } from '../../../../platform/serverApi/common/serverApi.js';
import type { SessionApi } from '../../../../platform/serverApi/node/sessionApi.js';

export type NativeSecurityBatch = components['schemas']['NativeSecurityBatch'];
export type NativeSecurityAcknowledgement = components['schemas']['NativeSecurityAcknowledgement'];
export type DeclareDeliveryGaps = components['schemas']['DeclareDeliveryGaps'];
export type FinalDeliveryDeclaration = components['schemas']['FinalDeliveryDeclaration'];
export type NativeSecurityStreamStatus = components['schemas']['NativeSecurityStreamStatus'];

/** The live Participation's credentials; absent once the server has closed the stream. */
export interface NativeDeliveryAccess {
	readonly continuityCredential: string;
	readonly connectionId: string;
}

/** Where native batches go. The stream lives under one Attempt. */
export interface NativeDeliveryTransport {
	append(
		attemptId: string,
		batch: NativeSecurityBatch,
		idempotencyKey: string,
		access: NativeDeliveryAccess | undefined
	): Promise<NativeSecurityAcknowledgement>;
	status(
		attemptId: string,
		streamId: string,
		access: NativeDeliveryAccess | undefined
	): Promise<NativeSecurityStreamStatus>;
	declareGaps(
		attemptId: string,
		streamId: string,
		body: DeclareDeliveryGaps,
		access: NativeDeliveryAccess | undefined
	): Promise<void>;
	seal(
		attemptId: string,
		streamId: string,
		body: FinalDeliveryDeclaration,
		access: NativeDeliveryAccess | undefined
	): Promise<void>;
}

function headers(access: NativeDeliveryAccess | undefined) {
	return access === undefined
		? {}
		: {
				'X-Proctor-Attempt-Credential': access.continuityCredential,
				'X-Proctor-Attempt-Connection-ID': access.connectionId
			};
}

/**
 * The server's native delivery routes. While the Participation is live every call carries its
 * continuity credential and connection; after server-owned closure none does, and the server
 * authenticates the history upload by the registered Desktop alone.
 */
export class ServerNativeDeliveryTransport implements NativeDeliveryTransport {
	public constructor(private readonly api: Pick<SessionApi, 'request'>) {}

	public async append(
		attemptId: string,
		batch: NativeSecurityBatch,
		idempotencyKey: string,
		access: NativeDeliveryAccess | undefined
	): Promise<NativeSecurityAcknowledgement> {
		const result = await this.api.request('appendNativeDelivery', {
			path: { exam_attempt_id: attemptId },
			header: { ...headers(access), 'Idempotency-Key': idempotencyKey },
			body: batch
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
		const acknowledgement = result.value;
		if (
			acknowledgement.receipt.stream_id !== batch.stream_id ||
			acknowledgement.receipt.batch_sequence !== batch.batch_sequence
		)
			throw new ServerApiError('invalidResponse');
		return acknowledgement;
	}

	public async status(
		attemptId: string,
		streamId: string,
		access: NativeDeliveryAccess | undefined
	): Promise<NativeSecurityStreamStatus> {
		const result = await this.api.request('nativeDeliveryStatus', {
			path: { exam_attempt_id: attemptId, stream_id: streamId },
			header: headers(access)
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
		if (result.value.stream_id !== streamId) throw new ServerApiError('invalidResponse');
		return result.value;
	}

	public async declareGaps(
		attemptId: string,
		streamId: string,
		body: DeclareDeliveryGaps,
		access: NativeDeliveryAccess | undefined
	): Promise<void> {
		const result = await this.api.request('declareNativeDeliveryGaps', {
			path: { exam_attempt_id: attemptId, stream_id: streamId },
			header: { ...headers(access), 'Idempotency-Key': body.declaration_id },
			body
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
	}

	public async seal(
		attemptId: string,
		streamId: string,
		body: FinalDeliveryDeclaration,
		access: NativeDeliveryAccess | undefined
	): Promise<void> {
		const result = await this.api.request('sealNativeDelivery', {
			path: { exam_attempt_id: attemptId, stream_id: streamId },
			header: { ...headers(access), 'Idempotency-Key': body.declaration_id },
			body
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
	}
}
