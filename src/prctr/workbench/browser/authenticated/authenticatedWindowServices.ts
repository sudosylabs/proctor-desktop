/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { setHoverDelegateFactory } from '../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { setBaseLayerHoverDelegate } from '../../../base/browser/ui/hover/hoverDelegate2.js';
import { toDisposable, type DisposableStore } from '../../../base/common/lifecycle.js';
import { OpenerService } from '../../../editor/browser/services/openerService.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { IAccessibilityService } from '../../../platform/accessibility/common/accessibility.js';
import { AccessibilityService } from '../../../platform/accessibility/browser/accessibilityService.js';
import { IMenuService } from '../../../platform/actions/common/actions.js';
import { MenuService } from '../../../platform/actions/common/menuService.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import {
	IContextMenuService,
	IContextViewService
} from '../../../platform/contextview/browser/contextView.js';
import { ContextMenuService } from '../../../platform/contextview/browser/contextMenuService.js';
import { ContextViewService } from '../../../platform/contextview/browser/contextViewService.js';
import { IHoverService, WorkbenchHoverDelegate } from '../../../platform/hover/browser/hover.js';
import { HoverService } from '../../../platform/hover/browser/hoverService.js';
import type { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import type { ServiceCollection } from '../../../platform/instantiation/common/serviceCollection.js';
import { ILayoutService } from '../../../platform/layout/browser/layoutService.js';
import { IListService, ListService } from '../../../platform/list/browser/listService.js';
import {
	IMarkdownRendererService,
	MarkdownRendererService
} from '../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../platform/quickinput/common/quickInput.js';
import {
	IStorageService,
	InMemoryStorageService
} from '../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../platform/telemetry/common/telemetryUtils.js';
import { IBrowserThemeService } from '../../../platform/theme/browser/themeService.js';
import { ThemeTypeSelector } from '../../../platform/theme/common/theme.js';
import {
	IThemeService,
	getThemeTypeSelector
} from '../../../platform/theme/common/themeService.js';
import { IWorkbenchShellService, IWorkbenchWindowService } from '../workbenchServices.js';
import { CodeEditorService } from '../../services/editor/browser/codeEditorService.js';
import { EditorThemeService } from '../../services/editor/browser/editorThemeService.js';
import { IEditorWorkbenchLayoutService } from '../../services/layout/browser/editorWorkbenchLayout.js';
import { EditorWorkbenchLayoutService } from '../../services/layout/browser/editorWorkbenchLayoutService.js';
import { Position } from '../../services/layout/browser/layoutService.js';
import { QuickInputService } from '../../services/quickinput/browser/quickInputService.js';
import { SettingsEditorConfiguration } from '../../services/settings/common/settingsEditorConfiguration.js';
import { ModernUIContribution } from '../../contrib/modernUI/browser/modernUI.contribution.js';
import { AuthenticatedHoverService, IAuthenticatedHoverService } from './authenticatedHover.js';

/**
 * Adds the source controls AuthenticatedWindow's frame and pages share to the window's
 * services: theme and configuration for the ported widgets, hovers, menus, context views
 * and quick input. The window's commands resolve the same services.
 */
export async function installAuthenticatedWindowServices(
	services: ServiceCollection,
	instantiationService: IInstantiationService,
	disposables: DisposableStore
): Promise<void> {
	const [presentation, shell, { document }] = instantiationService.invokeFunction(
		(accessor) =>
			[
				accessor.get(IBrowserThemeService),
				accessor.get(IWorkbenchShellService),
				accessor.get(IWorkbenchWindowService)
			] as const
	);
	const configuration = disposables.add(new SettingsEditorConfiguration('{}'));
	services.set(IConfigurationService, configuration);
	services.set(IThemeService, disposables.add(new EditorThemeService(presentation, document)));
	applyWorkbenchThemeClasses(shell.element, presentation, disposables);
	const layout = disposables.add(
		new EditorWorkbenchLayoutService(
			shell.element,
			{
				parts: new Map(),
				onDidChangePresentation: presentation.onDidChangePresentation,
				readOffset: () => ({
					top: shell.part('titlebar').clientHeight,
					quickPickTop: shell.part('titlebar').clientHeight
				}),
				focusContent: () => shell.focusVisiblePart(['content']),
				isRestored: () => true,
				readPresentation: () => ({
					floating: true,
					compact: presentation.presentationPreferences.density === 'compact',
					uppercaseHeaders: false
				}),
				relayout: () => shell.layout(),
				readPositions: () => ({
					sidebar: Position.LEFT,
					panel: Position.BOTTOM,
					panelAlignment: 'center'
				}),
				setPartHidden() {
					throw new Error('Quick Input does not own shell visibility.');
				}
			},
			document.fonts.ready.then(() => undefined)
		)
	);
	services.set(ILayoutService, layout);
	services.set(IEditorWorkbenchLayoutService, layout);
	disposables.add(instantiationService.createInstance(ModernUIContribution));
	services.set(IListService, disposables.add(new ListService()));
	services.set(IStorageService, disposables.add(new InMemoryStorageService()));
	services.set(ITelemetryService, NullTelemetryService);
	services.set(IMenuService, disposables.add(instantiationService.createInstance(MenuService)));
	services.set(
		IContextViewService,
		disposables.add(instantiationService.createInstance(ContextViewService))
	);
	services.set(
		IContextMenuService,
		disposables.add(instantiationService.createInstance(ContextMenuService))
	);
	services.set(
		IAccessibilityService,
		disposables.add(instantiationService.createInstance(AccessibilityService))
	);
	services.set(
		ICodeEditorService,
		disposables.add(instantiationService.createInstance(CodeEditorService))
	);
	const opener = disposables.add(instantiationService.createInstance(OpenerService));
	// Layout labels are application-owned text, never navigation or command links.
	disposables.add(opener.registerValidator({ shouldOpen: async () => false }));
	services.set(IOpenerService, opener);
	services.set(
		IMarkdownRendererService,
		instantiationService.createInstance(MarkdownRendererService)
	);
	const hover = disposables.add(instantiationService.createInstance(HoverService));
	services.set(IHoverService, hover);
	disposables.add(
		setHoverDelegateFactory((placement, enableInstantHover) => {
			const delegate = instantiationService.createInstance(
				WorkbenchHoverDelegate,
				placement,
				{ instantHover: enableInstantHover },
				{}
			);
			return enableInstantHover ? delegate : disposables.add(delegate);
		})
	);
	disposables.add(setBaseLayerHoverDelegate(hover));
	services.set(
		IQuickInputService,
		disposables.add(instantiationService.createInstance(QuickInputService))
	);
	services.set(
		IAuthenticatedHoverService,
		instantiationService.createInstance(AuthenticatedHoverService)
	);
	await configuration.initialize();
}

/** The ported widgets style themselves from the workbench root's theme and motion classes. */
function applyWorkbenchThemeClasses(
	root: HTMLElement,
	presentation: IBrowserThemeService,
	disposables: DisposableStore
): void {
	const hadWorkbenchClass = root.classList.contains('monaco-workbench');
	root.classList.add('monaco-workbench');
	const update = (): void => {
		for (const name of Object.values(ThemeTypeSelector)) {
			root.classList.toggle(
				name,
				name === getThemeTypeSelector(presentation.theme.colorTheme.type)
			);
		}
		root.classList.toggle(
			'monaco-enable-motion',
			presentation.presentationPreferences.motion === 'full'
		);
	};
	update();
	disposables.add(presentation.onDidChangeTheme(update));
	disposables.add(presentation.onDidChangePresentation(update));
	disposables.add(
		toDisposable(() => {
			root.classList.remove(...Object.values(ThemeTypeSelector), 'monaco-enable-motion');
			root.classList.toggle('monaco-workbench', hadWorkbenchClass);
		})
	);
}
