import { ipcRenderer } from 'electron';
import {
	SETTINGS_NATIVE_CHANNEL,
	SETTINGS_CLIPBOARD_IMAGE_LIMIT,
	validateSettingsNativeIntent,
	validateSettingsCursorScreenPoint,
	validateSettingsClipboardText,
	validateSettingsClipboardBytes,
	validateSettingsMenuSelection,
	type SettingsNativeClient,
	type SettingsNativeIntent,
	type SettingsClipboardClient
} from '../../platform/settings/common/settingsNativeHost.js';

/** Only the authenticated preload exposes these closed native operations. */
export function createSettingsNativePreloadClient(): SettingsNativeClient {
	const invoke = (intent: SettingsNativeIntent): Promise<unknown> =>
		ipcRenderer.invoke(SETTINGS_NATIVE_CHANNEL, validateSettingsNativeIntent(intent));
	const invokeVoid = async (intent: SettingsNativeIntent): Promise<void> => {
		if ((await invoke(intent)) !== undefined)
			throw new TypeError('Unexpected Settings native response');
	};
	return Object.freeze({
		window: Object.freeze({
			focus: () => invokeVoid({ kind: 'focusWindow' }),
			moveTop: () => invokeVoid({ kind: 'moveWindowTop' }),
			getCursorScreenPoint: async () =>
				validateSettingsCursorScreenPoint(await invoke({ kind: 'cursorScreenPoint' }))
		}),
		popup: async (menu) => validateSettingsMenuSelection(await invoke({ kind: 'menu', menu })),
		cancelPopup: async (requestId) => invokeVoid({ kind: 'cancelMenu', requestId }),
		clipboard: Object.freeze({
			readText: async (type = 'clipboard') =>
				validateSettingsClipboardText(await invoke({ kind: 'readText', type })),
			writeText: async (text, type = 'clipboard') =>
				invokeVoid({ kind: 'writeText', text, type }),
			readFindText: async () =>
				validateSettingsClipboardText(await invoke({ kind: 'readFindText' })),
			writeFindText: async (text) => invokeVoid({ kind: 'writeFindText', text }),
			readImage: async () =>
				validateSettingsClipboardBytes(
					await invoke({ kind: 'readImage' }),
					SETTINGS_CLIPBOARD_IMAGE_LIMIT
				),
			readResources: async () =>
				validateSettingsClipboardBytes(await invoke({ kind: 'readResources' })),
			writeResources: async (value) => invokeVoid({ kind: 'writeResources', value }),
			hasResources: async () => {
				const value = await invoke({ kind: 'hasResources' });
				if (typeof value !== 'boolean')
					throw new TypeError('Invalid clipboard resource result');
				return value;
			},
			paste: async () => invokeVoid({ kind: 'paste' })
		} satisfies SettingsClipboardClient)
	} satisfies SettingsNativeClient);
}
