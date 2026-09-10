import type { IpcMain, WebContents } from 'electron/main';
import type {
	UserSettingsSessionService,
	SettingsSessionBinding
} from '../common/userSettingsSession.js';
import { UserSettingsCoordinator } from './userSettingsCoordinator.js';
import { UserSettingsIpcBridge } from './userSettingsIpc.js';

/** One authenticated window owns its source, drafts and IPC. The next window refetches authority. */
export function bindWindowUserSettings(
	ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
	contents: WebContents,
	binding: SettingsSessionBinding,
	service: UserSettingsSessionService
): { dispose(): void } {
	let disposed = false;
	const ready = (async () => {
		const snapshot = await service.readSettings(binding).catch(() => undefined);
		const coordinator = await UserSettingsCoordinator.create({
			binding,
			context: { window: 'authenticated' },
			authority: { commit: (owner, request) => service.commitSettings(owner, request) },
			// No unprotected disk cache. Acknowledged source lives only in this bound coordinator.
			cache: {
				async load() {
					return undefined;
				},
				async store() {}
			},
			...(snapshot ? { acknowledged: snapshot.acknowledged } : {}),
			writable: snapshot?.writable ?? false
		});
		if (disposed) await coordinator.dispose();
		return coordinator;
	})();
	let bridge: UserSettingsIpcBridge;
	try {
		bridge = new UserSettingsIpcBridge(ipc, contents, ready);
	} catch (error) {
		disposed = true;
		void ready.then((c) => c.dispose()).catch(() => undefined);
		throw error;
	}
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			try {
				bridge.dispose();
			} finally {
				void ready.then((c) => c.dispose()).catch(() => undefined);
			}
		}
	};
}
