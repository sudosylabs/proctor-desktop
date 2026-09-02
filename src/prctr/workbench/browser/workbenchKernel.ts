/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../base/browser/dom.js';
import { KeyCode, KeyMod } from '../../base/common/keyCodes.js';
import { MenuId, MenuRegistry, MenuService, type ResolvedMenuAction } from '../../platform/actions/common/menu.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import { ContextKeyService } from '../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService, type IContextKey } from '../../platform/contextkey/common/contextkey.js';
import { InstantiationService } from '../../platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../platform/keybinding/common/keybinding.js';
import { KeybindingWeight } from '../../platform/keybinding/common/keybindingsRegistry.js';
import { BROWSER_THEME_SERVICE, type BrowserThemeService } from '../../platform/theme/browser/themeService.js';
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
import { WORKBENCH_LIFECYCLE_SERVICE, type WorkbenchLifecycleService } from '../common/lifecycle.js';
import { WORKBENCH_COMMAND_SERVICE, WORKBENCH_CONTEXT_KEY_SERVICE, WORKBENCH_KEYBINDING_SERVICE, WORKBENCH_MENU_SERVICE } from '../common/serviceIds.js';
import { registerProctorAction } from '../services/actions/common/proctorActions.js';
import { CommandService } from '../services/commands/common/commandService.js';
import { BrowserKeybindingService, WorkbenchKeybindingFeedbackService } from '../services/keybinding/browser/browserKeybindingService.js';
import { WORKBENCH_RESET_LAYOUT_MESSAGE, type WorkbenchBootstrapContext } from './bootstrap.js';

export const RESET_LAYOUT_COMMAND_ID = 'prctr.workbench.resetLayout';

export function activateWorkbenchKernel(context: WorkbenchBootstrapContext): void {
	const contextKeyService = context.disposables.add(new ContextKeyService());
	const services = new ServiceCollection([IContextKeyService, contextKeyService]);
	const instantiationService = context.disposables.add(new InstantiationService(services, true));
	const commandService = context.disposables.add(new CommandService(instantiationService)); services.set(ICommandService, commandService);
	const menuService = new MenuService(commandService, context.localization); const themeService = context.getService<BrowserThemeService>(BROWSER_THEME_SERVICE); const lifecycle = context.getService<WorkbenchLifecycleService>(WORKBENCH_LIFECYCLE_SERVICE);

	const keys = bindWorkbenchContextKeys(contextKeyService);
	keys.windowKind.set(context.composition.windowKind); keys.lifecyclePhase.set(lifecycle.phase ?? 'starting'); keys.direction.set(context.localization.direction); keys.modal.set(context.shell.overlayHost.visible); updatePresentationKeys(keys, themeService);
	context.disposables.add(lifecycle.onDidAdvancePhase(phase => keys.lifecyclePhase.set(phase)));
	context.disposables.add(context.shell.overlayHost.onDidChangeVisibility(visible => keys.modal.set(visible)));
	context.disposables.add(themeService.onDidChangeTheme(() => updatePresentationKeys(keys, themeService)));
	context.disposables.add(themeService.onDidChangePresentation(() => updatePresentationKeys(keys, themeService)));
	const updateFocusedPart = (target: EventTarget | null = context.document.activeElement): void => keys.focusedPart.set(focusedPart(context, target)); updateFocusedPart(); context.disposables.add(addDisposableListener(context.document, 'focusin', event => updateFocusedPart(event.target), true)); context.disposables.add(addDisposableListener(context.document, 'focusout', () => queueMicrotask(() => updateFocusedPart()), true));

	const actionRegistration = registerProctorAction({
		command: { id: RESET_LAYOUT_COMMAND_ID, title: WORKBENCH_RESET_LAYOUT_MESSAGE, precondition: WorkbenchModalContext.toNegated() },
		handler: () => context.shell.resetLayout(), commandPalette: true,
		menus: [{ id: MenuId.WorkbenchTitle, group: 'navigation', order: 10 }],
		keybindings: [{ primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Digit0, weight: KeybindingWeight.WorkbenchContrib, when: WorkbenchModalContext.toNegated() }]
	});
	context.disposables.add(actionRegistration);
	const feedbackElement = context.document.createElement('span'); feedbackElement.className = 'prctr-workbench__keybinding-feedback'; context.shell.part('status').append(feedbackElement); context.disposables.add({ dispose: () => feedbackElement.remove() });
	const keybindingService = context.disposables.add(new BrowserKeybindingService(context.document, contextKeyService, commandService, new WorkbenchKeybindingFeedbackService(feedbackElement))); services.set(IKeybindingService, keybindingService);

	const updateResetAction = (): void => { const action = findAction(menuService, MenuId.WorkbenchTitle, RESET_LAYOUT_COMMAND_ID, contextKeyService.getContext(context.shell.element)); context.shell.setResetLayoutAction(async () => { await action?.run(); }, action?.enabled === true); };
	updateResetAction(); context.disposables.add(contextKeyService.onDidChangeContext(updateResetAction)); context.disposables.add(MenuRegistry.onDidChangeMenu(event => { if (event.has(MenuId.WorkbenchTitle)) updateResetAction(); }));

	context.setService(WORKBENCH_CONTEXT_KEY_SERVICE, contextKeyService); context.setService(WORKBENCH_COMMAND_SERVICE, commandService); context.setService(WORKBENCH_KEYBINDING_SERVICE, keybindingService); context.setService(WORKBENCH_MENU_SERVICE, menuService);
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
function bindWorkbenchContextKeys(service: IContextKeyService): BoundWorkbenchContextKeys { return Object.freeze({ windowKind: WorkbenchWindowKindContext.bindTo(service), lifecyclePhase: WorkbenchLifecyclePhaseContext.bindTo(service), focusedPart: WorkbenchFocusedPartContext.bindTo(service), modal: WorkbenchModalContext.bindTo(service), candidateInteractionAllowed: CandidateInteractionAllowedContext.bindTo(service), highContrast: WorkbenchHighContrastContext.bindTo(service), reducedMotion: WorkbenchReducedMotionContext.bindTo(service), direction: WorkbenchDirectionContext.bindTo(service) }); }
function updatePresentationKeys(keys: BoundWorkbenchContextKeys, theme: BrowserThemeService): void { keys.highContrast.set(theme.forcedColorsActive || theme.theme.isHighContrast); keys.reducedMotion.set(theme.reducedMotionActive); }
function focusedPart(context: WorkbenchBootstrapContext, target: EventTarget | null): WorkbenchPartId | '' { const HTMLElementConstructor = context.document.defaultView?.HTMLElement; if (HTMLElementConstructor === undefined || !(target instanceof HTMLElementConstructor)) return ''; if (context.shell.overlayHost.element.contains(target)) return 'overlay'; const part = target.closest<HTMLElement>('[data-part]')?.dataset.part; return isWorkbenchPart(part) ? part : ''; }
function isWorkbenchPart(value: string | undefined): value is Exclude<WorkbenchPartId, 'overlay'> { return value !== undefined && ['titlebar', 'banner', 'navigation', 'sidebar', 'content', 'panel', 'status'].includes(value); }
function findAction(menuService: MenuService, menuId: MenuId, id: string, menuContext: Parameters<MenuService['getActions']>[1]): ResolvedMenuAction | undefined { for (const [, actions] of menuService.getActions(menuId, menuContext)) for (const action of actions) if (action.id === id && 'run' in action) return action as ResolvedMenuAction; return undefined; }
