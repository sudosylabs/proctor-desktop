import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import { InstantiationService } from '../../../src/prctr/platform/instantiation/common/instantiationService.ts';
import { ServiceCollection } from '../../../src/prctr/platform/instantiation/common/serviceCollection.ts';
import { IConfigurationService } from '../../../src/prctr/platform/configuration/common/configuration.ts';
import { ContextKeyService } from '../../../src/prctr/platform/contextkey/browser/contextKeyService.ts';
import { IContextKeyService } from '../../../src/prctr/platform/contextkey/common/contextkey.ts';
import { ILayoutService } from '../../../src/prctr/platform/layout/browser/layoutService.ts';
import { IThemeService } from '../../../src/prctr/platform/theme/common/themeService.ts';
import { BrowserThemeService } from '../../../src/prctr/platform/theme/browser/themeService.ts';
import { EditorThemeService } from '../../../src/prctr/workbench/services/editor/browser/editorThemeService.ts';
import { EditorLayoutService } from '../../../src/prctr/workbench/services/editor/browser/editorLayoutService.ts';
import { CommandService } from '../../../src/prctr/workbench/services/commands/common/commandService.ts';
import { ICommandService } from '../../../src/prctr/platform/commands/common/commands.ts';
import { BrowserKeybindingService, WorkbenchKeybindingFeedbackService } from '../../../src/prctr/workbench/services/keybinding/browser/browserKeybindingService.ts';
import { IKeybindingService } from '../../../src/prctr/platform/keybinding/common/keybinding.ts';
import { AccessibilityService } from '../../../src/prctr/platform/accessibility/browser/accessibilityService.ts';
import { IAccessibilityService } from '../../../src/prctr/platform/accessibility/common/accessibility.ts';
import { UserInteractionService } from '../../../src/prctr/platform/userInteraction/browser/userInteractionServiceImpl.ts';
import { IUserInteractionService } from '../../../src/prctr/platform/userInteraction/browser/userInteractionService.ts';
import { NotificationService } from '../../../src/prctr/workbench/services/notification/common/notificationService.ts';
import { NotificationStorage } from '../../../src/prctr/workbench/services/notification/common/notificationStorage.ts';
import { INotificationService } from '../../../src/prctr/platform/notification/common/notification.ts';
import { DialogService } from '../../../src/prctr/workbench/services/dialogs/common/dialogService.ts';
import { IDialogService } from '../../../src/prctr/platform/dialogs/common/dialogs.ts';
import { ILogService, NullLogService } from '../../../src/prctr/platform/log/common/log.ts';
import { IUndoRedoService } from '../../../src/prctr/platform/undoRedo/common/undoRedo.ts';
import { UndoRedoService } from '../../../src/prctr/platform/undoRedo/common/undoRedoService.ts';
import { LanguageService } from '../../../src/prctr/editor/common/services/languageService.ts';
import { ILanguageService } from '../../../src/prctr/editor/common/languages/language.ts';
import { ILanguageConfigurationService, LanguageConfigurationService } from '../../../src/prctr/editor/common/languages/languageConfigurationRegistry.ts';
import { LanguageFeaturesService } from '../../../src/prctr/editor/common/services/languageFeaturesService.ts';
import { ILanguageFeaturesService } from '../../../src/prctr/editor/common/services/languageFeatures.ts';
import { IModelService } from '../../../src/prctr/editor/common/services/model.ts';
import { ModelService } from '../../../src/prctr/editor/common/services/modelService.ts';
import { ITextResourcePropertiesService } from '../../../src/prctr/editor/common/services/textResourceConfiguration.ts';
import { TextResourcePropertiesService } from '../../../src/prctr/workbench/services/textresourceProperties/common/textResourcePropertiesService.ts';
import { ITreeSitterLibraryService } from '../../../src/prctr/editor/common/services/treeSitter/treeSitterLibraryService.ts';
import { TreeSitterLibraryService } from '../../../src/prctr/workbench/services/treeSitter/browser/treeSitterLibraryService.ts';
import { PackagedTreeSitterAssets } from '../../../src/prctr/workbench/services/treeSitter/browser/packagedTreeSitterAssets.ts';
import { ITreeSitterAssets } from '../../../src/prctr/workbench/services/treeSitter/browser/treeSitterAssets.ts';
import { ICodeEditorService } from '../../../src/prctr/editor/browser/services/codeEditorService.ts';
import { CodeEditorService } from '../../../src/prctr/workbench/services/editor/browser/codeEditorService.ts';
import { ISettingsEditorConfiguration, SettingsEditorConfiguration } from '../../../src/prctr/workbench/services/settings/common/settingsEditorConfiguration.ts';


export async function createEditorTestServices(source: string) {
	const store = new DisposableStore();
	const host = document.createElement('div');
	host.style.width = '600px'; host.style.height = '360px';
	document.body.appendChild(host);
	store.add({ dispose: () => host.remove() });
	try {
			const configuration = store.add(new SettingsEditorConfiguration(source));
			await configuration.initialize();
			const services = new ServiceCollection();
			const instantiation = store.add(new InstantiationService(services, true));
			services.set(IConfigurationService, configuration);
			services.set(ISettingsEditorConfiguration, configuration);
			const context = store.add(new ContextKeyService()); services.set(IContextKeyService, context);
			const layout = store.add(new EditorLayoutService(host, () => ({ top: 0, quickPickTop: 0 }), () => host.focus(), Promise.resolve())); services.set(ILayoutService, layout);
			const presentation = store.add(new BrowserThemeService(document, 'dark', { density: 'default', motion: 'full', transparency: 'full' }));
			services.set(IThemeService, store.add(new EditorThemeService(presentation, document)));
			services.set(ILogService, new NullLogService());
			const commands = store.add(new CommandService(instantiation)); services.set(ICommandService, commands);
			const feedback = host.appendChild(document.createElement('span'));
			services.set(IKeybindingService, store.add(new BrowserKeybindingService(document, context, commands, new WorkbenchKeybindingFeedbackService(feedback))));
			services.set(IAccessibilityService, store.add(instantiation.createInstance(AccessibilityService)));
			services.set(IUserInteractionService, new UserInteractionService());
			services.set(INotificationService, store.add(new NotificationService(new NotificationStorage())));
			services.set(IDialogService, store.add(new DialogService()));
			services.set(IUndoRedoService, instantiation.createInstance(UndoRedoService));
			const languages = store.add(new LanguageService()); services.set(ILanguageService, languages);
			store.add(languages.registerLanguage({ id: 'jsonc', aliases: ['JSON with Comments'] }));
			services.set(ILanguageConfigurationService, store.add(instantiation.createInstance(LanguageConfigurationService)));
			services.set(ILanguageFeaturesService, new LanguageFeaturesService());
			services.set(ITextResourcePropertiesService, instantiation.createInstance(TextResourcePropertiesService));
			services.set(ITreeSitterAssets, new PackagedTreeSitterAssets());
			services.set(ITreeSitterLibraryService, store.add(instantiation.createInstance(TreeSitterLibraryService)));
			const models = store.add(instantiation.createInstance(ModelService)); services.set(IModelService, models);
			const editors = store.add(instantiation.createInstance(CodeEditorService)); services.set(ICodeEditorService, editors);

		return { store, host, configuration, services, instantiation, models, editors, languages, presentation };
	} catch (error) { store.dispose(); throw error; }
}

import { IContextMenuService, IContextViewService } from '../../../src/prctr/platform/contextview/browser/contextView.ts';
import { ContextViewService } from '../../../src/prctr/platform/contextview/browser/contextViewService.ts';
import { ContextMenuService } from '../../../src/prctr/platform/contextview/browser/contextMenuService.ts';
import { IMenuService } from '../../../src/prctr/platform/actions/common/actions.ts';
import { MenuService } from '../../../src/prctr/platform/actions/common/menuService.ts';
import { InMemoryStorageService, IStorageService } from '../../../src/prctr/platform/storage/common/storage.ts';
import { ITelemetryService } from '../../../src/prctr/platform/telemetry/common/telemetry.ts';
import { NullTelemetryService } from '../../../src/prctr/platform/telemetry/common/telemetryUtils.ts';
import { IProductService } from '../../../src/prctr/platform/product/common/productService.ts';
import product from '../../../src/prctr/platform/product/common/product.ts';
import { HoverService } from '../../../src/prctr/platform/hover/browser/hoverService.ts';
import { IHoverService } from '../../../src/prctr/platform/hover/browser/hover.ts';
import { IOpenerService } from '../../../src/prctr/platform/opener/common/opener.ts';
import { OpenerService } from '../../../src/prctr/editor/browser/services/openerService.ts';
import { IMarkdownRendererService, MarkdownRendererService } from '../../../src/prctr/platform/markdown/browser/markdownRenderer.ts';
import { IClipboardService } from '../../../src/prctr/platform/clipboard/common/clipboardService.ts';
import { BrowserClipboardService } from '../../../src/prctr/platform/clipboard/browser/clipboardService.ts';
import { IListService, ListService } from '../../../src/prctr/platform/list/browser/listService.ts';

/** Real browser host implementations; native transport is tested separately in Electron composition. */
export function installSettingsControlTestServices(f: Awaited<ReturnType<typeof createEditorTestServices>>): void {
	f.services.set(ITelemetryService, NullTelemetryService);
	f.services.set(IProductService, { ...product, _serviceBrand: undefined });
	f.services.set(IStorageService, f.store.add(new InMemoryStorageService()));
	f.services.set(IMenuService, f.store.add(f.instantiation.createInstance(MenuService)));
	f.services.set(IContextViewService, f.store.add(f.instantiation.createInstance(ContextViewService)));
	f.services.set(IContextMenuService, f.store.add(f.instantiation.createInstance(ContextMenuService)));
	f.services.set(IHoverService, f.store.add(f.instantiation.createInstance(HoverService)));
	f.services.set(IOpenerService, f.store.add(f.instantiation.createInstance(OpenerService)));
	f.services.set(IMarkdownRendererService, f.instantiation.createInstance(MarkdownRendererService));
	f.services.set(IClipboardService, f.store.add(f.instantiation.createInstance(BrowserClipboardService)));
	f.services.set(IListService, f.store.add(new ListService()));
}
