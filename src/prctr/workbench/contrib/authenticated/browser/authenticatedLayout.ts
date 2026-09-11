/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port modern-workbench
import type { INotificationService } from '../../../../platform/notification/common/notification.js';
import { WORKBENCH_NOTIFICATION_SERVICE } from '../../../browser/parts/notifications/notifications.js';
import { alert } from '../../../../base/browser/ui/aria/aria.js';
import type { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { WORKBENCH_KEYBINDING_SERVICE } from '../../../common/serviceIds.js';

import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	toDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import { defineMessage } from '../../../../base/common/localization.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import {
	PRODUCT_WINDOW_CHROME_SERVICE,
	type ProductWindowChrome
} from '../../../../platform/windows/browser/productWindowChrome.js';
import { WorkbenchModalContext } from '../../../common/contextKeys.js';
import { registerProctorAction } from '../../../services/actions/common/proctorActions.js';
import type { WorkbenchBootstrapContext } from '../../../browser/bootstrap.js';
import type {
	IQuickPick,
	IQuickPickItem,
	QuickPickInput
} from '../../../../platform/quickinput/common/quickInput.js';
import { AuthenticatedLayoutState } from './authenticatedLayoutState.js';
import {
	AUTHENTICATED_WINDOW_CONTROLS_SERVICE,
	AuthenticatedWindowControls
} from './authenticatedWindowControls.js';
import './authenticatedLayout.css';

export const AUTHENTICATED_LAYOUT_SERVICE = 'prctr.authenticated.layout';
export type SecondaryContent = (container: HTMLElement) => IDisposable;

/** The current destination owns secondary content; switching destinations releases its DOM and state. */
export class AuthenticatedLayout extends Disposable {
	private readonly changed = this._register(new Emitter<void>());
	private readonly secondary = this._register(new MutableDisposable<IDisposable>());
	private readonly providers = new Map<string, SecondaryContent>();
	private destination = '';
	private quickInput: AuthenticatedWindowControls | undefined;
	private picker: IQuickPick<IQuickPickItem, { useSeparators: true }> | undefined;
	private opening = false;
	private readonly titlebarHovers: { target: HTMLElement; command?: string }[] = [];
	private readonly preferences: AuthenticatedLayoutState;
	constructor(private readonly context: WorkbenchBootstrapContext) {
		super();
		let storage: Storage | undefined;
		try {
			storage = context.document.defaultView?.localStorage;
		} catch {
			/* Ephemeral window. */
		}
		this.preferences = new AuthenticatedLayoutState(storage);
		const shell = context.shell;
		shell.setNavigationLayout('sidebar', true);
		shell.setPrimarySide(this.preferences.primarySide);
		shell.setNavigationVisible(this.preferences.sidebarVisible);
		shell.setSecondaryVisible(false);
		shell.part('navigation').ariaLabel = localize('primarySideBar', 'Primary Side Bar');
		shell.part('sidebar').ariaLabel = localize('secondarySideBar', 'Secondary Side Bar');
		const chrome = context.getService<ProductWindowChrome>(PRODUCT_WINDOW_CHROME_SERVICE);
		const controls = context.document.createElement('div');
		controls.className = 'prctr-authenticated-layout';
		chrome.actions.prepend(controls);
		this._register(toDisposable(() => controls.remove()));
		const primary = this.button(controls, 'primary');
		const secondary = this.button(controls, 'secondary');
		const customize = this.button(controls, 'customize');
		const update = (): void => {
			const right = shell.primarySide === 'right';
			const first = right ? secondary.button : primary.button;
			if (controls.firstElementChild !== first) {
				const focused = context.document.activeElement;
				controls.prepend(first);
				if (focused === primary.button || focused === secondary.button)
					(focused === primary.button ? primary.button : secondary.button).focus({
						preventScroll: true
					});
			}
			for (const [control, visible, side, enabled, label] of [
				[
					primary,
					shell.navigationVisible,
					right,
					true,
					localize('primarySideBar', 'Primary Side Bar')
				],
				[
					secondary,
					shell.secondaryVisible,
					!right,
					this.secondaryAvailable,
					localize('secondarySideBar', 'Secondary Side Bar')
				]
			] as const) {
				control.icon.setState({
					id: side
						? visible
							? 'workbench.sidebarRight'
							: 'workbench.sidebarRightHidden'
						: visible
							? 'workbench.sidebarLeft'
							: 'workbench.sidebarLeftHidden',
					size: 16
				});
				control.button.disabled = !enabled || shell.overlayHost.visible;
				control.button.setAttribute('aria-expanded', String(visible));
				control.button.ariaLabel = enabled
					? localize('toggleBar', 'Toggle {0}', label)
					: localize('unavailableBar', '{0} is not available on this page', label);
			}
			customize.button.disabled = shell.overlayHost.visible;
			this.changed.fire();
		};
		primary.button.setAttribute('aria-controls', shell.part('navigation').id);
		secondary.button.setAttribute('aria-controls', shell.part('sidebar').id);
		customize.icon.setState({ id: 'workbench.configureLayout', size: 16 });
		customize.button.ariaLabel = localize('customizeLayout', 'Customize Layout');
		customize.button.setAttribute('aria-haspopup', 'dialog');
		this._register(shell.onDidChangeLayout(update));
		this._register(
			shell.overlayHost.onDidChangeVisibility(() => {
				if (shell.overlayHost.visible) this.picker?.hide();
				update();
			})
		);
		const actions = [
			[
				'prctr.authenticated.toggleSidebar',
				defineMessage({
					id: 'authenticated.layout.primary',
					defaultMessage: 'Toggle Primary Side Bar Visibility',
					description: 'Authenticated window layout action.'
				}),
				KeyMod.CtrlCmd | KeyCode.KeyB,
				() => this.togglePrimary(),
				primary.button
			],
			[
				'prctr.authenticated.toggleSecondarySidebar',
				defineMessage({
					id: 'authenticated.layout.secondary',
					defaultMessage: 'Toggle Secondary Side Bar Visibility',
					description: 'Authenticated window layout action.'
				}),
				KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB,
				() => this.toggleSecondary(),
				secondary.button
			],
			[
				'prctr.authenticated.customizeLayout',
				defineMessage({
					id: 'authenticated.layout.customize',
					defaultMessage: 'Customize Layout',
					description: 'Authenticated window layout action.'
				}),
				undefined,
				() => {
					void this.customize().catch((error) => {
						console.error('Customize Layout failed', error);
						this.context
							.getService<INotificationService>(WORKBENCH_NOTIFICATION_SERVICE)
							.error(
								localize(
									'layoutOpenFailed',
									'Customize Layout could not be opened.'
								)
							);
					});
				},
				customize.button
			]
		] as const;
		for (const [id, title, binding, handler, button] of actions) {
			this._register(
				registerProctorAction({
					command: {
						id,
						title,
						precondition: WorkbenchModalContext.toNegated()
					},
					handler,
					keybindings:
						binding === undefined
							? []
							: [{ primary: binding, weight: KeybindingWeight.WorkbenchContrib }],
					commandPalette: true
				})
			);
			this._register(addDisposableListener(button, 'click', handler));
			this.registerTitlebarHover(button, id);
		}
		update();
	}
	/** Start source controls in the production window graph, before any titlebar interaction. */
	initializeControls(): void {
		if (this.quickInput) return;
		this.quickInput = this._register(new AuthenticatedWindowControls(this.context));
		this.context.setService(AUTHENTICATED_WINDOW_CONTROLS_SERVICE, this.quickInput);
		for (const { target, command } of this.titlebarHovers)
			this.installTitlebarHover(target, command);
	}
	registerTitlebarHover(target: HTMLElement, command?: string): void {
		this.titlebarHovers.push({ target, command });
		if (this.quickInput) this.installTitlebarHover(target, command);
	}
	private installTitlebarHover(target: HTMLElement, command?: string): void {
		this._register(
			this.quickInput!.hover.setupDelayedHover(
				target,
				() => {
					const binding = command
						? this.context
								.getService<IKeybindingService>(WORKBENCH_KEYBINDING_SERVICE)
								.lookupKeybinding(command)
								?.getLabel()
						: undefined;
					const label = target.ariaLabel ?? '';
					return {
						content: binding ? `${label} (${binding})` : label,
						position: { hoverPosition: HoverPosition.BELOW }
					};
				},
				{ groupId: 'authenticated-titlebar' }
			)
		);
	}
	get secondaryAvailable(): boolean {
		return this.providers.has(this.destination);
	}
	setDestination(destination: string): void {
		if (this.destination === destination) return;
		this.context.shell.setSecondaryVisible(false);
		this.secondary.clear();
		this.context.shell.part('sidebar').replaceChildren();
		this.destination = destination;
		this.context.shell.layout();
	}
	registerSecondary(destination: string, render: SecondaryContent): IDisposable {
		if (this.providers.has(destination))
			throw new Error('Secondary content already registered for this destination.');
		if (
			!this.context.composition.destinations.includes(destination.split('/')[0]!) ||
			destination.split('/')[0] === 'settings'
		)
			throw new Error('Secondary content requires a composition-approved page.');
		this.providers.set(destination, render);
		this.context.shell.layout();
		return toDisposable(() => {
			if (this.providers.get(destination) !== render) return;
			this.providers.delete(destination);
			if (this.destination === destination) {
				this.context.shell.setSecondaryVisible(false);
				this.secondary.clear();
				this.context.shell.part('sidebar').replaceChildren();
			}
			this.context.shell.layout();
		});
	}
	showSecondary(): void {
		const render = this.providers.get(this.destination);
		if (!render || this.context.shell.overlayHost.visible) return;
		if (!this.secondary.value) {
			try {
				this.secondary.value = render(this.context.shell.part('sidebar'));
			} catch (error) {
				this.context.shell.part('sidebar').replaceChildren();
				throw error;
			}
		}
		this.context.shell.setSecondaryVisible(true);
		alert(localize('secondaryShown', 'Secondary Side Bar shown'));
	}
	private togglePrimary(): void {
		if (this.context.shell.overlayHost.visible) return;
		const visible = !this.context.shell.navigationVisible;
		this.preferences.sidebarVisible = visible;
		this.context.shell.setNavigationVisible(visible);
		alert(
			visible
				? localize('sidebarVisible', 'Primary Side Bar shown')
				: localize('sidebarHidden', 'Primary Side Bar hidden')
		);
	}
	private toggleSecondary(): void {
		if (this.context.shell.overlayHost.visible || !this.secondaryAvailable) return;
		if (this.context.shell.secondaryVisible) {
			this.context.shell.setSecondaryVisible(false);
			alert(localize('secondaryHidden', 'Secondary Side Bar hidden'));
		} else this.showSecondary();
	}
	private setSide(side: 'left' | 'right'): void {
		this.preferences.primarySide = side;
		this.context.shell.setPrimarySide(side);
	}
	private button(host: HTMLElement, name: string) {
		const button = host.ownerDocument.createElement('button');
		button.type = 'button';
		button.dataset.layoutAction = name;
		const icon = this._register(
			createSemanticIcon(host.ownerDocument, { id: 'workbench.sidebarLeft', size: 16 })
		);
		button.append(icon.element);
		host.append(button);
		return { button, icon };
	}
	/** Source CustomizeLayoutAction picker lifecycle, projected to the two admitted bars. */
	private async customize(): Promise<void> {
		if (this.picker) {
			this.picker.hide();
			return;
		}
		if (this.opening || this.context.shell.overlayHost.visible) return;
		this.opening = true;
		try {
			this.initializeControls();
			await this.quickInput!.ready;
			if (this._store.isDisposed || this.context.shell.overlayHost.visible) return;
			const previous = this.context.document.activeElement;
			const disposables = this._register(new DisposableStore());
			const quickPick = disposables.add(
				this.quickInput!.input.createQuickPick({ useSeparators: true })
			);
			this.picker = quickPick;
			this.context.shell.element
				.querySelector('[data-layout-action="customize"]')
				?.setAttribute('aria-expanded', 'true');
			const shell = this.context.shell;
			const keybindings = this.context.getService<IKeybindingService>(
				WORKBENCH_KEYBINDING_SERVICE
			);
			const items = (): QuickPickInput<IQuickPickItem>[] => {
				const bar = (
					id: string,
					label: string,
					visible: boolean,
					right: boolean,
					disabled = false
				): IQuickPickItem => ({
					keybinding: keybindings.lookupKeybinding(
						id === 'primary'
							? 'prctr.authenticated.toggleSidebar'
							: 'prctr.authenticated.toggleSecondarySidebar'
					),
					id,
					label: `$(${right ? 'layout-sidebar-right' : 'layout-sidebar-left'}) ${label}`,
					disabled,
					ariaLabel: disabled
						? localize('unavailableBar', '{0} is not available on this page', label)
						: label +
							' (' +
							(visible
								? localize('selectToHide', 'Select to Hide')
								: localize('selectToShow', 'Select to Show')) +
							')',
					buttons: disabled
						? []
						: [
								{
									alwaysVisible: false,
									iconClass: ThemeIcon.asClassName(
										visible ? Codicon.eye : Codicon.eyeClosed
									),
									tooltip: visible
										? localize('selectToHide', 'Select to Hide')
										: localize('selectToShow', 'Select to Show')
								}
							]
				});
				return [
					{ type: 'separator', label: localize('toggleVisibility', 'Visibility') },
					bar(
						'primary',
						localize('primarySideBar', 'Primary Side Bar'),
						shell.navigationVisible,
						shell.primarySide === 'right'
					),
					bar(
						'secondary',
						localize('secondarySideBar', 'Secondary Side Bar'),
						shell.secondaryVisible,
						shell.primarySide === 'left',
						!this.secondaryAvailable
					),
					{
						type: 'separator',
						label: localize('sideBarPosition', 'Primary Side Bar Position')
					},
					...(['left', 'right'] as const).map((side) => ({
						id: side,
						label: `$(layout-sidebar-${side}) ${side === 'left' ? localize('leftSideBar', 'Left') : localize('rightSideBar', 'Right')}${shell.primarySide === side ? ' $(check)' : ''}`
					}))
				];
			};
			quickPick.items = items();
			quickPick.ignoreFocusOut = true;
			quickPick.hideInput = true;
			quickPick.title = localize('customizeLayout', 'Customize Layout');
			const close = {
				alwaysVisible: true,
				iconClass: ThemeIcon.asClassName(Codicon.close),
				tooltip: localize('close', 'Close')
			};
			const reset = {
				alwaysVisible: true,
				iconClass: ThemeIcon.asClassName(Codicon.discard),
				tooltip: localize('restoreDefaults', 'Restore Defaults')
			};
			quickPick.buttons = [reset, close];
			let selected: string | undefined;
			disposables.add(
				this.changed.event(() => {
					quickPick.items = items();
					if (selected)
						quickPick.activeItems = quickPick.items.filter(
							(item): item is IQuickPickItem =>
								item.type !== 'separator' && item.id === selected
						);
				})
			);
			const run = (item: IQuickPickItem | undefined): void => {
				if (!item || item.disabled) return;
				selected = item.id;
				if (item.id === 'primary') this.togglePrimary();
				else if (item.id === 'secondary') this.toggleSecondary();
				else if (item.id === 'left' || item.id === 'right') this.setSide(item.id);
				quickPick.show();
			};
			disposables.add(quickPick.onDidAccept(() => run(quickPick.selectedItems[0])));
			disposables.add(quickPick.onDidTriggerItemButton((event) => run(event.item)));
			disposables.add(
				quickPick.onDidTriggerButton((button) => {
					if (button === close) quickPick.hide();
					else if (button === reset) {
						this.setSide('left');
						this.preferences.sidebarVisible = true;
						shell.setNavigationVisible(true);
						shell.setSecondaryVisible(false);
					}
				})
			);
			disposables.add(
				quickPick.onDidHide(() => {
					this.picker = undefined;
					this.context.shell.element
						.querySelector('[data-layout-action="customize"]')
						?.setAttribute('aria-expanded', 'false');
					disposables.dispose();
					this._store.delete(disposables);
					if (
						previous instanceof this.context.document.defaultView!.HTMLElement &&
						previous.isConnected &&
						!shell.overlayHost.visible
					)
						previous.focus();
				})
			);
			quickPick.show();
		} finally {
			this.opening = false;
		}
	}
	override dispose(): void {
		this.picker?.hide();
		this.providers.clear();
		super.dispose();
	}
}
