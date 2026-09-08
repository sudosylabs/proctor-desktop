import { contextBridge, ipcRenderer } from 'electron';
import {
	AUTHENTICATED_SETTINGS_CHANNELS,
	WINDOW_CHANNELS
} from '../../platform/windows/common/windowChannels.js';
import {
	validateWindowDescriptor,
	type AuthenticatedWindowDescriptor
} from '../../platform/windows/common/windowProtocol.js';
import {
	validateUserSettingsCommitIntent,
	validateUserSettingsCommitResponse,
	validateUserSettingsPreviewIntent,
	validateUserSettingsProjection
} from '../../platform/settings/common/settingsRendererProtocol.js';
import { createWindowChromePreloadClient } from './windowChromePreload.js';

contextBridge.exposeInMainWorld(
	'proctorAuthenticated',
	Object.freeze({
		bootstrap: async (): Promise<AuthenticatedWindowDescriptor> => {
			const descriptor = validateWindowDescriptor(
				await ipcRenderer.invoke(WINDOW_CHANNELS.authenticated.bootstrap)
			);
			if (descriptor.kind !== 'authenticated')
				throw new TypeError('Authenticated bootstrap returned the wrong window kind');
			return descriptor;
		},
		windowChrome: createWindowChromePreloadClient('authenticated'),
		signOut: (): Promise<void> =>
			ipcRenderer.invoke(WINDOW_CHANNELS.authenticated.intent, {
				kind: 'authenticated.signOut'
			}),
		joinAttempt: (attemptId: string): Promise<void> =>
			ipcRenderer.invoke(WINDOW_CHANNELS.authenticated.intent, {
				kind: 'authenticated.joinAttempt',
				attemptId
			}),
		close: (): Promise<void> =>
			ipcRenderer.invoke(WINDOW_CHANNELS.authenticated.intent, {
				kind: 'authenticated.close'
			}),
		settings: Object.freeze({
			projection: async () =>
				validateUserSettingsProjection(
					await ipcRenderer.invoke(AUTHENTICATED_SETTINGS_CHANNELS.projection)
				),
			preview: async (intent: unknown) => {
				await ipcRenderer.invoke(
					AUTHENTICATED_SETTINGS_CHANNELS.preview,
					validateUserSettingsPreviewIntent(intent)
				);
			},
			cancelPreview: async () => {
				await ipcRenderer.invoke(AUTHENTICATED_SETTINGS_CHANNELS.cancelPreview);
			},
			commit: async (intent: unknown) =>
				validateUserSettingsCommitResponse(
					await ipcRenderer.invoke(
						AUTHENTICATED_SETTINGS_CHANNELS.commit,
						validateUserSettingsCommitIntent(intent)
					)
				),
			onDidChange: (
				listener: (projection: ReturnType<typeof validateUserSettingsProjection>) => void
			): (() => void) => {
				const receive = (_event: unknown, value: unknown): void =>
					listener(validateUserSettingsProjection(value));
				ipcRenderer.on(AUTHENTICATED_SETTINGS_CHANNELS.changed, receive);
				return () =>
					ipcRenderer.removeListener(AUTHENTICATED_SETTINGS_CHANNELS.changed, receive);
			}
		})
	})
);
