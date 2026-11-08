/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	CandidateSecurityIntent,
	CandidateSecurityProjection
} from './securityProjectionProtocol.js';

/** The CandidateWindow preload's bounded exam-security projection and intents. */
export interface CandidateSecurityRendererClient {
	projection(): Promise<CandidateSecurityProjection>;
	intent(intent: CandidateSecurityIntent): Promise<void>;
	onDidChange(listener: (projection: CandidateSecurityProjection) => void): () => void;
}

export const ICandidateSecurityService = createDecorator<ICandidateSecurityService>(
	'candidateSecurityService'
);

/**
 * The CandidateWindow's view of the exam-security coordinator. The coordinator owns
 * posture; the window only presents the projection and relays exact intents.
 */
export interface ICandidateSecurityService extends CandidateSecurityRendererClient {
	readonly _serviceBrand: undefined;
}

export class CandidateSecurityService implements ICandidateSecurityService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly client: CandidateSecurityRendererClient) {}

	projection(): Promise<CandidateSecurityProjection> {
		return this.client.projection();
	}

	intent(intent: CandidateSecurityIntent): Promise<void> {
		return this.client.intent(intent);
	}

	onDidChange(listener: (projection: CandidateSecurityProjection) => void): () => void {
		return this.client.onDidChange(listener);
	}
}
