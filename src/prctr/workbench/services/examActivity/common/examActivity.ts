/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	ExamActivityClient,
	ExamActivityIntent,
	ExamActivityResponse
} from '../../../../platform/examActivity/common/examActivityProtocol.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { ApiSubscription } from '../../../../platform/serverApi/common/apiObservation.js';

export const IExamActivityService = createDecorator<IExamActivityService>('examActivityService');

/**
 * AuthenticatedWindow's bound exam-activity read capability. The server owns the
 * activity; the window presents its projection and asks for one page at a time.
 */
export interface IExamActivityService extends ExamActivityClient {
	readonly _serviceBrand: undefined;
}

export class ExamActivityService implements IExamActivityService {
	declare readonly _serviceBrand: undefined;
	readonly observe?: (
		intent: ExamActivityIntent,
		listener: (response: ExamActivityResponse) => void
	) => ApiSubscription;

	constructor(private readonly client: ExamActivityClient) {
		const observe = client.observe;
		if (observe !== undefined) {
			this.observe = (intent, listener) => observe.call(client, intent, listener);
		}
	}

	request(intent: ExamActivityIntent): Promise<ExamActivityResponse> {
		return this.client.request(intent);
	}
}
