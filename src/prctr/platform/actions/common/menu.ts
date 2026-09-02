/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Separator, SubmenuAction, type IAction } from '../../../base/common/actions.js';
import { Emitter, MicrotaskEmitter, type Event } from '../../../base/common/event.js';
import type { LocalizationContext, MessageDescriptor } from '../../../base/common/localization.js';
import { Disposable, DisposableStore, markAsSingleton, toDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { LinkedList } from '../../../base/common/linkedList.js';
import type { ICommandService } from '../../commands/common/commands.js';
import type { ContextKeyExpression, IContext } from '../../contextkey/common/contextkey.js';
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
		for (const { id, item } of items) result.add(this.appendMenuItem(id, item));
		return result;
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

export class MenuVisibilityState extends Disposable {
	private readonly values = new Map<string, boolean>();
	private readonly changeEmitter = this._register(new Emitter<MenuId>());
	readonly onDidChange: Event<MenuId> = this.changeEmitter.event;

	isHidden(menu: MenuId, itemId: string, hiddenByDefault: boolean): boolean {
		return this.values.get(`${menu.id}/${itemId}`) ?? hiddenByDefault;
	}

	setHidden(menu: MenuId, itemId: string, hidden: boolean): void {
		const key = `${menu.id}/${itemId}`;
		if (this.values.get(key) === hidden) return;
		this.values.set(key, hidden);
		this.changeEmitter.fire(menu);
	}

	reset(menu?: MenuId): void {
		if (menu === undefined) {
			if (this.values.size === 0) return;
			const changed = new Set([...this.values.keys()].map(key => allMenuIds.find(id => key.startsWith(`${id.id}/`))).filter((id): id is MenuId => id !== undefined));
			this.values.clear();
			for (const id of changed) this.changeEmitter.fire(id);
			return;
		}
		let changed = false;
		for (const key of [...this.values.keys()]) if (key.startsWith(`${menu.id}/`)) changed = this.values.delete(key) || changed;
		if (changed) this.changeEmitter.fire(menu);
	}
}

export interface ResolvedMenuAction extends IAction {
	readonly semanticIconId?: SemanticIconId;
	readonly alt?: ResolvedMenuAction;
}

class CommandMenuAction implements ResolvedMenuAction {
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
		context: IContext,
		localization: LocalizationContext,
		private readonly commandService: ICommandService,
		private readonly forwardedArguments: readonly unknown[]
	) {
		this.id = command.id;
		this.enabled = command.precondition?.evaluate(context) ?? true;
		const toggled = command.toggled;
		this.checked = toggled === undefined ? undefined : toggled.condition.evaluate(context);
		this.label = localize(localization, this.checked && toggled?.title ? toggled.title : command.title);
		this.tooltip = localizeOptional(localization, this.checked && toggled?.tooltip ? toggled.tooltip : command.tooltip);
		this.semanticIconId = this.checked && toggled?.icon ? toggled.icon : command.icon;
		this.alt = alt === undefined ? undefined : new CommandMenuAction(alt, undefined, context, localization, commandService, forwardedArguments);
	}

	run(...arguments_: unknown[]): Promise<unknown> {
		return this.commandService.executeCommand(this.id, ...this.forwardedArguments, ...arguments_);
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

export class MenuService {
	constructor(
		private readonly commandService: ICommandService,
		private readonly localization: LocalizationContext,
		private readonly visibility = new MenuVisibilityState()
	) { }

	getActions(id: MenuId, context: IContext, forwardedArguments: readonly unknown[] = []): readonly MenuActionGroup[] {
		return this.resolve(id, context, forwardedArguments, new Set());
	}

	private resolve(id: MenuId, context: IContext, forwardedArguments: readonly unknown[], stack: Set<MenuId>): readonly MenuActionGroup[] {
		if (stack.has(id)) throw new Error(`Menu cycle detected at ${id.id}`);
		stack.add(id);
		try {
			const visible = MenuRegistry.getMenuItems(id).filter(item => {
				if (item.when !== undefined && !item.when.evaluate(context)) return false;
				const itemId = isMenuItem(item) ? item.command.id : item.submenu.id;
				return !this.visibility.isHidden(id, itemId, item.isHiddenByDefault === true);
			}).sort(compareMenuItems);
			const groups: Array<[string, Array<ResolvedMenuAction | ResolvedSubmenuAction>]> = [];
			for (const item of visible) {
				const group = item.group ?? '';
				let target = groups.at(-1);
				if (target?.[0] !== group) {
					target = [group, []];
					groups.push(target);
				}
				if (isMenuItem(item)) {
					target[1].push(new CommandMenuAction(item.command, item.alt, context, this.localization, this.commandService, forwardedArguments));
				} else {
					const submenuGroups = this.resolve(item.submenu, context, forwardedArguments, stack);
					const actions = Separator.join(...submenuGroups.map(([, actions]) => [...actions]));
					if (actions.length > 0) target[1].push(new ResolvedSubmenuAction(item, localize(this.localization, item.title), actions, item.icon));
				}
			}
			return groups.filter(([, actions]) => actions.length > 0);
		} finally {
			stack.delete(id);
		}
	}
}

function compareMenuItems(a: MenuContribution, b: MenuContribution): number {
	if (a.group !== b.group) {
		if (!a.group) return 1;
		if (!b.group) return -1;
		if (a.group === 'navigation') return -1;
		if (b.group === 'navigation') return 1;
		const group = a.group.localeCompare(b.group);
		if (group !== 0) return group;
	}
	const order = (a.order ?? 0) - (b.order ?? 0);
	if (order !== 0) return order;
	return titleOf(a).defaultMessage.localeCompare(titleOf(b).defaultMessage);
}

function titleOf(item: MenuContribution): MessageDescriptor {
	return isMenuItem(item) ? item.command.title : item.title;
}

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
	} else if (item.title.placeholders.length > 0) {
		throw new TypeError(`Static submenu label ${item.title.id} cannot require runtime placeholders.`);
	}
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
