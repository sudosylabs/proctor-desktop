import type { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import type { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import type { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import type { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import type { EditorWindowHostBindings } from '../../host/browser/editorWindowHostService.js';

/** Platform acquisition is selected by the authenticated composition, outside editor mechanisms. */
export interface SettingsEditorEnvironment {
	createClipboard(layout: ILayoutService): IClipboardService;
	createContextMenu(services: ServiceCollection, instantiation: IInstantiationService): IContextMenuService & IDisposable;
	readonly window: Omit<EditorWindowHostBindings, 'setDimmed'>;
	readonly isDevelopment: boolean;
}
