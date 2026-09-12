import { ApiObservationIpc } from '../../serverApi/electron-main/apiObservationIpc.js';
import type { ApiSubscription } from '../../serverApi/common/apiObservation.js';
import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import type { AccountBinding } from '../../account/common/accountProtocol.js';
import {
	EXAM_ACTIVITY_CHANNEL,
	validateExamActivityIntent,
	validateExamActivityResponse,
	type ExamActivityIntent,
	type ExamActivityResponse
} from '../common/examActivityProtocol.js';

export interface ExamActivityService {
	observeExamActivity?(
		binding: AccountBinding,
		intent: ExamActivityIntent,
		listener: (response: ExamActivityResponse) => void
	): ApiSubscription;
	setApiFocused?(binding: AccountBinding, focused: boolean): void;
	examActivity(
		binding: AccountBinding,
		intent: ExamActivityIntent
	): Promise<ExamActivityResponse>;
}
export class ExamActivityIpcBridge {
	#disposed = false;
	private readonly observation:
		ApiObservationIpc<ExamActivityIntent, ExamActivityResponse> | undefined;
	constructor(
		private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		binding: AccountBinding,
		service: ExamActivityService,
		authorize: (event: IpcMainInvokeEvent) => void
	) {
		const bound = Object.freeze({
			principalId: binding.principalId,
			sessionId: binding.sessionId
		});
		if (service.observeExamActivity)
			this.observation = new ApiObservationIpc(
				ipc,
				`${EXAM_ACTIVITY_CHANNEL}:observe`,
				validateExamActivityIntent,
				validateExamActivityResponse,
				authorize,
				(intent, listener) => service.observeExamActivity!(bound, intent, listener)
			);
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
