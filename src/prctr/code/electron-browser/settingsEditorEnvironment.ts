import { NativeClipboardService } from '../../workbench/services/clipboard/electron-browser/clipboardService.js';
import { ContextMenuService } from '../../workbench/services/contextmenu/electron-browser/contextmenuService.js';
import { INativeContextMenuTransport } from '../../platform/contextview/browser/nativeContextMenuTransport.js';
import { NullLogService } from '../../platform/log/common/log.js';
import type { SettingsNativeClient } from '../../platform/settings/common/settingsNativeHost.js';
import type { SettingsEditorEnvironment } from '../../workbench/services/settings/browser/settingsEditorEnvironment.js';

export function createElectronSettingsEditorEnvironment(
	native: SettingsNativeClient
): SettingsEditorEnvironment {
	return {
		isDevelopment: false,
		window: {
			focus: () => native.window.focus(),
			moveTop: () => native.window.moveTop(),
			getCursorScreenPoint: () => native.window.getCursorScreenPoint()
		},
		createClipboard: () => new NativeClipboardService(native.clipboard, new NullLogService()),
		createContextMenu(services, instantiation) {
			services.set(INativeContextMenuTransport, {
				_serviceBrand: undefined,
				popup: (requestId, items, options) => native.popup({ requestId, items, options }),
				cancel: (requestId) => native.cancelPopup(requestId)
			});
			return instantiation.createInstance(ContextMenuService);
		}
	};
}
