import { contextBridge, ipcRenderer } from 'electron';
import { WINDOW_CHANNELS, LAUNCH_IDENTITY_CHANNELS } from '../../platform/windows/common/windowChannels.js';
import { validateWindowDescriptor, type LaunchWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import { validateLaunchIdentityIntent, validateLaunchIdentityProjection, type LaunchIdentityClient } from '../../platform/identity/common/launchIdentity.js';
import { createWindowChromePreloadClient } from './windowChromePreload.js';

const identity: LaunchIdentityClient = Object.freeze({
	projection: async () => validateLaunchIdentityProjection(await ipcRenderer.invoke(LAUNCH_IDENTITY_CHANNELS.projection)),
	onDidChange: (listener: Parameters<LaunchIdentityClient['onDidChange']>[0]) => {
		const receive = (_event: unknown, value: unknown): void => listener(validateLaunchIdentityProjection(value));
		ipcRenderer.on(LAUNCH_IDENTITY_CHANNELS.changed, receive);
		return Object.freeze({ dispose: () => { ipcRenderer.removeListener(LAUNCH_IDENTITY_CHANNELS.changed, receive); } });
	},
	selectServer: async (address: string) => { await ipcRenderer.invoke(LAUNCH_IDENTITY_CHANNELS.intent, validateLaunchIdentityIntent({ kind: 'selectServer', address })); },
	retry: async () => { await ipcRenderer.invoke(LAUNCH_IDENTITY_CHANNELS.intent, { kind: 'retry' }); },
	changeServer: async () => { await ipcRenderer.invoke(LAUNCH_IDENTITY_CHANNELS.intent, { kind: 'changeServer' }); },
	signIn: async () => { await ipcRenderer.invoke(LAUNCH_IDENTITY_CHANNELS.intent, { kind: 'signIn' }); },
	cancel: async () => { await ipcRenderer.invoke(LAUNCH_IDENTITY_CHANNELS.intent, { kind: 'cancel' }); },
	reopenBrowser: async () => { await ipcRenderer.invoke(LAUNCH_IDENTITY_CHANNELS.intent, { kind: 'reopenBrowser' }); }
});

contextBridge.exposeInMainWorld('proctorLaunch', Object.freeze({
  bootstrap: async (): Promise<LaunchWindowDescriptor> => { const descriptor = validateWindowDescriptor(await ipcRenderer.invoke(WINDOW_CHANNELS.launch.bootstrap)); if (descriptor.kind !== 'launch') throw new TypeError('Launch bootstrap returned the wrong window kind'); return descriptor; },
	windowChrome: createWindowChromePreloadClient('launch'),
  identity,
  exit: (): Promise<void> => ipcRenderer.invoke(WINDOW_CHANNELS.launch.intent, { kind: 'launch.exit' })
}));
