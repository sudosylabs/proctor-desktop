import { BrowserClipboardService } from '../../../src/prctr/platform/clipboard/browser/clipboardService.js';
import { ContextMenuService } from '../../../src/prctr/platform/contextview/browser/contextMenuService.js';
import { NullLogService } from '../../../src/prctr/platform/log/common/log.js';
import type { SettingsEditorEnvironment } from '../../../src/prctr/workbench/services/settings/browser/settingsEditorEnvironment.js';

/** Browser-only fixture acquisition; Electron production uses its authenticated native capability. */
export const browserSettingsEditorEnvironment: SettingsEditorEnvironment = {
	isDevelopment: false,
	createClipboard: layout => new BrowserClipboardService(layout, new NullLogService()),
	createContextMenu: (_services, instantiation) => instantiation.createInstance(ContextMenuService),
	window: {
		async focus() { window.focus(); }, async moveTop() { window.focus(); }, async getCursorScreenPoint() { return undefined; }
	}
};
