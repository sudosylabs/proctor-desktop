import { ThemeTypeSelector } from '../../../../platform/theme/common/theme.js';
import { IListService, ListService } from '../../../../platform/list/browser/listService.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import type { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import {
	IThemeService,
	getThemeTypeSelector
} from '../../../../platform/theme/common/themeService.js';
import {
	BROWSER_THEME_SERVICE,
	type BrowserThemeService
} from '../../../../platform/theme/browser/themeService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	IStorageService,
	InMemoryStorageService
} from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import {
	IContextMenuService,
	IContextViewService
} from '../../../../platform/contextview/browser/contextView.js';
import { ContextMenuService } from '../../../../platform/contextview/browser/contextMenuService.js';
import { ContextViewService } from '../../../../platform/contextview/browser/contextViewService.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { MenuService } from '../../../../platform/actions/common/menuService.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { AccessibilityService } from '../../../../platform/accessibility/browser/accessibilityService.js';
import { IHoverService, WorkbenchHoverDelegate } from '../../../../platform/hover/browser/hover.js';
import { HoverService } from '../../../../platform/hover/browser/hoverService.js';
import { QuickInputService } from '../../../services/quickinput/browser/quickInputService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { setHoverDelegateFactory } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { setBaseLayerHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegate2.js';
import {
	IMarkdownRendererService,
	MarkdownRendererService
} from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { OpenerService } from '../../../../editor/browser/services/openerService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { CodeEditorService } from '../../../services/editor/browser/codeEditorService.js';
import { EditorThemeService } from '../../../services/editor/browser/editorThemeService.js';
import { EditorWorkbenchLayoutService } from '../../../services/layout/browser/editorWorkbenchLayoutService.js';
import { IEditorWorkbenchLayoutService } from '../../../services/layout/browser/editorWorkbenchLayout.js';
import { Position } from '../../../services/layout/browser/layoutService.js';
import { ModernUIContribution } from '../../modernUI/browser/modernUI.contribution.js';
import { SettingsEditorConfiguration } from '../../../services/settings/common/settingsEditorConfiguration.js';
import {
	WORKBENCH_INSTANTIATION_SERVICE,
	WORKBENCH_SERVICE_COLLECTION
} from '../../../common/serviceIds.js';
import { WORKBENCH_NOTIFICATION_SERVICE } from '../../../browser/parts/notifications/notifications.js';
import type { WorkbenchBootstrapContext } from '../../../browser/bootstrap.js';

/** Source controls shared by the authenticated titlebar, layout picker and account menu. */
export const AUTHENTICATED_WINDOW_CONTROLS_SERVICE = 'prctr.authenticated.windowControls';

export class AuthenticatedWindowControls extends Disposable {
	readonly input: QuickInputService;
	readonly hover: IHoverService;
	readonly contextMenu: IContextMenuService;
	readonly contextView: IContextViewService;
	readonly ready: Promise<void>;
	constructor(context: WorkbenchBootstrapContext) {
		super();
		const services = new ServiceCollection();
		const parent = context.getService<IInstantiationService>(WORKBENCH_INSTANTIATION_SERVICE);
		const instantiation = this._register(parent.createChild(services));
		const configuration = this._register(new SettingsEditorConfiguration('{}'));
		this.ready = configuration.initialize();
		services.set(IConfigurationService, configuration);
		services.set(
			IThemeService,
			this._register(
				new EditorThemeService(
					context.getService<BrowserThemeService>(BROWSER_THEME_SERVICE),
					context.document
				)
			)
		);
		const presentation = context.getService<BrowserThemeService>(BROWSER_THEME_SERVICE);
		const root = context.shell.element;
		const hadWorkbenchClass = root.classList.contains('monaco-workbench');
		root.classList.add('monaco-workbench');
		const updateTheme = (): void => {
			for (const name of Object.values(ThemeTypeSelector))
				root.classList.toggle(
					name,
					name === getThemeTypeSelector(presentation.theme.colorTheme.type)
				);
			root.classList.toggle(
				'monaco-enable-motion',
				presentation.presentationPreferences.motion === 'full'
			);
		};
		updateTheme();
		this._register(presentation.onDidChangeTheme(updateTheme));
		this._register(presentation.onDidChangePresentation(updateTheme));
		this._register(
			toDisposable(() => {
				root.classList.remove(...Object.values(ThemeTypeSelector), 'monaco-enable-motion');
				root.classList.toggle('monaco-workbench', hadWorkbenchClass);
			})
		);
		const layout = this._register(
			new EditorWorkbenchLayoutService(
				context.shell.element,
				{
					parts: new Map(),
					onDidChangePresentation: presentation.onDidChangePresentation,
					readOffset: () => ({
						top: context.shell.part('titlebar').clientHeight,
						quickPickTop: context.shell.part('titlebar').clientHeight
					}),
					focusContent: () => context.shell.focusVisiblePart(['content']),
					isRestored: () => true,
					readPresentation: () => ({
						floating: true,
						compact: presentation.presentationPreferences.density === 'compact',
						uppercaseHeaders: false
					}),
					relayout: () => context.shell.layout(),
					readPositions: () => ({
						sidebar:
							context.shell.primarySide === 'left' ? Position.LEFT : Position.RIGHT,
						panel: Position.BOTTOM,
						panelAlignment: 'center'
					}),
					setPartHidden() {
						throw new Error('Quick Input does not own shell visibility.');
					}
				},
				context.document.fonts.ready.then(() => undefined)
			)
		);
		services.set(ILayoutService, layout);
		services.set(IEditorWorkbenchLayoutService, layout);
		this._register(instantiation.createInstance(ModernUIContribution));
		services.set(IListService, this._register(new ListService()));
		services.set(IStorageService, this._register(new InMemoryStorageService()));
		services.set(ITelemetryService, NullTelemetryService);
		services.set(
			INotificationService,
			context.getService<INotificationService>(WORKBENCH_NOTIFICATION_SERVICE)
		);
		services.set(IMenuService, this._register(instantiation.createInstance(MenuService)));
		this.contextView = this._register(instantiation.createInstance(ContextViewService));
		services.set(IContextViewService, this.contextView);
		this.contextMenu = this._register(instantiation.createInstance(ContextMenuService));
		services.set(IContextMenuService, this.contextMenu);
		services.set(
			IAccessibilityService,
			this._register(instantiation.createInstance(AccessibilityService))
		);
		services.set(
			ICodeEditorService,
			this._register(instantiation.createInstance(CodeEditorService))
		);
		const opener = this._register(instantiation.createInstance(OpenerService));
		// Layout labels are application-owned text, never navigation or command links.
		this._register(opener.registerValidator({ shouldOpen: async () => false }));
		services.set(IOpenerService, opener);
		services.set(
			IMarkdownRendererService,
			instantiation.createInstance(MarkdownRendererService)
		);
		this.hover = this._register(instantiation.createInstance(HoverService));
		services.set(IHoverService, this.hover);
		this._register(
			setHoverDelegateFactory((placement, enableInstantHover) => {
				const delegate = instantiation.createInstance(
					WorkbenchHoverDelegate,
					placement,
					{ instantHover: enableInstantHover },
					{}
				);
				return enableInstantHover ? delegate : this._register(delegate);
			})
		);
		this._register(setBaseLayerHoverDelegate(this.hover));
		this.input = this._register(instantiation.createInstance(QuickInputService));
		services.set(IQuickInputService, this.input);
		const windowServices = context.getService<ServiceCollection>(WORKBENCH_SERVICE_COLLECTION);
		if (!windowServices.has(IQuickInputService))
			windowServices.set(IQuickInputService, this.input);
		let previous = windowServices.get(IQuickInputService);
		// Source keyboard commands execute in the window graph. Route them to the
		// visible picker, then return ownership to Settings when it has a controller.
		this._register(
			this.input.onShow(() => {
				previous = windowServices.get(IQuickInputService);
				windowServices.set(IQuickInputService, this.input);
			})
		);
		this._register(
			this.input.onHide(() => {
				if (windowServices.get(IQuickInputService) === this.input)
					windowServices.set(IQuickInputService, previous);
			})
		);
	}
}
