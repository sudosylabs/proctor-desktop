/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port actions-menus

import { Separator } from '../../../base/common/actions.js';
import { RunOnceScheduler } from '../../../base/common/async.js';
import { DebounceEmitter, Emitter, type Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import type { LocalizationContext } from '../../../base/common/localization.js';
import type { ICommandService } from '../../commands/common/commands.js';
import type { ContextKeyExpression, IContextKeyService } from '../../contextkey/common/contextkey.js';
import {
	CommandMenuAction, isMenuItem, MenuRegistry, ResolvedSubmenuAction,
	type Menu, type MenuActionGroup, type MenuActionOptions, type MenuChangeEvent,
	type MenuContribution, type MenuCreateOptions, type MenuId, type ResolvedMenuAction
} from './menu.js';

export class MenuService extends Disposable {
	readonly visibility: MenuVisibilityState;

	constructor(
		private readonly commandService: ICommandService,
		private readonly localization: LocalizationContext,
		visibility?: MenuVisibilityState
	) {
		super();
		// A supplied state belongs to the caller; only the default is service-owned.
		this.visibility = visibility ?? this._register(new MenuVisibilityState());
	}

	createMenu(id: MenuId, contextKeyService: IContextKeyService, options?: MenuCreateOptions): Menu {
		return new MenuImpl(id, this.visibility, { emitEventsForSubmenuChanges: false, eventDebounceDelay: 50, ...options }, this.commandService, this.localization, contextKeyService);
	}

	getMenuActions(id: MenuId, contextKeyService: IContextKeyService, options?: MenuActionOptions): readonly MenuActionGroup[] {
		const menu = this.createMenu(id, contextKeyService);
		try {
			return menu.getActions(options);
		} finally {
			menu.dispose();
		}
	}

	getMenuContexts(id: MenuId): ReadonlySet<string> {
		const info = new MenuInfoSnapshot(id, false);
		return new Set([...info.structureContextKeys, ...info.preconditionContextKeys, ...info.toggledContextKeys]);
	}
}

/** Window-owned presentation state. Profile storage/customization UI is not part of this port. */
export class MenuVisibilityState extends Disposable {
	private readonly deviations = new Map<MenuId, Set<string>>();
	private readonly defaults = new Map<string, boolean>();
	private readonly changeEmitter = this._register(new Emitter<MenuId>());
	readonly onDidChange: Event<MenuId> = this.changeEmitter.event;

	setDefaultState(menu: MenuId, itemId: string, hidden: boolean): void {
		this.defaults.set(`${menu.id}/${itemId}`, hidden);
	}

	isHidden(menu: MenuId, itemId: string): boolean {
		const hiddenByDefault = this.defaults.get(`${menu.id}/${itemId}`) ?? false;
		return this.deviations.get(menu)?.has(itemId) ? !hiddenByDefault : hiddenByDefault;
	}

	setHidden(menu: MenuId, itemId: string, hidden: boolean): void {
		if (this.isHidden(menu, itemId) === hidden) return;
		const hiddenByDefault = this.defaults.get(`${menu.id}/${itemId}`) ?? false;
		if (hidden === hiddenByDefault) {
			const entries = this.deviations.get(menu);
			entries?.delete(itemId);
			if (entries?.size === 0) this.deviations.delete(menu);
		} else {
			let entries = this.deviations.get(menu);
			if (!entries) this.deviations.set(menu, entries = new Set());
			entries.add(itemId);
		}
		this.changeEmitter.fire(menu);
	}

	reset(menu?: MenuId): void {
		const changed = menu === undefined ? [...this.deviations.keys()] : [menu];
		for (const id of changed) {
			if (this.deviations.delete(id)) this.changeEmitter.fire(id);
		}
	}
}

type MenuItemGroup = [string, MenuContribution[]];

class MenuInfoSnapshot {
	protected readonly _menuGroups: MenuItemGroup[] = [];
	readonly allMenuIds = new Set<MenuId>();
	readonly structureContextKeys = new Set<string>();
	readonly preconditionContextKeys = new Set<string>();
	readonly toggledContextKeys = new Set<string>();

	constructor(protected readonly _id: MenuId, protected readonly _collectContextKeysForSubmenus: boolean) {
		this.refresh();
	}

	refresh(): void {
		this._menuGroups.length = 0;
		this.allMenuIds.clear();
		this.structureContextKeys.clear();
		this.preconditionContextKeys.clear();
		this.toggledContextKeys.clear();
		this.allMenuIds.add(this._id);
		let group: MenuItemGroup | undefined;
		for (const item of this._sort(MenuRegistry.getMenuItems(this._id))) {
			const groupName = item.group || '';
			if (!group || group[0] !== groupName) {
				group = [groupName, []];
				this._menuGroups.push(group);
			}
			group[1].push(item);
			this._collectContextKeysAndSubmenuIds(item);
		}
	}

	protected _sort(items: MenuContribution[]): MenuContribution[] { return items; }

	private _collectContextKeysAndSubmenuIds(item: MenuContribution): void {
		MenuInfoSnapshot._fillInKbExprKeys(item.when, this.structureContextKeys);
		if (isMenuItem(item)) {
			for (const command of [item.command, item.alt]) {
				MenuInfoSnapshot._fillInKbExprKeys(command?.precondition, this.preconditionContextKeys);
				MenuInfoSnapshot._fillInKbExprKeys(command?.toggled?.condition, this.toggledContextKeys);
			}
		} else if (this._collectContextKeysForSubmenus && !this.allMenuIds.has(item.submenu)) {
			// Track shared submenus once; cyclic registrations must not recurse forever.
			this.allMenuIds.add(item.submenu);
			for (const child of MenuRegistry.getMenuItems(item.submenu)) this._collectContextKeysAndSubmenuIds(child);
		}
	}

	private static _fillInKbExprKeys(expression: ContextKeyExpression | undefined, keys: Set<string>): void {
		if (expression) for (const key of expression.keys()) keys.add(key);
	}
}

class MenuInfo extends MenuInfoSnapshot {
	constructor(
		id: MenuId,
		private readonly _hiddenStates: MenuVisibilityState,
		collectContextKeysForSubmenus: boolean,
		private readonly _commandService: ICommandService,
		private readonly _localization: LocalizationContext,
		private readonly _contextKeyService: IContextKeyService
	) {
		super(id, collectContextKeysForSubmenus);
	}

	createActionGroups(options?: MenuActionOptions, stack = new Set<MenuId>()): readonly MenuActionGroup[] {
		if (stack.has(this._id)) throw new Error(`Menu cycle detected at ${this._id.id}`);
		stack.add(this._id);
		try {
			const result: MenuActionGroup[] = [];
			for (const [id, items] of this._menuGroups) {
				let activeActions: Array<ResolvedMenuAction | ResolvedSubmenuAction> | undefined;
				for (const item of items) {
					if (!this._contextKeyService.contextMatchesRules(item.when)) continue;
					const itemId = isMenuItem(item) ? item.command.id : item.submenu.id;
					this._hiddenStates.setDefaultState(this._id, itemId, !!item.isHiddenByDefault);
					// Proctor's surface receives display-ready actions, not toolbar customization actions.
					if (this._hiddenStates.isHidden(this._id, itemId)) continue;
					if (isMenuItem(item)) {
						(activeActions ??= []).push(new CommandMenuAction(item.command, item.alt, this._contextKeyService, this._localization, this._commandService, options));
					} else {
						const groups = new MenuInfo(item.submenu, this._hiddenStates, this._collectContextKeysForSubmenus, this._commandService, this._localization, this._contextKeyService).createActionGroups(options, stack);
						const actions = Separator.join(...groups.map(([, group]) => [...group]));
						if (actions.length > 0) (activeActions ??= []).push(new ResolvedSubmenuAction(item, this._localization.format(item.title), actions, item.icon));
					}
				}
				if (activeActions?.length) result.push([id, activeActions]);
			}
			return result;
		} finally {
			stack.delete(this._id);
		}
	}

	protected override _sort(items: MenuContribution[]): MenuContribution[] {
		return items.sort(MenuInfo._compareMenuItems);
	}

	private static _compareMenuItems(a: MenuContribution, b: MenuContribution): number {
		const aGroup = a.group;
		const bGroup = b.group;
		if (aGroup !== bGroup) {
			if (!aGroup) return 1;
			if (!bGroup) return -1;
			if (aGroup === 'navigation') return -1;
			if (bGroup === 'navigation') return 1;
			const value = aGroup.localeCompare(bGroup);
			if (value !== 0) return value;
		}
		const aPriority = a.order || 0;
		const bPriority = b.order || 0;
		if (aPriority < bPriority) return -1;
		if (aPriority > bPriority) return 1;
		const aTitle = isMenuItem(a) ? a.command.title : a.title;
		const bTitle = isMenuItem(b) ? b.command.title : b.title;
		return aTitle.defaultMessage.localeCompare(bTitle.defaultMessage);
	}
}

class MenuImpl implements Menu {
	private readonly _menuInfo: MenuInfo;
	private readonly _disposables = new DisposableStore();
	private readonly _onDidChange: Emitter<MenuChangeEvent>;
	readonly onDidChange: Event<MenuChangeEvent>;

	constructor(id: MenuId, hiddenStates: MenuVisibilityState, options: Required<MenuCreateOptions>, commandService: ICommandService, localization: LocalizationContext, contextKeyService: IContextKeyService) {
		this._menuInfo = new MenuInfo(id, hiddenStates, options.emitEventsForSubmenuChanges, commandService, localization, contextKeyService);
		const rebuildMenuSoon = this._disposables.add(new RunOnceScheduler(() => {
			this._menuInfo.refresh();
			this._onDidChange.fire({ menu: this, isStructuralChange: true, isEnablementChange: true, isToggleChange: true });
		}, options.eventDebounceDelay));
		this._disposables.add(MenuRegistry.onDidChangeMenu(event => {
			for (const menuId of this._menuInfo.allMenuIds) {
				if (event.has(menuId)) {
					rebuildMenuSoon.schedule();
					break;
				}
			}
		}));

		// Context changes are frequent: retain listeners only while this menu is observed.
		const lazyListener = this._disposables.add(new DisposableStore());
		this._onDidChange = new DebounceEmitter<MenuChangeEvent>({
			onWillAddFirstListener: () => {
				lazyListener.add(contextKeyService.onDidChangeContext(event => {
					const isStructuralChange = event.affectsSome(this._menuInfo.structureContextKeys);
					const isEnablementChange = event.affectsSome(this._menuInfo.preconditionContextKeys);
					const isToggleChange = event.affectsSome(this._menuInfo.toggledContextKeys);
					if (isStructuralChange || isEnablementChange || isToggleChange) {
						this._onDidChange.fire({ menu: this, isStructuralChange, isEnablementChange, isToggleChange });
					}
				}));
				lazyListener.add(hiddenStates.onDidChange(menuId => {
					if (this._menuInfo.allMenuIds.has(menuId)) {
						this._onDidChange.fire({ menu: this, isStructuralChange: true, isEnablementChange: false, isToggleChange: false });
					}
				}));
			},
			onDidRemoveLastListener: () => lazyListener.clear(),
			delay: options.eventDebounceDelay,
			merge: events => {
				let isStructuralChange = false;
				let isEnablementChange = false;
				let isToggleChange = false;
				for (const event of events) {
					isStructuralChange ||= event.isStructuralChange;
					isEnablementChange ||= event.isEnablementChange;
					isToggleChange ||= event.isToggleChange;
					if (isStructuralChange && isEnablementChange && isToggleChange) break;
				}
				return { menu: this, isStructuralChange, isEnablementChange, isToggleChange };
			}
		});
		this.onDidChange = this._onDidChange.event;
	}

	getActions(options?: MenuActionOptions): readonly MenuActionGroup[] {
		return this._menuInfo.createActionGroups(options);
	}

	dispose(): void {
		this._disposables.dispose();
		this._onDidChange.dispose();
	}
}
