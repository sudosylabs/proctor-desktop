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
	account(binding: AccountBinding, intent: AccountIntent): Promise<AccountResponse>;
}

/** One capability owned by one authenticated main frame and immutable Session Binding. */
export class AccountIpcBridge {
	#disposed = false;
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
		this.ipc.removeHandler(ACCOUNT_CHANNEL);
	}
}
