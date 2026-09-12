import { createApiObserver } from './apiObservationPreload.js';
import {
	EXAM_ACTIVITY_CHANNEL,
	validateExamActivityIntent,
	validateExamActivityResponse
} from '../../platform/examActivity/common/examActivityProtocol.js';
import {
	ACCOUNT_MENU_CHANNEL,
	validateAccountMenuAnchor,
	validateAccountMenuAction
} from '../../platform/account/common/accountMenu.js';
import {
	ACCOUNT_CHANNEL,
	validateAccountIntent,
	validateAccountResponse
} from '../../platform/account/common/accountProtocol.js';
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
import { createSettingsNativePreloadClient } from './settingsNativePreload.js';

contextBridge.exposeInMainWorld(
	'proctorAuthenticated',
	Object.freeze({
		settingsNative: createSettingsNativePreloadClient(),
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
		accountMenu:
			process.platform === 'darwin'
				? Object.freeze({
						show: async (anchor: unknown) =>
							validateAccountMenuAction(
								await ipcRenderer.invoke(
									ACCOUNT_MENU_CHANNEL,
									validateAccountMenuAnchor(anchor)
								)
							)
					})
				: undefined,
		examActivity: Object.freeze({
			observe: createApiObserver(
				`${EXAM_ACTIVITY_CHANNEL}:observe`,
				validateExamActivityIntent,
				validateExamActivityResponse,
				{ kind: 'error', reason: 'unavailable' }
			),
			request: async (intent: unknown) =>
				validateExamActivityResponse(
					await ipcRenderer.invoke(
						EXAM_ACTIVITY_CHANNEL,
						validateExamActivityIntent(intent)
					)
				)
		}),
		account: Object.freeze({
			observe: createApiObserver(
				`${ACCOUNT_CHANNEL}:observe`,
				validateAccountIntent,
				validateAccountResponse,
				{ kind: 'error', reason: 'unavailable' }
			),
			request: async (intent: unknown) =>
				validateAccountResponse(
					await ipcRenderer.invoke(ACCOUNT_CHANNEL, validateAccountIntent(intent))
				)
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
