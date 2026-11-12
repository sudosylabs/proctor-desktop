/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from '../../../base/common/lifecycle.js';
import { ServerApiError } from '../../serverApi/common/serverApi.js';
import type { SessionBinding } from '../../serverApi/common/projection.js';
import type { SessionApi } from '../../serverApi/node/sessionApi.js';
import type { ReadPolicy } from '../../serverApi/node/sessionReads.js';
import {
	validateExamActivityIntent,
	type ExamActivityIntent,
	type ExamActivityResponse
} from '../common/examActivityProtocol.js';
import { readExamActivityWire } from './examActivityWire.js';

export type ExamActivityApi = Pick<SessionApi, 'request' | 'reads' | 'setFocused'>;

/** What the Session owner lends Exam Activity. Credentials and refresh never leave it. */
export interface ExamActivitySessionPort {
	/** The typed client of the bound Session; throws `sessionEnded` once it is not current. */
	apiForSession(binding: SessionBinding): ExamActivityApi;
	/** The Desktop registration the bound Session signed in with. */
	currentRegistration(binding: SessionBinding): string;
}

const PAGE_SIZE = 20;

/**
 * The read-only Exam Activity capability of an authenticated Session: navigation context,
 * the candidate's activity and released results, each a whitelist projection.
 */
export class ExamActivityService {
	constructor(private readonly session: ExamActivitySessionPort) {}

	async examActivity(
		binding: SessionBinding,
		raw: ExamActivityIntent
	): Promise<ExamActivityResponse> {
		const intent = validateExamActivityIntent(raw);
		try {
			return await this.session
				.apiForSession(binding)
				.reads.read(
					['examActivity', intent],
					(signal) => this.#read(binding, intent, signal),
					policy(intent)
				);
		} catch (error) {
			return failure(error, intent);
		}
	}

	observeExamActivity(
		binding: SessionBinding,
		raw: ExamActivityIntent,
		listener: (response: ExamActivityResponse) => void
	): IDisposable {
		const intent = validateExamActivityIntent(raw);
		return this.session.apiForSession(binding).reads.observe(
			['examActivity', intent],
			(signal) => this.#read(binding, intent, signal),
			(state) => {
				if (state.error) listener(failure(state.error, intent));
				else if (state.value) listener(state.value);
			},
			{ ...policy(intent), pollIntervalMs: 30_000 }
		);
	}

	setApiFocused(binding: SessionBinding, focused: boolean): void {
		this.session.apiForSession(binding).setFocused(focused);
	}

	async #read(
		binding: SessionBinding,
		intent: ExamActivityIntent,
		signal: AbortSignal
	): Promise<ExamActivityResponse> {
		const api = this.session.apiForSession(binding);
		const result =
			intent.kind === 'context'
				? await api.request('getCurrentUserContext', {}, { signal })
				: intent.kind === 'result'
					? await api.request(
							'getStudentExamResult',
							{ path: { exam_attempt_id: intent.attemptId } },
							{ signal }
						)
					: await api.request(
							'listCandidateExamActivity',
							{
								query: {
									limit: PAGE_SIZE,
									...(intent.cursor ? { cursor: intent.cursor } : {})
								}
							},
							{ signal }
						);
		return readExamActivityWire(
			intent,
			result.value,
			binding.principalId,
			this.session.currentRegistration(binding)
		);
	}
}

function policy(intent: ExamActivityIntent): ReadPolicy {
	return { staleTime: intent.kind === 'context' ? 0 : 30_000 };
}

/** The closed reason for a failure. The Session signer already ended a refused Session. */
function failure(error: unknown, intent: ExamActivityIntent): ExamActivityResponse {
	const reason = (): Extract<ExamActivityResponse, { kind: 'error' }>['reason'] => {
		if (!(error instanceof ServerApiError)) return 'unavailable';
		if (error.kind === 'sessionEnded') return 'sessionEnded';
		if (error.kind !== 'server') return 'unavailable';
		if (error.status === 401) return 'sessionEnded';
		if (error.status === 403) return 'restricted';
		if (error.status === 404 && intent.kind === 'result') return 'notFound';
		if (error.status === 400 && intent.kind === 'activity' && intent.cursor)
			return 'invalidCursor';
		return 'unavailable';
	};
	return { kind: 'error', reason: reason() };
}
