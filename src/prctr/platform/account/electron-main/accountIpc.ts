import { ApiObservationIpc } from '../../serverApi/electron-main/apiObservationIpc.js';
import type { ApiSubscription } from '../../serverApi/common/apiObservation.js';
import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import {
	ACCOUNT_CHANNEL,
	validateAccountIntent,
	validateAccountResponse,
	type AccountBinding,
	type AccountIntent,
	type AccountResponse
} from '../common/accountProtocol.js';

export interface AccountService {
	observeAccount?(
		binding: AccountBinding,
		intent: AccountIntent,
		listener: (response: AccountResponse) => void
	): ApiSubscription;
	setApiFocused?(binding: AccountBinding, focused: boolean): void;
	account(binding: AccountBinding, intent: AccountIntent): Promise<AccountResponse>;
}

/** One capability owned by one authenticated main frame and immutable Session Binding. */
export class AccountIpcBridge {
	#disposed = false;
	private readonly observation: ApiObservationIpc<AccountIntent, AccountResponse> | undefined;
	constructor(
		private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		binding: AccountBinding,
		service: AccountService,
		authorize: (event: IpcMainInvokeEvent) => void
	) {
		const bound = Object.freeze({
			principalId: binding.principalId,
			sessionId: binding.sessionId
		});
		if (service.observeAccount)
			this.observation = new ApiObservationIpc(
				ipc,
				`${ACCOUNT_CHANNEL}:observe`,
				validateAccountIntent,
				validateAccountResponse,
				authorize,
				(intent, listener) => service.observeAccount!(bound, intent, listener),
				{ kind: 'error', reason: 'unavailable' }
			);
		ipc.handle(ACCOUNT_CHANNEL, async (event, ...args: unknown[]) => {
			if (this.#disposed) throw new Error('Account capability is closed');
			authorize(event);
			if (args.length !== 1) throw new TypeError('Expected one account intent');
			const result = await service.account(bound, validateAccountIntent(args[0]));
			if (this.#disposed) return { kind: 'error', reason: 'sessionEnded' };
			authorize(event);
			return validateAccountResponse(result);
		});
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.observation?.dispose();
		this.ipc.removeHandler(ACCOUNT_CHANNEL);
	}
}
