import { CodeEditorService } from '../../editor/browser/codeEditorService.js';
import { registerModalEditorCommands } from '../../../browser/parts/editor/editorCommands.js';
import { IActionViewItemService, ActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { IBreadcrumbsService, BreadcrumbsService } from '../../../browser/parts/editor/breadcrumbs.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { UriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IDecorationsService } from '../../decorations/common/decorations.js';
import { DecorationsService } from '../../decorations/browser/decorationsService.js';
import { TreeViewsDnDService } from '../../../../editor/common/services/treeViewsDnd.js';
import { ITreeViewsDnDService } from '../../../../editor/common/services/treeViewsDndService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { QuickInputService } from '../../quickinput/browser/quickInputService.js';
import { IEditorSaveConfirmation, EditorSaveConfirmation } from '../../dialogs/browser/editorSaveConfirmation.js';
import { IEditorRegistrations, EditorRegistrations } from '../../editor/common/editorRegistrations.js';
import { IEditorGroupsService } from '../../editor/common/editorGroupsService.js';
import { EditorParts } from '../../../browser/parts/editor/editorParts.js';
import { IEditorResolverService } from '../../editor/common/editorResolverService.js';
import { EditorResolverService } from '../../editor/browser/editorResolverService.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { EditorService } from '../../editor/browser/editorService.js';
import { IEditorWorkbenchLayoutService } from '../../layout/browser/editorWorkbenchLayout.js';
import { ModernUIContribution } from '../../../contrib/modernUI/browser/modernUI.contribution.js';
import { isWindows, isLinux } from '../../../../base/common/platform.js';
import { getThemeTypeSelector, IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ThemeTypeSelector } from '../../../../platform/theme/common/theme.js';

/** Original editor parts, resolver and scoped service graph for the Settings modal. */
export class SettingsEditorPartServices extends Disposable {
	// Parts release their editors while their dependent services are still live.
	private readonly editors = this._register(new DisposableStore());
	private readonly dependencies = this._register(new DisposableStore());
	readonly parts: EditorParts;
	readonly editorService: EditorService;
	readonly resolver: EditorResolverService;
	readonly registrations: EditorRegistrations;
	constructor(services: ServiceCollection, instantiation: IInstantiationService, layout: IEditorWorkbenchLayoutService, codeEditors: CodeEditorService) {
		super();
		try {
			services.set(IEditorWorkbenchLayoutService, layout);
			this.dependencies.add(registerModalEditorCommands());
			const sourceRoot = layout.mainContainer;
			const hadWorkbenchClass = sourceRoot.classList.contains('monaco-workbench');
			const hadFloatingClass = sourceRoot.classList.contains('floating-panels');
			const platformClass = isWindows ? 'windows' : isLinux ? 'linux' : 'mac';
			const theme = instantiation.invokeFunction(accessor => accessor.get(IThemeService));
			const managedClasses = [platformClass, 'chromium', 'file-icons-enabled', ...Object.values(ThemeTypeSelector)];
			const previousClasses = new Set(managedClasses.filter(value => sourceRoot.classList.contains(value)));
			sourceRoot.classList.add('monaco-workbench', platformClass, 'chromium');
			const updateTheme = (): void => {
				for (const selector of Object.values(ThemeTypeSelector)) sourceRoot.classList.toggle(selector, selector === getThemeTypeSelector(theme.getColorTheme().type));
			};
			const updateFileIcons = (): void => { sourceRoot.classList.toggle('file-icons-enabled', theme.getFileIconTheme().hasFileIcons); };
			updateTheme(); updateFileIcons();
			this.dependencies.add(theme.onDidColorThemeChange(updateTheme));
			this.dependencies.add(theme.onDidFileIconThemeChange(updateFileIcons));
			const updatePresentation = (): void => { sourceRoot.classList.toggle('floating-panels', layout.isFloatingPanelsEnabled()); };
			updatePresentation();
			this.dependencies.add(layout.onDidChangePresentation(updatePresentation));
			this.dependencies.add(toDisposable(() => {
				sourceRoot.classList.toggle('monaco-workbench', hadWorkbenchClass);
				sourceRoot.classList.toggle('floating-panels', hadFloatingClass);
				for (const value of managedClasses) sourceRoot.classList.toggle(value, previousClasses.has(value));
			}));
			this.dependencies.add(instantiation.createInstance(ModernUIContribution));
			// No disk, remote-file or arbitrary-scheme provider is installed in this graph.
			services.set(IFileService, this.dependencies.add(instantiation.createInstance(FileService)));
			services.set(IUriIdentityService, this.dependencies.add(instantiation.createInstance(UriIdentityService)));
			services.set(IDecorationsService, this.dependencies.add(instantiation.createInstance(DecorationsService)));
			services.set(ITreeViewsDnDService, new TreeViewsDnDService());
			services.set(IBreadcrumbsService, new BreadcrumbsService());
			services.set(IActionViewItemService, this.dependencies.add(new ActionViewItemService()));
			services.set(IQuickInputService, this.dependencies.add(instantiation.createInstance(QuickInputService)));
			services.set(IEditorSaveConfirmation, instantiation.createInstance(EditorSaveConfirmation));
			this.registrations = this.dependencies.add(new EditorRegistrations());
			services.set(IEditorRegistrations, this.registrations);
			this.parts = this.editors.add(instantiation.createInstance(EditorParts));
			services.set(IEditorGroupsService, this.parts);
			this.resolver = this.dependencies.add(instantiation.createInstance(EditorResolverService));
			services.set(IEditorResolverService, this.resolver);
			this.editorService = this.editors.add(instantiation.createInstance(EditorService, undefined));
			services.set(IEditorService, this.editorService);
			this.editors.add(codeEditors.bindEditorService(this.editorService));
			const main = layout.mainContainer.appendChild(layout.mainContainer.ownerDocument.createElement('div'));
			main.className = 'part editor';
			main.hidden = true;
			this.editors.add(toDisposable(() => main.remove()));
			this.editors.add(this.parts.mainPart.enforcePartOptions({ showTabs: 'none', dragToOpenWindow: false }));
			this.parts.mainPart.create(main, { restorePreviousState: false });
		} catch (error) { this.dispose(); throw error; }
	}
}
