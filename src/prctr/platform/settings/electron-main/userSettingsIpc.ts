import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron/main';
import { AUTHENTICATED_SETTINGS_CHANNELS } from '../../windows/common/windowChannels.js';
import { validateUserSettingsCommitIntent, validateUserSettingsPreviewIntent } from '../common/settingsRendererProtocol.js';
import type { UserSettingsCoordinator } from './userSettingsCoordinator.js';

export class UserSettingsIpcBridge {
	readonly #changeSubscription: { dispose(): void }; readonly #handled: string[]; #disposed = false;
	constructor(private readonly ipcMain: IpcMain, private readonly authenticatedContents: WebContents, coordinator: UserSettingsCoordinator) {
		const handled: string[] = []; let changeSubscription: { dispose(): void } | undefined;
		try {
			ipcMain.handle(AUTHENTICATED_SETTINGS_CHANNELS.projection, event => { this.#assertSender(event); return coordinator.projection(); }); handled.push(AUTHENTICATED_SETTINGS_CHANNELS.projection);
			ipcMain.handle(AUTHENTICATED_SETTINGS_CHANNELS.preview, (event, value: unknown) => { this.#assertSender(event); coordinator.preview(validateUserSettingsPreviewIntent(value)); }); handled.push(AUTHENTICATED_SETTINGS_CHANNELS.preview);
			ipcMain.handle(AUTHENTICATED_SETTINGS_CHANNELS.cancelPreview, event => { this.#assertSender(event); coordinator.cancelPreview(); }); handled.push(AUTHENTICATED_SETTINGS_CHANNELS.cancelPreview);
			ipcMain.handle(AUTHENTICATED_SETTINGS_CHANNELS.commit, (event, value: unknown) => { this.#assertSender(event); return coordinator.commit(validateUserSettingsCommitIntent(value)); }); handled.push(AUTHENTICATED_SETTINGS_CHANNELS.commit);
			changeSubscription = coordinator.onDidChange(projection => { if (!authenticatedContents.isDestroyed()) authenticatedContents.send(AUTHENTICATED_SETTINGS_CHANNELS.changed, projection); });
		} catch (error) { const cleanupErrors = rollbackSettingsIpc(ipcMain, handled, changeSubscription); if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], 'User Settings IPC registration and rollback failed'); throw error; }
		this.#handled = handled; this.#changeSubscription = changeSubscription;
	}
	#assertSender(event: IpcMainInvokeEvent): void { if (event.sender.id !== this.authenticatedContents.id || event.senderFrame !== this.authenticatedContents.mainFrame) throw new Error('User Settings IPC sender is not the bound AuthenticatedWindow'); }
	dispose(): void { if (this.#disposed) return; this.#disposed = true; const errors = rollbackSettingsIpc(this.ipcMain, this.#handled, this.#changeSubscription); if (errors.length > 0) throw new AggregateError(errors, 'User Settings IPC disposal failed'); }
}
function rollbackSettingsIpc(ipcMain: IpcMain, handled: readonly string[], changeSubscription: { dispose(): void } | undefined): unknown[] { const errors: unknown[] = []; if (changeSubscription !== undefined) { try { changeSubscription.dispose(); } catch (error) { errors.push(error); } } for (const channel of [...handled].reverse()) { try { ipcMain.removeHandler(channel); } catch (error) { errors.push(error); } } return errors; }
