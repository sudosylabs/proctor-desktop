import type { IpcMain, WebContents } from 'electron/main';
import { UserSettingsCoordinator, type UserSettingsCoordinatorOptions } from '../../platform/settings/electron-main/userSettingsCoordinator.js';
import { UserSettingsIpcBridge } from '../../platform/settings/electron-main/userSettingsIpc.js';

/** AuthenticatedWindow composition root. The trusted identity owner supplies Principal-bound authority and cache ports. */
export async function createUserSettingsComposition(ipcMain: IpcMain, authenticatedContents: WebContents, options: UserSettingsCoordinatorOptions): Promise<{ readonly coordinator: UserSettingsCoordinator; readonly bridge: UserSettingsIpcBridge; dispose(): Promise<void> }> {
	const coordinator = await UserSettingsCoordinator.create(options); let bridge: UserSettingsIpcBridge;
	try { bridge = new UserSettingsIpcBridge(ipcMain, authenticatedContents, coordinator); }
	catch (error) { try { await coordinator.dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'User Settings composition and rollback failed'); } throw error; }
	return Object.freeze({ coordinator, bridge, async dispose(): Promise<void> { const errors: unknown[] = []; try { bridge.dispose(); } catch (error) { errors.push(error); } try { await coordinator.dispose(); } catch (error) { errors.push(error); } if (errors.length > 0) throw new AggregateError(errors, 'User Settings composition disposal failed'); } });
}
