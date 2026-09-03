import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron/main';
import { LAUNCH_IDENTITY_CHANNELS } from '../../windows/common/windowChannels.js';
import type { DesktopIdentityCoordinator } from './desktopIdentityCoordinator.js';

export class LaunchIdentityIpcBridge {
	readonly #handled: string[] = [];
	#subscription: { dispose(): void } | undefined;
	#disposed = false;
	constructor(
		private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		private readonly contents: WebContents,
		coordinator: DesktopIdentityCoordinator
	) {
		try {
			ipc.handle(LAUNCH_IDENTITY_CHANNELS.projection, (event, ...args: unknown[]) => {
				this.#assertSender(event);
				if (args.length !== 0) throw new TypeError('Projection accepts no arguments');
				return coordinator.projection();
			});
			this.#handled.push(LAUNCH_IDENTITY_CHANNELS.projection);
			ipc.handle(LAUNCH_IDENTITY_CHANNELS.intent, (event, ...args: unknown[]) => {
				this.#assertSender(event);
				if (args.length !== 1) throw new TypeError('Expected one LaunchWindow intent');
				return coordinator.handleIntent(args[0]);
			});
			this.#handled.push(LAUNCH_IDENTITY_CHANNELS.intent);
			this.#subscription = coordinator.onDidChange((projection) => {
				if (!this.#disposed && !contents.isDestroyed())
					contents.send(LAUNCH_IDENTITY_CHANNELS.changed, projection);
			});
		} catch (error) {
			try {
				this.dispose();
			} catch (cleanup) {
				throw new AggregateError([error, cleanup], 'Launch identity registration failed');
			}
			throw error;
		}
	}
	#assertSender(event: IpcMainInvokeEvent): void {
		if (
			this.#disposed ||
			this.contents.isDestroyed() ||
			event.sender.id !== this.contents.id ||
			event.senderFrame !== this.contents.mainFrame
		) {
			throw new Error('Launch identity sender is not the bound main frame');
		}
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const errors: unknown[] = [];
		try {
			this.#subscription?.dispose();
		} catch (error) {
			errors.push(error);
		}
		for (const channel of this.#handled.reverse()) {
			try {
				this.ipc.removeHandler(channel);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length) throw new AggregateError(errors, 'Launch identity disposal failed');
	}
}
