import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron/main';
import { AUTHENTICATED_SETTINGS_CHANNELS } from '../../windows/common/windowChannels.js';
import {
	validateUserSettingsCommitIntent,
	validateUserSettingsPreviewIntent
} from '../common/settingsRendererProtocol.js';
import type { UserSettingsCoordinator } from './userSettingsCoordinator.js';

export class UserSettingsIpcBridge {
	#changeSubscription: { dispose(): void } | undefined;
	readonly #handled: string[];
	#disposed = false;
	constructor(
		private readonly ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>,
		private readonly authenticatedContents: WebContents,
		coordinator: UserSettingsCoordinator | Promise<UserSettingsCoordinator>
	) {
		const handled: string[] = [];
		try {
			ipcMain.handle(AUTHENTICATED_SETTINGS_CHANNELS.projection, async (event) => {
				this.#assertSender(event);
				const ready = await coordinator;
				this.#assertSender(event);
				return ready.projection();
			});
			handled.push(AUTHENTICATED_SETTINGS_CHANNELS.projection);
			ipcMain.handle(
				AUTHENTICATED_SETTINGS_CHANNELS.preview,
				async (event, value: unknown) => {
					this.#assertSender(event);
					const intent = validateUserSettingsPreviewIntent(value);
					const ready = await coordinator;
					this.#assertSender(event);
					ready.preview(intent);
				}
			);
			handled.push(AUTHENTICATED_SETTINGS_CHANNELS.preview);
			ipcMain.handle(AUTHENTICATED_SETTINGS_CHANNELS.cancelPreview, async (event) => {
				this.#assertSender(event);
				const ready = await coordinator;
				this.#assertSender(event);
				ready.cancelPreview();
			});
			handled.push(AUTHENTICATED_SETTINGS_CHANNELS.cancelPreview);
			ipcMain.handle(
				AUTHENTICATED_SETTINGS_CHANNELS.commit,
				async (event, value: unknown) => {
					this.#assertSender(event);
					const intent = validateUserSettingsCommitIntent(value);
					const ready = await coordinator;
					this.#assertSender(event);
					return ready.commit(intent);
				}
			);
			handled.push(AUTHENTICATED_SETTINGS_CHANNELS.commit);
			const subscribe = (ready: UserSettingsCoordinator): void => {
				if (this.#disposed) return;
				this.#changeSubscription = ready.onDidChange((projection) => {
					if (!authenticatedContents.isDestroyed())
						authenticatedContents.send(
							AUTHENTICATED_SETTINGS_CHANNELS.changed,
							projection
						);
				});
			};
			if (coordinator instanceof Promise)
				void coordinator.then(subscribe).catch(() => undefined);
			else subscribe(coordinator);
		} catch (error) {
			const cleanupErrors = rollbackSettingsIpc(ipcMain, handled, this.#changeSubscription);
			if (cleanupErrors.length > 0)
				throw new AggregateError(
					[error, ...cleanupErrors],
					'User Settings IPC registration and rollback failed'
				);
			throw error;
		}
		this.#handled = handled;
	}
	#assertSender(event: IpcMainInvokeEvent): void {
		if (
			this.#disposed ||
			event.sender.id !== this.authenticatedContents.id ||
			event.senderFrame !== this.authenticatedContents.mainFrame
		)
			throw new Error('User Settings IPC sender is not the bound AuthenticatedWindow');
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const errors = rollbackSettingsIpc(this.ipcMain, this.#handled, this.#changeSubscription);
		if (errors.length > 0)
			throw new AggregateError(errors, 'User Settings IPC disposal failed');
	}
}
function rollbackSettingsIpc(
	ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>,
	handled: readonly string[],
	changeSubscription: { dispose(): void } | undefined
): unknown[] {
	const errors: unknown[] = [];
	if (changeSubscription !== undefined) {
		try {
			changeSubscription.dispose();
		} catch (error) {
			errors.push(error);
		}
	}
	for (const channel of [...handled].reverse()) {
		try {
			ipcMain.removeHandler(channel);
		} catch (error) {
			errors.push(error);
		}
	}
	return errors;
}
