import { contextBridge, ipcRenderer } from 'electron';
import { WINDOW_CHANNELS } from '../../platform/windows/common/windowChannels.js';
import { validateWindowDescriptor, type LaunchWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';

contextBridge.exposeInMainWorld('proctorLaunch', Object.freeze({
  bootstrap: async (): Promise<LaunchWindowDescriptor> => { const descriptor = validateWindowDescriptor(await ipcRenderer.invoke(WINDOW_CHANNELS.launch.bootstrap)); if (descriptor.kind !== 'launch') throw new TypeError('Launch bootstrap returned the wrong window kind'); return descriptor; },
  changeServer: (): Promise<void> => ipcRenderer.invoke(WINDOW_CHANNELS.launch.intent, { kind: 'launch.changeServer' }),
  signIn: (): Promise<void> => ipcRenderer.invoke(WINDOW_CHANNELS.launch.intent, { kind: 'launch.signIn' }),
  exit: (): Promise<void> => ipcRenderer.invoke(WINDOW_CHANNELS.launch.intent, { kind: 'launch.exit' })
}));
