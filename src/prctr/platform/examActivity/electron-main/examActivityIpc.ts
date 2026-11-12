import { CapabilityObservationChannel } from '../../capabilityObservation/electron-main/capabilityObservationChannel.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import type { SessionBinding } from '../../serverApi/common/projection.js';
import {
	EXAM_ACTIVITY_CHANNEL,
	validateExamActivityIntent,
	validateExamActivityResponse,
	type ExamActivityIntent,
	type ExamActivityResponse
} from '../common/examActivityProtocol.js';

export interface ExamActivityCapability {
	observeExamActivity?(
		binding: SessionBinding,
		intent: ExamActivityIntent,
		listener: (response: ExamActivityResponse) => void
	): IDisposable;
	setApiFocused?(binding: SessionBinding, focused: boolean): void;
	examActivity(
		binding: SessionBinding,
		intent: ExamActivityIntent
	): Promise<ExamActivityResponse>;
}
export class ExamActivityIpcBridge {
	#disposed = false;
	private readonly observation:
		CapabilityObservationChannel<ExamActivityIntent, ExamActivityResponse> | undefined;
	constructor(
		private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		binding: SessionBinding,
		service: ExamActivityCapability,
		authorize: (event: IpcMainInvokeEvent) => void
	) {
		const bound = Object.freeze({
			principalId: binding.principalId,
			sessionId: binding.sessionId
		});
		if (service.observeExamActivity)
			this.observation = new CapabilityObservationChannel(ipc, {
				channel: `${EXAM_ACTIVITY_CHANNEL}:observe`,
				validateIntent: validateExamActivityIntent,
				validateResponse: validateExamActivityResponse,
				authorize,
				observe: (intent, listener) =>
					service.observeExamActivity!(bound, intent, listener),
				failure: { kind: 'error', reason: 'unavailable' }
			});
		ipc.handle(EXAM_ACTIVITY_CHANNEL, async (event, ...args: unknown[]) => {
			if (this.#disposed) throw new Error('Exam activity capability is closed');
			authorize(event);
			if (args.length !== 1) throw new TypeError('Expected one intent');
			const result = await service.examActivity(bound, validateExamActivityIntent(args[0]));
			if (this.#disposed) return { kind: 'error', reason: 'sessionEnded' };
			authorize(event);
			return validateExamActivityResponse(result);
		});
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.observation?.dispose();
		this.ipc.removeHandler(EXAM_ACTIVITY_CHANNEL);
	}
}
