import { Disposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { LabelService } from '../../label/common/labelService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import product from '../../../../platform/product/common/product.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { MenuService } from '../../../../platform/actions/common/menuService.js';
import {
	IContextMenuService,
	IContextViewService
} from '../../../../platform/contextview/browser/contextView.js';
import { ContextViewService } from '../../../../platform/contextview/browser/contextViewService.js';
import { IHoverService, WorkbenchHoverDelegate } from '../../../../platform/hover/browser/hover.js';
import { setHoverDelegateFactory } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { setBaseLayerHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegate2.js';
import { HoverService } from '../../../../platform/hover/browser/hoverService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import {
	IMarkdownRendererService,
	MarkdownRendererService
} from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IListService, ListService } from '../../../../platform/list/browser/listService.js';
import { IEditorRuntimeEnvironment } from '../../../../editor/common/services/editorRuntimeEnvironment.js';
import {
	ILanguageFeatureDebounceService,
	LanguageFeatureDebounceService
} from '../../../../editor/common/services/languageFeatureDebounce.js';
import {
	ISuggestMemoryService,
	SuggestMemoryService
} from '../../../../editor/contrib/suggest/browser/suggestMemory.js';
import {
	IAccessibilitySignalService,
	AccessibilitySignalService
} from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { IActionWidgetService } from '../../../../platform/actionWidget/browser/actionWidget.js';
import { ActionWidgetService } from '../../../../platform/actionWidget/browser/actionWidget.js';
import { IEditorProgressService } from '../../../../platform/progress/common/progress.js';

import { IBulkEditService } from '../../../../editor/browser/services/bulkEditService.js';
import { BulkEditService } from '../../../contrib/bulkEdit/browser/bulkEditService.js';

import { ISemanticTokensStylingService } from '../../../../editor/common/services/semanticTokensStyling.js';
import { SemanticTokensStylingService } from '../../../../editor/common/services/semanticTokensStylingService.js';
import {
	IEditorCancellationTokens,
	EditorCancellationTokens
} from '../../../../editor/contrib/editorState/browser/keybindingCancellation.js';
import { IEditorWindowHost } from '../../host/browser/editorWindowHost.js';
import { DialogHandlerContribution } from '../../../browser/parts/dialogs/dialogContribution.js';
export interface SettingsEditorControlBindings {
	readonly storage: IStorageService;
	readonly isDevelopment: boolean;
	readonly progress: IEditorProgressService;
	readonly windowHost: IEditorWindowHost;
	createContextMenu(instantiation: IInstantiationService): IContextMenuService & IDisposable;
	createOpener(instantiation: IInstantiationService): IOpenerService & IDisposable;
}

/** Installs the original control services once, with platform acquisition supplied by the window. */
export class SettingsEditorControlServices extends Disposable {
	constructor(
		services: ServiceCollection,
		instantiation: IInstantiationService,
		bindings: SettingsEditorControlBindings
	) {
		super();
		try {
			services.set(IStorageService, bindings.storage);
			services.set(ILabelService, this._register(instantiation.createInstance(LabelService)));
			services.set(IProductService, { ...product, _serviceBrand: undefined });
			services.set(IEditorRuntimeEnvironment, {
				_serviceBrand: undefined,
				isDevelopment: bindings.isDevelopment
			});
			services.set(IEditorProgressService, bindings.progress);
			services.set(IEditorWindowHost, bindings.windowHost);
			services.set(IMenuService, this._register(instantiation.createInstance(MenuService)));
			services.set(
				IContextViewService,
				this._register(instantiation.createInstance(ContextViewService))
			);
			services.set(
				IContextMenuService,
				this._register(bindings.createContextMenu(instantiation))
			);
			const hover = this._register(instantiation.createInstance(HoverService));
			services.set(IHoverService, hover);
			// Workbench startup binds base controls before constructing any parts.
			this._register(
				setHoverDelegateFactory((placement, enableInstantHover) => {
					const delegate = instantiation.createInstance(
						WorkbenchHoverDelegate,
						placement,
						{ instantHover: enableInstantHover },
						{}
					);
					// Instant delegates belong to their source toolbar/action-bar owner.
					// Only cached default delegates live for the whole service graph.
					return enableInstantHover ? delegate : this._register(delegate);
				})
			);
			this._register(setBaseLayerHoverDelegate(hover));
			services.set(IOpenerService, this._register(bindings.createOpener(instantiation)));
			services.set(
				IMarkdownRendererService,
				instantiation.createInstance(MarkdownRendererService)
			);
			this._register(instantiation.createInstance(DialogHandlerContribution));
			services.set(IListService, this._register(new ListService()));
			services.set(IEditorCancellationTokens, new EditorCancellationTokens());
			services.set(
				ISemanticTokensStylingService,
				this._register(instantiation.createInstance(SemanticTokensStylingService))
			);
			services.set(
				ILanguageFeatureDebounceService,
				instantiation.createInstance(LanguageFeatureDebounceService)
			);
			services.set(
				ISuggestMemoryService,
				this._register(instantiation.createInstance(SuggestMemoryService))
			);
			services.set(
				IAccessibilitySignalService,
				this._register(instantiation.createInstance(AccessibilitySignalService))
			);
			services.set(
				IBulkEditService,
				this._register(instantiation.createInstance(BulkEditService))
			);
			services.set(
				IActionWidgetService,
				this._register(instantiation.createInstance(ActionWidgetService))
			);
		} catch (error) {
			this.dispose();
			throw error;
		}
	}
}
