/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../base/browser/dom.js';
import { KeyCode, KeyMod } from '../../base/common/keyCodes.js';
import { defineMessage } from '../../base/common/localization.js';
import { Disposable, type DisposableStore } from '../../base/common/lifecycle.js';
import { MenuId, type Menu, type ResolvedMenuAction } from '../../platform/actions/common/menu.js';
import { MenuService } from '../../platform/actions/common/contributionMenuService.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import { ContextKeyService } from '../../platform/contextkey/browser/contextKeyService.js';
import {
	IContextKeyService,
	type IContextKey
} from '../../platform/contextkey/common/contextkey.js';
import type { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import type { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../platform/keybinding/common/keybinding.js';
import { KeybindingWeight } from '../../platform/keybinding/common/keybindingsRegistry.js';
import { IBrowserThemeService } from '../../platform/theme/browser/themeService.js';
import { WorkbenchContentModel } from '../common/contentGroups.js';
import {
	CandidateInteractionAllowedContext,
	WorkbenchDirectionContext,
	WorkbenchFocusedPartContext,
	WorkbenchHighContrastContext,
	WorkbenchLifecyclePhaseContext,
	WorkbenchModalContext,
	WorkbenchReducedMotionContext,
	WorkbenchWindowKindContext,
	type WorkbenchPartId
} from '../common/contextKeys.js';
import { IWorkbenchLifecycleService } from '../common/lifecycle.js';
import { registerProctorAction } from '../services/actions/common/proctorActions.js';
import { CommandService } from '../services/commands/common/commandService.js';
import {
	BrowserKeybindingService,
	WorkbenchKeybindingFeedbackService
} from '../services/keybinding/browser/browserKeybindingService.js';
import { ILocalizationService } from '../services/localization/common/localization.js';
import { WorkbenchPaneHost } from './paneHost.js';
import { WorkbenchItemResolverRegistry } from './workbenchPane.js';
import {
	IWorkbenchItemResolverService,
	IWorkbenchPaneHostService,
	IWorkbenchShellService,
	IWorkbenchWindowService
} from './workbenchServices.js';
import type { WorkbenchShell } from './workbenchShell.js';

export const RESET_LAYOUT_COMMAND_ID = 'prctr.workbench.resetLayout';
export const WORKBENCH_RESET_LAYOUT_MESSAGE = defineMessage({
	id: 'workbench.layout.reset',
	defaultMessage: 'Reset layout',
	description: 'Button that restores composition default region sizes.'
});

/**
 * Adds the services every workbench window shares: context keys, commands, keybindings,
 * item resolvers and the content area's pane host.
 */
export function createWorkbenchKernelServices(
	services: ServiceCollection,
	instantiationService: IInstantiationService,
	disposables: DisposableStore
): void {
	const [shell, { document, composition }] = instantiationService.invokeFunction(
		(accessor) =>
			[accessor.get(IWorkbenchShellService), accessor.get(IWorkbenchWindowService)] as const
	);
	const contextKeyService = disposables.add(new ContextKeyService());
	services.set(IContextKeyService, contextKeyService);
	const commandService = disposables.add(new CommandService(instantiationService));
	services.set(ICommandService, commandService);
	const feedbackElement = document.createElement('span');
	feedbackElement.className = 'prctr-workbench__keybinding-feedback';
	feedbackElement.role = 'status';
	shell
		.part(composition.windowKind === 'authenticated' ? 'titlebar' : 'status')
		.append(feedbackElement);
	disposables.add({ dispose: () => feedbackElement.remove() });
	const keybindingService = disposables.add(
		new BrowserKeybindingService(
			document,
			contextKeyService,
			commandService,
			new WorkbenchKeybindingFeedbackService(feedbackElement)
		)
	);
	services.set(IKeybindingService, keybindingService);
	const resolvers = new WorkbenchItemResolverRegistry();
	services.set(IWorkbenchItemResolverService, resolvers);
	services.set(
		IWorkbenchPaneHostService,
		disposables.add(new WorkbenchPaneHost(shell.part('content'), resolvers))
	);
}

/**
 * Binds the window's live context keys, tracks the focused part, and offers Reset layout
 * through the same menu and keybinding path as every other command.
 */
export class WorkbenchKernelContribution extends Disposable {
	private readonly keys: BoundWorkbenchContextKeys;

	constructor(
		@IWorkbenchWindowService private readonly window: IWorkbenchWindowService,
		@IWorkbenchShellService private readonly shell: IWorkbenchShellService,
		@ILocalizationService localization: ILocalizationService,
		@IBrowserThemeService private readonly themeService: IBrowserThemeService,
		@IWorkbenchLifecycleService lifecycle: IWorkbenchLifecycleService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super();
		const composition = window.composition;
		this._register(
			new WorkbenchContentModel(
				composition.layout.maxContentGroups,
				new Set([
					...(composition.layout.allowHorizontalSplit ? ['horizontal' as const] : []),
					...(composition.layout.allowVerticalSplit ? ['vertical' as const] : [])
				])
			)
		);
		this.keys = bindWorkbenchContextKeys(contextKeyService);
		this.keys.windowKind.set(composition.windowKind);
		this.keys.lifecyclePhase.set(lifecycle.phase ?? 'starting');
		this.keys.direction.set(localization.direction);
		this.keys.modal.set(shell.overlayHost.visible);
		this.updatePresentationKeys();
		this.updateFocusedPart();
		this._register(lifecycle.onDidAdvancePhase((phase) => this.keys.lifecyclePhase.set(phase)));
		this.registerListeners();
		this.registerResetLayout(new MenuService(commandService, localization));
		shell.layout();
	}

	private registerListeners(): void {
		this._register(
			this.shell.overlayHost.onDidChangeVisibility((visible) => this.keys.modal.set(visible))
		);
		this._register(this.themeService.onDidChangeTheme(() => this.updatePresentationKeys()));
		this._register(
			this.themeService.onDidChangePresentation(() => this.updatePresentationKeys())
		);
		this._register(
			addDisposableListener(
				this.window.document,
				'focusin',
				(event) => this.updateFocusedPart(event.target),
				true
			)
		);
		this._register(
			addDisposableListener(
				this.window.document,
				'focusout',
				() => queueMicrotask(() => this.updateFocusedPart()),
				true
			)
		);
	}

	private registerResetLayout(menuService: MenuService): void {
		this._register(menuService);
		this._register(
			registerProctorAction({
				command: {
					id: RESET_LAYOUT_COMMAND_ID,
					title: WORKBENCH_RESET_LAYOUT_MESSAGE,
					precondition: WorkbenchModalContext.toNegated()
				},
				handler: () => this.shell.resetLayout(),
				commandPalette: true,
				menus: [{ id: MenuId.WorkbenchTitle, group: 'navigation', order: 10 }],
				keybindings: [
					{
						primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Digit0,
						weight: KeybindingWeight.WorkbenchContrib,
						when: WorkbenchModalContext.toNegated()
					}
				]
			})
		);
		const titleMenu = this._register(
			menuService.createMenu(MenuId.WorkbenchTitle, this.contextKeyService)
		);
		const updateResetAction = (): void => {
			const action = findAction(titleMenu, RESET_LAYOUT_COMMAND_ID);
			this.shell.setResetLayoutAction(async () => {
				await action?.run();
			}, action?.enabled === true);
		};
		updateResetAction();
		this._register(titleMenu.onDidChange(updateResetAction));
		// Modal gating remains synchronous; ordinary menu invalidation is deliberately batched.
		const modalKeys = new Set([WorkbenchModalContext.key]);
		this._register(
			this.contextKeyService.onDidChangeContext((event) => {
				if (event.affectsSome(modalKeys)) {
					updateResetAction();
				}
			})
		);
	}

	private updatePresentationKeys(): void {
		this.keys.highContrast.set(
			this.themeService.forcedColorsActive || this.themeService.theme.isHighContrast
		);
		this.keys.reducedMotion.set(this.themeService.reducedMotionActive);
	}

	private updateFocusedPart(
		target: EventTarget | null = this.window.document.activeElement
	): void {
		this.keys.focusedPart.set(focusedPart(this.window.document, this.shell, target));
	}
}

interface BoundWorkbenchContextKeys {
	readonly windowKind: IContextKey<'launch' | 'authenticated' | 'candidate'>;
	readonly lifecyclePhase: IContextKey<'starting' | 'ready' | 'restored' | 'eventually'>;
	readonly focusedPart: IContextKey<WorkbenchPartId | ''>;
	readonly modal: IContextKey<boolean>;
	readonly candidateInteractionAllowed: IContextKey<boolean>;
	readonly highContrast: IContextKey<boolean>;
	readonly reducedMotion: IContextKey<boolean>;
	readonly direction: IContextKey<'ltr' | 'rtl'>;
}
function bindWorkbenchContextKeys(service: IContextKeyService): BoundWorkbenchContextKeys {
	return Object.freeze({
		windowKind: WorkbenchWindowKindContext.bindTo(service),
		lifecyclePhase: WorkbenchLifecyclePhaseContext.bindTo(service),
		focusedPart: WorkbenchFocusedPartContext.bindTo(service),
		modal: WorkbenchModalContext.bindTo(service),
		candidateInteractionAllowed: CandidateInteractionAllowedContext.bindTo(service),
		highContrast: WorkbenchHighContrastContext.bindTo(service),
		reducedMotion: WorkbenchReducedMotionContext.bindTo(service),
		direction: WorkbenchDirectionContext.bindTo(service)
	});
}
function focusedPart(
	document: Document,
	shell: WorkbenchShell,
	target: EventTarget | null
): WorkbenchPartId | '' {
	const HTMLElementConstructor = document.defaultView?.HTMLElement;
	if (HTMLElementConstructor === undefined || !(target instanceof HTMLElementConstructor))
		return '';
	if (shell.overlayHost.element.contains(target)) return 'overlay';
	const part = target.closest<HTMLElement>('[data-part]')?.dataset.part;
	return isWorkbenchPart(part) ? part : '';
}
function isWorkbenchPart(value: string | undefined): value is Exclude<WorkbenchPartId, 'overlay'> {
	return (
		value !== undefined &&
		['titlebar', 'banner', 'navigation', 'sidebar', 'content', 'panel', 'status'].includes(
			value
		)
	);
}
function findAction(menu: Menu, id: string): ResolvedMenuAction | undefined {
	for (const [, actions] of menu.getActions())
		for (const action of actions)
			if (action.id === id && 'run' in action) return action as ResolvedMenuAction;
	return undefined;
}
