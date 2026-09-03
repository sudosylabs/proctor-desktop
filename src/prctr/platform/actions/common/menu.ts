/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port actions-menus

import { SubmenuAction, type IAction } from '../../../base/common/actions.js';
import { MicrotaskEmitter, type Event } from '../../../base/common/event.js';
import type { LocalizationContext, MessageDescriptor } from '../../../base/common/localization.js';
import { DisposableStore, markAsSingleton, toDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { LinkedList } from '../../../base/common/linkedList.js';
import type { ICommandMetadata, ICommandService } from '../../commands/common/commands.js';
import type { ContextKeyExpression, IContextKeyService } from '../../contextkey/common/contextkey.js';
import type { SemanticIconId } from '../../theme/common/semanticIcons.js';

export class MenuId {
	static readonly CommandPalette = new MenuId('prctr.menu.commandPalette');
	static readonly Account = new MenuId('prctr.menu.account');
	static readonly GlobalActivity = new MenuId('prctr.menu.globalActivity');
	static readonly WorkbenchTitle = new MenuId('prctr.menu.workbenchTitle');
	static readonly EditorTitle = new MenuId('prctr.menu.editorTitle');
	static readonly WorkspaceContext = new MenuId('prctr.menu.workspaceContext');
	static readonly BrowserToolbar = new MenuId('prctr.menu.browserToolbar');
	static readonly TerminalToolbar = new MenuId('prctr.menu.terminalToolbar');
	static readonly CandidateStatus = new MenuId('prctr.menu.candidateStatus');

	private constructor(readonly id: `prctr.menu.${string}`) { }
}

export type ProctorMenuId = MenuId;

export interface MenuCommandToggle {
	readonly condition: ContextKeyExpression;
	readonly icon?: SemanticIconId;
	readonly title?: MessageDescriptor;
	readonly tooltip?: MessageDescriptor;
}

export interface MenuCommand {
	readonly id: `prctr.${string}`;
	readonly title: MessageDescriptor;
	readonly shortTitle?: MessageDescriptor;
	readonly tooltip?: MessageDescriptor;
	readonly icon?: SemanticIconId;
	readonly metadata?: ICommandMetadata;
	readonly precondition?: ContextKeyExpression;
	readonly toggled?: MenuCommandToggle;
}

export interface MenuItem {
	readonly command: MenuCommand;
	readonly alt?: MenuCommand;
	readonly when?: ContextKeyExpression;
	readonly group?: 'navigation' | string;
	readonly order?: number;
	readonly isHiddenByDefault?: boolean;
}

export interface SubmenuItem {
	readonly title: MessageDescriptor;
	readonly submenu: MenuId;
	readonly icon?: SemanticIconId;
	readonly when?: ContextKeyExpression;
	readonly group?: 'navigation' | string;
	readonly order?: number;
	readonly isHiddenByDefault?: boolean;
}

export type MenuContribution = MenuItem | SubmenuItem;

export function isMenuItem(item: MenuContribution): item is MenuItem {
	return 'command' in item;
}

export interface MenuRegistryChangeEvent {
	has(id: MenuId): boolean;
}

class SingleMenuChangeEvent implements MenuRegistryChangeEvent {
	private static readonly events = new Map<MenuId, SingleMenuChangeEvent>();

	static for(id: MenuId): SingleMenuChangeEvent {
		let event = this.events.get(id);
		if (event === undefined) {
			event = new SingleMenuChangeEvent(id);
			this.events.set(id, event);
		}
		return event;
	}

	static merge(events: readonly MenuRegistryChangeEvent[]): MenuRegistryChangeEvent {
		const changed = new Set<MenuId>();
		for (const event of events) {
			for (const id of allMenuIds) if (event.has(id)) changed.add(id);
		}
		return { has: id => changed.has(id) };
	}

	private constructor(private readonly changed: MenuId) { }
	has(id: MenuId): boolean { return id === this.changed; }
}

const allMenuIds = Object.freeze([
	MenuId.CommandPalette, MenuId.Account, MenuId.GlobalActivity, MenuId.WorkbenchTitle,
	MenuId.EditorTitle, MenuId.WorkspaceContext, MenuId.BrowserToolbar,
	MenuId.TerminalToolbar, MenuId.CandidateStatus
]);

class StaticMenuRegistry {
	private readonly commands = new Map<string, MenuCommand>();
	private readonly menuItems = new Map<MenuId, LinkedList<MenuContribution>>();
	private readonly changeEmitter = new MicrotaskEmitter<MenuRegistryChangeEvent>({ merge: SingleMenuChangeEvent.merge });
	readonly onDidChangeMenu: Event<MenuRegistryChangeEvent> = this.changeEmitter.event;

	addCommand(command: MenuCommand): IDisposable {
		assertStaticCommand(command);
		if (this.commands.has(command.id)) throw new Error(`Duplicate menu command: ${command.id}`);
		this.commands.set(command.id, command);
		this.changeEmitter.fire(SingleMenuChangeEvent.for(MenuId.CommandPalette));
		return markAsSingleton(toDisposable(() => {
			if (this.commands.get(command.id) === command) {
				this.commands.delete(command.id);
				this.changeEmitter.fire(SingleMenuChangeEvent.for(MenuId.CommandPalette));
			}
		}));
	}

	getCommand(id: string): MenuCommand | undefined { return this.commands.get(id); }

	getCommands(): ReadonlyMap<string, MenuCommand> { return new Map(this.commands); }

	appendMenuItem(id: MenuId, item: MenuContribution): IDisposable {
		assertMenuId(id);
		assertContribution(item);
		let items = this.menuItems.get(id);
		if (items === undefined) {
			items = new LinkedList<MenuContribution>();
			this.menuItems.set(id, items);
		}
		const remove = items.push(item);
		this.changeEmitter.fire(SingleMenuChangeEvent.for(id));
		return markAsSingleton(toDisposable(() => {
			remove();
			if (items?.isEmpty()) this.menuItems.delete(id);
			this.changeEmitter.fire(SingleMenuChangeEvent.for(id));
		}));
	}

	appendMenuItems(items: Iterable<{ readonly id: MenuId; readonly item: MenuContribution }>): IDisposable {
		const result = new DisposableStore();
		try {
			for (const { id, item } of items) result.add(this.appendMenuItem(id, item));
			return result;
		} catch (error) {
			result.dispose();
			throw error;
		}
	}

	getMenuItems(id: MenuId): MenuContribution[] {
		const result = this.menuItems.has(id) ? [...(this.menuItems.get(id) as LinkedList<MenuContribution>)] : [];
		if (id === MenuId.CommandPalette) {
			const explicit = new Set(result.filter(isMenuItem).flatMap(item => [item.command.id, ...(item.alt ? [item.alt.id] : [])]));
			for (const command of this.commands.values()) if (!explicit.has(command.id)) result.push({ command });
		}
		return result;
	}
}

export const MenuRegistry = new StaticMenuRegistry();

export interface MenuActionOptions {
	readonly arg?: unknown;
	readonly args?: readonly unknown[];
	readonly shouldForwardArgs?: boolean;
	readonly renderShortTitle?: boolean;
}

export interface MenuCreateOptions {
	readonly emitEventsForSubmenuChanges?: boolean;
	readonly eventDebounceDelay?: number;
}

export interface MenuChangeEvent {
	readonly menu: Menu;
	readonly isStructuralChange: boolean;
	readonly isEnablementChange: boolean;
	readonly isToggleChange: boolean;
}

export interface Menu extends IDisposable {
	readonly onDidChange: Event<MenuChangeEvent>;
	getActions(options?: MenuActionOptions): readonly MenuActionGroup[];
}

export interface ResolvedMenuAction extends IAction {
	readonly semanticIconId?: SemanticIconId;
	readonly alt?: ResolvedMenuAction;
}

export class CommandMenuAction implements ResolvedMenuAction {
	readonly id: string;
	readonly label: string;
	readonly tooltip: string;
	readonly class = undefined;
	readonly enabled: boolean;
	readonly checked: boolean | undefined;
	readonly semanticIconId: SemanticIconId | undefined;
	readonly alt: ResolvedMenuAction | undefined;

	constructor(
		command: MenuCommand,
		alt: MenuCommand | undefined,
		context: IContextKeyService,
		localization: LocalizationContext,
		private readonly commandService: ICommandService,
		private readonly options: MenuActionOptions | undefined
	) {
		this.id = command.id;
		this.enabled = context.contextMatchesRules(command.precondition);
		const toggled = command.toggled;
		this.checked = toggled === undefined ? undefined : context.contextMatchesRules(toggled.condition);
		const title = options?.renderShortTitle && command.shortTitle ? command.shortTitle : command.title;
		this.label = localize(localization, this.checked && toggled?.title ? toggled.title : title);
		this.tooltip = localizeOptional(localization, this.checked && toggled?.tooltip ? toggled.tooltip : command.tooltip);
		this.semanticIconId = this.checked && toggled?.icon ? toggled.icon : command.icon;
		this.alt = alt === undefined ? undefined : new CommandMenuAction(alt, undefined, context, localization, commandService, options);
	}

	run(...arguments_: unknown[]): Promise<unknown> {
		let runArgs: unknown[] = [];
		if (this.options?.args) {
			runArgs = [...this.options.args];
		} else if (this.options?.arg) {
			runArgs = [this.options.arg];
		}
		if (this.options?.shouldForwardArgs) {
			runArgs.push(...arguments_);
		}
		return this.commandService.executeCommand(this.id, ...runArgs);
	}
}

export class ResolvedSubmenuAction extends SubmenuAction {
	constructor(
		readonly menuItem: SubmenuItem,
		label: string,
		actions: readonly IAction[],
		readonly semanticIconId: SemanticIconId | undefined
	) {
		super(`submenu.${menuItem.submenu.id}`, label, actions);
	}
}

export type MenuActionGroup = readonly [group: string, actions: readonly (ResolvedMenuAction | ResolvedSubmenuAction)[]];

function localize(localization: LocalizationContext, descriptor: MessageDescriptor): string {
	if (descriptor.placeholders.length > 0) throw new TypeError(`Static menu label ${descriptor.id} cannot require runtime placeholders.`);
	return localization.format(descriptor);
}

function localizeOptional(localization: LocalizationContext, descriptor: MessageDescriptor | undefined): string {
	return descriptor === undefined ? '' : localize(localization, descriptor);
}

function assertContribution(item: MenuContribution): void {
	if (isMenuItem(item)) {
		assertStaticCommand(item.command);
		if (item.alt) assertStaticCommand(item.alt);
	} else {
		assertMenuId(item.submenu);
		if (item.title.placeholders.length > 0) {
			throw new TypeError(`Static submenu label ${item.title.id} cannot require runtime placeholders.`);
		}
	}
}

function assertMenuId(id: MenuId): void {
	if (!allMenuIds.includes(id)) throw new TypeError('Menu IDs must belong to the static Proctor catalog.');
}

function assertStaticCommand(command: MenuCommand): void {
	if (!/^prctr\.[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/u.test(command.id)) {
		throw new TypeError(`Menu commands must use the prctr namespace: ${command.id}`);
	}
	for (const descriptor of [command.title, command.shortTitle, command.tooltip, command.toggled?.title, command.toggled?.tooltip]) {
		if (descriptor !== undefined && descriptor.placeholders.length > 0) {
			throw new TypeError(`Static menu label ${descriptor.id} cannot require runtime placeholders.`);
		}
	}
}
