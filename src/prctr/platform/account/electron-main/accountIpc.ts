import { CapabilityObservationChannel } from '../../capabilityObservation/electron-main/capabilityObservationChannel.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import type { SessionBinding } from '../../serverApi/common/projection.js';
import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import {
	ACCOUNT_CHANNEL,
	validateAccountIntent,
	validateAccountResponse,
	type AccountIntent,
	type AccountResponse
} from '../common/accountProtocol.js';

export interface AccountCapability {
	observeAccount?(
		binding: SessionBinding,
		intent: AccountIntent,
		listener: (response: AccountResponse) => void
	): IDisposable;
	setApiFocused?(binding: SessionBinding, focused: boolean): void;
	account(binding: SessionBinding, intent: AccountIntent): Promise<AccountResponse>;
}

/** One capability owned by one authenticated main frame and immutable Session Binding. */
export class AccountIpcBridge {
	#disposed = false;
	private readonly observation:
		CapabilityObservationChannel<AccountIntent, AccountResponse> | undefined;
	constructor(
		private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		binding: SessionBinding,
		service: AccountCapability,
		authorize: (event: IpcMainInvokeEvent) => void
	) {
		const bound = Object.freeze({
			principalId: binding.principalId,
			sessionId: binding.sessionId
		});
		if (service.observeAccount)
			this.observation = new CapabilityObservationChannel(ipc, {
				channel: `${ACCOUNT_CHANNEL}:observe`,
				validateIntent: validateAccountIntent,
				validateResponse: validateAccountResponse,
				authorize,
				observe: (intent, listener) => service.observeAccount!(bound, intent, listener),
				failure: { kind: 'error', reason: 'unavailable' }
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
		this.observation?.dispose();
		this.ipc.removeHandler(ACCOUNT_CHANNEL);
	}
}
