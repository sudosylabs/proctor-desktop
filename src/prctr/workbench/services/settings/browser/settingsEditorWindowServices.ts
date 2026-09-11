import { Disposable } from '../../../../base/common/lifecycle.js';
import { PackagedLanguageConfiguration, type ILanguageConfiguration } from './packagedLanguageConfiguration.js';
import jsonLanguageConfiguration from '../../textMate/common/json/language-configuration.json' with { type: 'json' };
import { type IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISettingsEditorConfiguration, SettingsEditorConfiguration } from '../common/settingsEditorConfiguration.js';
import { type BrowserThemeService } from '../../../../platform/theme/browser/themeService.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorThemeService, EditorThemeService } from '../../editor/browser/editorThemeService.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILogService, NullLogService } from '../../../../platform/log/common/log.js';
import { ISnippetWorkspaceContext } from '../../../../editor/common/services/snippetWorkspaceContext.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { AccessibilityService } from '../../../../platform/accessibility/browser/accessibilityService.js';
import { IUserInteractionService } from '../../../../platform/userInteraction/browser/userInteractionService.js';
import { UserInteractionService } from '../../../../platform/userInteraction/browser/userInteractionServiceImpl.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { DialogService } from '../../dialogs/common/dialogService.js';
import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { UndoRedoService } from '../../../../platform/undoRedo/common/undoRedoService.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { LanguageService } from '../../../../editor/common/services/languageService.js';
import { ILanguageConfigurationService, LanguageConfigurationService } from '../../../../editor/common/languages/languageConfigurationRegistry.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { LanguageFeaturesService } from '../../../../editor/common/services/languageFeaturesService.js';
import { ITextResourcePropertiesService, ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { TextResourcePropertiesService } from '../../textresourceProperties/common/textResourcePropertiesService.js';
import { TextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfigurationService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ModelService } from '../../../../editor/common/services/modelService.js';
import { ITreeSitterLibraryService } from '../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { TreeSitterLibraryService } from '../../treeSitter/browser/treeSitterLibraryService.js';
import { ITreeSitterAssets } from '../../treeSitter/browser/treeSitterAssets.js';
import { PackagedTreeSitterAssets } from '../../treeSitter/browser/packagedTreeSitterAssets.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { CodeEditorService } from '../../editor/browser/codeEditorService.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { MarkerService } from '../../../../platform/markers/common/markerService.js';
import { IMarkerDecorationsService } from '../../../../editor/common/services/markerDecorations.js';
import { MarkerDecorationsService } from '../../../../editor/common/services/markerDecorationsService.js';
import { IWebWorkerService } from '../../../../platform/webWorker/browser/webWorkerService.js';
import { PackagedEditorWorkerService } from '../../editor/browser/editorWorkerService.js';
import { IEditorWorkerService } from '../../../../editor/common/services/editorWorker.js';
import { EditorWorkerService } from '../../../../editor/browser/services/editorWorkerService.js';
import { ITextMateAssets, PackagedTextMateAssets } from '../../textMate/common/packagedTextMateAssets.js';
import { ITextMateTokenizationService } from '../../textMate/browser/textMateTokenizationFeature.js';
import { TextMateTokenizationFeature } from '../../textMate/browser/textMateTokenizationFeatureImpl.js';

import { TextModelResolverService } from '../../textmodelResolver/common/textModelResolverService.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { SettingsResolvedTextModel } from './settingsResolvedTextModel.js';
import { userSettingsResource } from '../../../../platform/settings/common/settingsResource.js';

import { IEditorDocumentTrust } from '../../../../editor/common/services/editorDocumentTrust.js';
import { EditorDocumentTrust } from '../../editor/browser/editorDocumentTrust.js';
export interface SettingsEditorWindowBindings {
	readonly source: string;
	readonly document: Document;
	readonly presentation: BrowserThemeService;
	readonly layout: ILayoutService;
	readonly clipboard: IClipboardService;
	readonly notifications: INotificationService;
	readonly isSettingsReadonly: () => boolean;
}

/** Window-owned editor runtime installed in the existing kernel's service graph. */
export class SettingsEditorWindowServices extends Disposable {
	readonly configuration: SettingsEditorConfiguration;
	readonly models: ModelService;
	readonly languages: LanguageService;
	readonly editors: CodeEditorService;
	private readonly theme: EditorThemeService;
	constructor(services: ServiceCollection, instantiation: IInstantiationService, bindings: SettingsEditorWindowBindings) {
		super();
		if (!services.has(ICommandService) || !services.has(IKeybindingService) || !services.has(IContextKeyService))
			throw new Error('Settings requires the existing workbench interaction services.');
		if (services.has(IModelService)) throw new Error('This window already owns an editor runtime.');
		try {
			this.configuration = this._register(new SettingsEditorConfiguration(bindings.source));
			services.set(IConfigurationService, this.configuration);
			services.set(ISettingsEditorConfiguration, this.configuration);
			const theme = this.theme = this._register(new EditorThemeService(bindings.presentation, bindings.document));
			services.set(IThemeService, theme); services.set(IEditorThemeService, theme);
			services.set(ILayoutService, bindings.layout);
			services.set(IClipboardService, bindings.clipboard);
			// Account Settings has no Attempt Workspace. Keep the original snippet
			// resolver's absent-workspace semantics without inventing a workspace service.
			services.set(ISnippetWorkspaceContext, { _serviceBrand: undefined, workspace: undefined });
			services.set(INotificationService, bindings.notifications);
			services.set(ILogService, new NullLogService()); services.set(ITelemetryService, NullTelemetryService);
			services.set(IAccessibilityService, this._register(instantiation.createInstance(AccessibilityService)));
			services.set(IUserInteractionService, new UserInteractionService());
			services.set(IDialogService, this._register(new DialogService()));
			services.set(IUndoRedoService, instantiation.createInstance(UndoRedoService));
			this.languages = this._register(new LanguageService()); services.set(ILanguageService, this.languages);
			this._register(this.languages.registerLanguage({ id: 'json', aliases: ['JSON'] }));
			this._register(this.languages.registerLanguage({ id: 'jsonc', aliases: ['JSON with Comments'] }));
			services.set(ILanguageConfigurationService, this._register(instantiation.createInstance(LanguageConfigurationService)));
			this._register(instantiation.createInstance(PackagedLanguageConfiguration, ['json', 'jsonc'], jsonLanguageConfiguration as ILanguageConfiguration));
			services.set(ILanguageFeaturesService, new LanguageFeaturesService());
			services.set(ITextResourcePropertiesService, instantiation.createInstance(TextResourcePropertiesService));
			services.set(ITreeSitterAssets, new PackagedTreeSitterAssets());
			services.set(ITreeSitterLibraryService, this._register(instantiation.createInstance(TreeSitterLibraryService)));
			this.models = this._register(instantiation.createInstance(ModelService)); services.set(IModelService, this.models);
			services.set(IEditorDocumentTrust, instantiation.createInstance(EditorDocumentTrust, [userSettingsResource]));
			services.set(ITextResourceConfigurationService, this._register(instantiation.createInstance(TextResourceConfigurationService)));
			const resolver = this._register(instantiation.createInstance(TextModelResolverService, {
				create: resource => {
					const model = resource.toString() === userSettingsResource.toString() ? this.models.getModel(resource) : null;
					if (!model) throw new Error('The requested Settings document is not open.');
					return new SettingsResolvedTextModel(model, bindings.isSettingsReadonly);
				}
			}));
			services.set(ITextModelService, resolver);
			this._register(resolver.registerTextModelContentProvider(userSettingsResource.scheme, {
				provideTextContent: async resource => resource.toString() === userSettingsResource.toString() ? this.models.getModel(resource) : null
			}));
			this.editors = this._register(instantiation.createInstance(CodeEditorService)); services.set(ICodeEditorService, this.editors);
			services.set(IMarkerService, this._register(new MarkerService()));
			services.set(IMarkerDecorationsService, this._register(instantiation.createInstance(MarkerDecorationsService)));
			services.set(IWebWorkerService, new PackagedEditorWorkerService(bindings.document));
			services.set(IEditorWorkerService, this._register(instantiation.createInstance(EditorWorkerService)));
			services.set(ITextMateAssets, new PackagedTextMateAssets());
			services.set(ITextMateTokenizationService, this._register(instantiation.createInstance(TextMateTokenizationFeature)));
		} catch (error) { this.dispose(); throw error; }
	}
	async initialize(): Promise<void> {
		await Promise.all([this.configuration.initialize(), this.theme.initialize(this.languages)]);
	}
}
