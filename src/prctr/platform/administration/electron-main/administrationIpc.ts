/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ApiObservationIpc } from '../../serverApi/electron-main/apiObservationIpc.js';
import type { ApiSubscription } from '../../serverApi/common/apiObservation.js';
import type { SessionBinding } from '../../serverApi/common/projection.js';
import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import {
	ADMINISTRATION_CHANNEL,
	validateAdministrationIntent,
	validateAdministrationResponse,
	type AdministrationIntent,
	type AdministrationResponse
} from '../common/administrationProtocol.js';

export interface AdministrationIpcService {
	observeAdministration?(
		binding: SessionBinding,
		intent: AdministrationIntent,
		listener: (response: AdministrationResponse) => void
	): ApiSubscription;
	administration(
		binding: SessionBinding,
		intent: AdministrationIntent
	): Promise<AdministrationResponse>;
}

/** One capability owned by one authenticated main frame and immutable Session Binding. */
export class AdministrationIpcBridge {
	#disposed = false;
	private readonly observation:
		ApiObservationIpc<AdministrationIntent, AdministrationResponse> | undefined;
	constructor(
		private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		binding: SessionBinding,
		service: AdministrationIpcService,
		authorize: (event: IpcMainInvokeEvent) => void
	) {
		const bound = Object.freeze({
			principalId: binding.principalId,
			sessionId: binding.sessionId
		});
		if (service.observeAdministration)
			this.observation = new ApiObservationIpc(
				ipc,
				`${ADMINISTRATION_CHANNEL}:observe`,
				validateAdministrationIntent,
				validateAdministrationResponse,
				authorize,
				(intent, listener) => service.observeAdministration!(bound, intent, listener),
				{ kind: 'error', reason: 'unavailable' }
			);
		ipc.handle(ADMINISTRATION_CHANNEL, async (event, ...args: unknown[]) => {
			if (this.#disposed) throw new Error('Administration capability is closed');
			authorize(event);
			if (args.length !== 1) throw new TypeError('Expected one administration intent');
			const result = await service.administration(
				bound,
				validateAdministrationIntent(args[0])
			);
			if (this.#disposed) return { kind: 'error', reason: 'sessionEnded' };
			authorize(event);
			return validateAdministrationResponse(result);
		});
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.observation?.dispose();
		this.ipc.removeHandler(ADMINISTRATION_CHANNEL);
	}
}
