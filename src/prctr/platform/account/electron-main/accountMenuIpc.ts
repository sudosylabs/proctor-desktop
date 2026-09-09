import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import {
	ACCOUNT_MENU_CHANNEL,
	validateAccountMenuAnchor,
	type AccountMenuAction,
	type AccountMenuAnchor
} from '../common/accountMenu.js';

export interface AccountMenuHost {
	popup(
		anchor: AccountMenuAnchor,
		selected: (action: AccountMenuAction) => void,
		closed: () => void
	): IDisposable;
}
/** A fixed account menu, owned by one authenticated sender. No executable menu data crosses IPC. */
export class AccountMenuIpcBridge {
	#disposed = false;
	#pending: (() => void) | undefined;
	constructor(
		private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		host: AccountMenuHost,
		authorize: (event: IpcMainInvokeEvent) => void
	) {
		ipc.handle(ACCOUNT_MENU_CHANNEL, async (event, ...args: unknown[]) => {
			if (this.#disposed) throw new Error('Account menu is closed');
			authorize(event);
			if (args.length !== 1) throw new TypeError('Expected one menu anchor');
			const anchor = validateAccountMenuAnchor(args[0]);
			if (this.#pending) return undefined;
			return new Promise<AccountMenuAction | undefined>((resolve, reject) => {
				let popup: IDisposable | undefined;
				let finished = false;
				const finish = (action?: AccountMenuAction): void => {
					if (finished) return;
					finished = true;
					this.#pending = undefined;
					popup?.dispose();
					try {
						if (!this.#disposed) authorize(event);
						resolve(this.#disposed ? undefined : action);
					} catch (error) {
						reject(error);
					}
				};
				this.#pending = () => finish();
				try {
					popup = host.popup(
						anchor,
						(action) => finish(action),
						() => finish()
					);
					if (finished) popup.dispose();
				} catch (error) {
					this.#pending = undefined;
					finished = true;
					reject(error);
				}
			});
		});
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#pending?.();
		this.ipc.removeHandler(ACCOUNT_MENU_CHANNEL);
	}
}
