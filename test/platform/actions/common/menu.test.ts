import assert from 'node:assert';
import { afterEach, beforeEach, test } from 'node:test';

import { Event } from '../../../../src/prctr/base/common/event.ts';
import { timeout } from '../../../../src/prctr/base/common/async.ts';
import { runWithFakedTimers } from '../../../base/common/upstream/timeTravelScheduler.ts';
import {
	createLocalization,
	defineMessage
} from '../../../../src/prctr/base/common/localization.ts';
import {
	DisposableStore,
	DisposableTracker,
	setDisposableTracker
} from '../../../../src/prctr/base/common/lifecycle.ts';
import {
	MenuId,
	MenuRegistry,
	ResolvedSubmenuAction,
	type MenuActionOptions,
	type MenuChangeEvent,
	type MenuCommand
} from '../../../../src/prctr/platform/actions/common/menu.ts';
import {
	MenuService,
	MenuVisibilityState
} from '../../../../src/prctr/platform/actions/common/contributionMenuService.ts';
import { ContextKeyService } from '../../../../src/prctr/platform/contextkey/browser/contextKeyService.ts';
import type {
	ICommandEvent,
	ICommandService
} from '../../../../src/prctr/platform/commands/common/commands.ts';
import {
	ContextKeyExpr,
	type ContextKeyValue,
	type IContextKeyService
} from '../../../../src/prctr/platform/contextkey/common/contextkey.ts';

const labels = {
	alpha: defineMessage({
		id: 'test.menu.alpha',
		defaultMessage: 'Alpha',
		description: 'Alpha command.'
	}),
	beta: defineMessage({
		id: 'test.menu.beta',
		defaultMessage: 'Beta',
		description: 'Beta command.'
	}),
	checked: defineMessage({
		id: 'test.menu.checked',
		defaultMessage: 'Checked',
		description: 'Checked command.'
	}),
	submenu: defineMessage({
		id: 'test.menu.submenu',
		defaultMessage: 'Submenu',
		description: 'Submenu title.'
	})
};
const localization = createLocalization({ requestedLocale: 'en', messages: Object.values(labels) });

class RecordingCommandService implements ICommandService {
	declare readonly _serviceBrand: undefined;
	readonly onWillExecuteCommand: Event<ICommandEvent> = Event.None;
	readonly onDidExecuteCommand: Event<ICommandEvent> = Event.None;
	readonly calls: Array<readonly unknown[]> = [];
	async executeCommand<R>(commandId: string, ...args: unknown[]): Promise<R | undefined> {
		this.calls.push([commandId, ...args]);
		return undefined;
	}
}

const contexts = new DisposableStore();
let tracker: DisposableTracker;
beforeEach(() => {
	tracker = new DisposableTracker();
	setDisposableTracker(tracker);
});
afterEach(() => {
	contexts.clear();
	setDisposableTracker(null);
	const leaks = tracker.computeLeakingDisposables();
	assert.strictEqual(leaks, undefined, leaks?.details);
});

function context(values: Readonly<Record<string, ContextKeyValue>> = {}): IContextKeyService {
	const service = contexts.add(new ContextKeyService());
	for (const [key, value] of Object.entries(values)) service.createKey(key, value);
	return service;
}

function command(id: `prctr.${string}`, title = labels.alpha): MenuCommand {
	return { id, title };
}

void test('menu resolution preserves navigation/group/order/title sorting, context, toggles, alt, and invocation', async () => {
	const disposables = new DisposableStore();
	try {
		const service = new RecordingCommandService();
		const resolver = disposables.add(new MenuService(service, localization));
		const alpha = command('prctr.test.menuAlpha');
		const beta = command('prctr.test.menuBeta', labels.beta);
		const toggled = {
			...command('prctr.test.menuToggle'),
			toggled: {
				condition: ContextKeyExpr.equals('prctr.test.checked', true),
				title: labels.checked,
				icon: 'state.success' as const
			}
		};
		disposables.add(
			MenuRegistry.appendMenuItems([
				{ id: MenuId.EditorTitle, item: { command: beta, group: 'tools', order: 2 } },
				{
					id: MenuId.EditorTitle,
					item: { command: alpha, alt: beta, group: 'navigation', order: 2 }
				},
				{
					id: MenuId.EditorTitle,
					item: {
						command: toggled,
						group: 'tools',
						order: 1,
						when: ContextKeyExpr.has('prctr.test.visible')
					}
				}
			])
		);

		const groups = resolver.getMenuActions(
			MenuId.EditorTitle,
			context({ 'prctr.test.visible': true, 'prctr.test.checked': true }),
			{ args: ['fixed'], shouldForwardArgs: true }
		);
		assert.deepStrictEqual(
			groups.map(([group]) => group),
			['navigation', 'tools']
		);
		assert.deepStrictEqual(
			groups[1]?.[1].map((action) => action.label),
			['Checked', 'Beta']
		);
		const first = groups[0]?.[1][0];
		assert.strictEqual(first?.id, alpha.id);
		assert.ok(first !== undefined && 'alt' in first);
		assert.strictEqual(first.alt?.id, beta.id);
		await first?.run('dynamic');
		assert.deepStrictEqual(service.calls, [[alpha.id, 'fixed', 'dynamic']]);
	} finally {
		disposables.dispose();
	}
});

void test('submenus join groups with separators and hidden defaults can be overridden and reset', () => {
	const disposables = new DisposableStore();
	const visibility = disposables.add(new MenuVisibilityState());
	try {
		const resolver = disposables.add(
			new MenuService(new RecordingCommandService(), localization, visibility)
		);
		const alpha = command('prctr.test.subAlpha');
		const beta = command('prctr.test.subBeta', labels.beta);
		disposables.add(
			MenuRegistry.appendMenuItems([
				{ id: MenuId.WorkspaceContext, item: { command: alpha, group: 'navigation' } },
				{ id: MenuId.WorkspaceContext, item: { command: beta, group: 'tools' } },
				{
					id: MenuId.WorkbenchTitle,
					item: {
						submenu: MenuId.WorkspaceContext,
						title: labels.submenu,
						group: 'navigation'
					}
				},
				{
					id: MenuId.WorkbenchTitle,
					item: { command: command('prctr.test.hidden'), isHiddenByDefault: true }
				}
			])
		);
		let groups = resolver.getMenuActions(MenuId.WorkbenchTitle, context());
		const submenu = groups[0]?.[1][0];
		assert.ok(submenu instanceof ResolvedSubmenuAction);
		assert.deepStrictEqual(
			submenu.actions.map((action) => action.id),
			[alpha.id, 'vs.actions.separator', beta.id]
		);
		assert.strictEqual(
			groups
				.flatMap(([, actions]) => actions)
				.some((action) => action.id === 'prctr.test.hidden'),
			false
		);
		visibility.setHidden(MenuId.WorkbenchTitle, 'prctr.test.hidden', false);
		groups = resolver.getMenuActions(MenuId.WorkbenchTitle, context());
		assert.strictEqual(
			groups
				.flatMap(([, actions]) => actions)
				.some((action) => action.id === 'prctr.test.hidden'),
			true
		);
		visibility.reset(MenuId.WorkbenchTitle);
		assert.strictEqual(
			resolver
				.getMenuActions(MenuId.WorkbenchTitle, context())
				.flatMap(([, actions]) => actions)
				.some((action) => action.id === 'prctr.test.hidden'),
			false
		);
	} finally {
		disposables.dispose();
	}
});

void test('command palette includes registered implicit commands and registry changes are microtask-batched', async () => {
	const disposables = new DisposableStore();
	try {
		const events: number[] = [];
		disposables.add(
			MenuRegistry.onDidChangeMenu((event) =>
				events.push(event.has(MenuId.CommandPalette) ? 1 : 0)
			)
		);
		const alpha = command('prctr.test.paletteAlpha');
		const beta = command('prctr.test.paletteBeta', labels.beta);
		disposables.add(MenuRegistry.addCommand(alpha));
		disposables.add(MenuRegistry.addCommand(beta));
		await Promise.resolve();
		assert.deepStrictEqual(events, [1]);
		const actions = disposables
			.add(new MenuService(new RecordingCommandService(), localization))
			.getMenuActions(MenuId.CommandPalette, context())
			.flatMap(([, group]) => group);
		assert.ok(actions.some((action) => action.id === alpha.id));
		assert.ok(actions.some((action) => action.id === beta.id));
	} finally {
		disposables.dispose();
	}
});

void test('menu registration rejects non-namespaced commands and static labels with placeholders', () => {
	assert.throws(() =>
		MenuRegistry.addCommand({ id: 'foreign.command' as `prctr.${string}`, title: labels.alpha })
	);
	const dynamic = defineMessage({
		id: 'test.menu.dynamic',
		defaultMessage: 'Open {name}',
		description: 'Dynamic label.'
	});
	assert.throws(() => MenuRegistry.addCommand({ id: 'prctr.test.dynamic', title: dynamic }));
});

void test('invocation forwards only opted-in arguments, args take precedence, and short titles apply to alternates', async () => {
	const store = new DisposableStore();
	try {
		const commands = new RecordingCommandService();
		const service = store.add(new MenuService(commands, localization));
		const primary = { ...command('prctr.test.options'), shortTitle: labels.beta };
		const alt = { ...command('prctr.test.optionsAlt'), shortTitle: labels.checked };
		store.add(MenuRegistry.appendMenuItem(MenuId.Account, { command: primary, alt }));
		const cases: Array<[MenuActionOptions | undefined, unknown[]]> = [
			[undefined, []],
			[{ arg: 'fixed' }, ['fixed']],
			[{ arg: false }, []],
			[{ args: [false, 0, null], arg: 'ignored' }, [false, 0, null]],
			[{ args: [], arg: 'ignored' }, []],
			[{ shouldForwardArgs: true }, ['dynamic']],
			[{ args: ['fixed'], shouldForwardArgs: true }, ['fixed', 'dynamic']]
		];
		for (const [options, expected] of cases) {
			const action = service.getMenuActions(MenuId.Account, context(), options)[0]?.[1][0];
			assert.ok(action && 'alt' in action);
			await action.run('dynamic');
			await action.alt?.run('dynamic');
			assert.deepStrictEqual(commands.calls.splice(0), [
				[primary.id, ...expected],
				[alt.id, ...expected]
			]);
		}
		const short = service.getMenuActions(MenuId.Account, context(), {
			renderShortTitle: true
		})[0]?.[1][0];
		assert.ok(short && 'alt' in short);
		assert.strictEqual(short.label, 'Beta');
		assert.strictEqual(short.alt?.label, 'Checked');
	} finally {
		store.dispose();
	}
});

void test('live menus batch selective context changes, retain snapshots, and refresh registry structure', () =>
	runWithFakedTimers({}, async () => {
		const store = new DisposableStore();
		try {
			const keys = contexts.add(new ContextKeyService());
			const visible = keys.createKey<boolean>('prctr.test.visible', true);
			const enabled = keys.createKey<boolean>('prctr.test.enabled', true);
			const checked = keys.createKey<boolean>('prctr.test.checked', false);
			const unrelated = keys.createKey<boolean>('prctr.test.unrelated', false);
			store.add(
				MenuRegistry.appendMenuItem(MenuId.Account, {
					command: {
						...command('prctr.test.live'),
						precondition: ContextKeyExpr.has('prctr.test.enabled'),
						toggled: { condition: ContextKeyExpr.has('prctr.test.checked') }
					},
					when: ContextKeyExpr.has('prctr.test.visible')
				})
			);
			await Promise.resolve();
			const service = store.add(new MenuService(new RecordingCommandService(), localization));
			const menu = store.add(
				service.createMenu(MenuId.Account, keys, { eventDebounceDelay: 10 })
			);
			const events: MenuChangeEvent[] = [];
			store.add(menu.onDidChange((event) => events.push(event)));
			const initial = menu.getActions()[0]?.[1][0];
			unrelated.set(true);
			await timeout(30);
			assert.strictEqual(events.length, 0);
			enabled.set(false);
			checked.set(true);
			await timeout(30);
			assert.deepStrictEqual(
				events
					.splice(0)
					.map((event) => [
						event.menu === menu,
						event.isStructuralChange,
						event.isEnablementChange,
						event.isToggleChange
					]),
				[[true, false, true, true]]
			);
			assert.strictEqual(initial?.enabled, true);
			assert.strictEqual(initial?.checked, false);
			assert.strictEqual(menu.getActions()[0]?.[1][0]?.enabled, false);
			visible.set(false);
			await timeout(30);
			assert.deepStrictEqual(
				events
					.splice(0)
					.map((event) => [
						event.isStructuralChange,
						event.isEnablementChange,
						event.isToggleChange
					]),
				[[true, false, false]]
			);
			assert.deepStrictEqual(menu.getActions(), []);
			store.add(
				MenuRegistry.appendMenuItem(MenuId.Account, {
					command: command('prctr.test.added')
				})
			);
			await timeout(30);
			assert.deepStrictEqual(
				events
					.splice(0)
					.map((event) => [
						event.isStructuralChange,
						event.isEnablementChange,
						event.isToggleChange
					]),
				[[true, true, true]]
			);
			assert.strictEqual(menu.getActions()[0]?.[1][0]?.id, 'prctr.test.added');
			assert.deepStrictEqual([...service.getMenuContexts(MenuId.Account)].sort(), [
				'prctr.test.checked',
				'prctr.test.enabled',
				'prctr.test.visible'
			]);
		} finally {
			store.dispose();
		}
	}));

void test('unobserved menus do not subscribe to context; disposal cancels pending changes and rebuilds', () =>
	runWithFakedTimers({}, async () => {
		const store = new DisposableStore();
		try {
			const keys = contexts.add(new ContextKeyService());
			const enabled = keys.createKey<boolean>('prctr.test.lazy', true);
			let listeners = 0;
			const originalEvent = keys.onDidChangeContext;
			Object.defineProperty(keys, 'onDidChangeContext', {
				value: (listener: Parameters<typeof originalEvent>[0]) => {
					listeners++;
					const subscription = originalEvent(listener);
					return {
						dispose: () => {
							listeners--;
							subscription.dispose();
						}
					};
				}
			});
			store.add(
				MenuRegistry.appendMenuItem(MenuId.Account, {
					command: {
						...command('prctr.test.lazy'),
						precondition: ContextKeyExpr.has('prctr.test.lazy')
					}
				})
			);
			await Promise.resolve();
			const service = store.add(new MenuService(new RecordingCommandService(), localization));
			const menu = store.add(
				service.createMenu(MenuId.Account, keys, { eventDebounceDelay: 10 })
			);
			menu.getActions();
			assert.strictEqual(listeners, 0);
			let calls = 0;
			const listener = menu.onDidChange(() => calls++);
			assert.strictEqual(listeners, 1);
			listener.dispose();
			assert.strictEqual(listeners, 0);
			store.add(menu.onDidChange(() => calls++));
			enabled.set(false);
			store.add(
				MenuRegistry.appendMenuItem(MenuId.Account, {
					command: command('prctr.test.pending')
				})
			);
			await Promise.resolve();
			menu.dispose();
			assert.strictEqual(listeners, 0);
			await timeout(30);
			assert.strictEqual(calls, 0);
		} finally {
			store.dispose();
		}
	}));

void test('submenu registry, visibility, and alternate context invalidations honor subscription options', () =>
	runWithFakedTimers({}, async () => {
		const store = new DisposableStore();
		try {
			const keys = contexts.add(new ContextKeyService());
			const alternateEnabled = keys.createKey<boolean>('prctr.test.altEnabled', true);
			store.add(
				MenuRegistry.appendMenuItem(MenuId.Account, {
					submenu: MenuId.GlobalActivity,
					title: labels.submenu
				})
			);
			store.add(
				MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
					command: command('prctr.test.child'),
					alt: {
						...command('prctr.test.childAlt'),
						precondition: ContextKeyExpr.has('prctr.test.altEnabled')
					}
				})
			);
			await Promise.resolve();
			const service = store.add(new MenuService(new RecordingCommandService(), localization));
			const shallow = store.add(
				service.createMenu(MenuId.Account, keys, { eventDebounceDelay: 10 })
			);
			const deep = store.add(
				service.createMenu(MenuId.Account, keys, {
					eventDebounceDelay: 10,
					emitEventsForSubmenuChanges: true
				})
			);
			let shallowEvents = 0;
			const deepEvents: MenuChangeEvent[] = [];
			store.add(shallow.onDidChange(() => shallowEvents++));
			store.add(deep.onDidChange((event) => deepEvents.push(event)));
			alternateEnabled.set(false);
			await timeout(30);
			assert.strictEqual(deepEvents.splice(0)[0]?.isEnablementChange, true);
			service.visibility.setHidden(MenuId.GlobalActivity, 'prctr.test.child', true);
			await timeout(30);
			assert.strictEqual(deepEvents.splice(0)[0]?.isStructuralChange, true);
			assert.deepStrictEqual(deep.getActions(), []);
			store.add(
				MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
					command: command('prctr.test.newChild')
				})
			);
			await timeout(30);
			assert.strictEqual(deepEvents.splice(0).length, 1);
			assert.strictEqual(shallowEvents, 0);
		} finally {
			store.dispose();
		}
	}));

void test('visibility stores deviations from defaults and rejected batches roll back', () => {
	const store = new DisposableStore();
	try {
		const state = store.add(new MenuVisibilityState());
		state.setDefaultState(MenuId.Account, 'prctr.test.default', true);
		state.setHidden(MenuId.Account, 'prctr.test.default', false);
		assert.strictEqual(state.isHidden(MenuId.Account, 'prctr.test.default'), false);
		state.setDefaultState(MenuId.Account, 'prctr.test.default', false);
		assert.strictEqual(state.isHidden(MenuId.Account, 'prctr.test.default'), true);
		state.reset();
		assert.strictEqual(state.isHidden(MenuId.Account, 'prctr.test.default'), false);
		const before = MenuRegistry.getMenuItems(MenuId.Account);
		assert.throws(() =>
			MenuRegistry.appendMenuItems([
				{ id: MenuId.Account, item: { command: command('prctr.test.rollback') } },
				{
					id: MenuId.Account,
					item: { command: command('foreign.command' as `prctr.${string}`) }
				}
			])
		);
		assert.deepStrictEqual(MenuRegistry.getMenuItems(MenuId.Account), before);
		assert.throws(() =>
			MenuRegistry.appendMenuItem({ id: MenuId.Account.id } as MenuId, {
				command: command('prctr.test.forged')
			})
		);
	} finally {
		store.dispose();
	}
});

void test('submenu cycles fail without leaking temporary menu subscriptions', () => {
	const store = new DisposableStore();
	try {
		store.add(
			MenuRegistry.appendMenuItem(MenuId.Account, {
				submenu: MenuId.GlobalActivity,
				title: labels.submenu
			})
		);
		store.add(
			MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
				submenu: MenuId.Account,
				title: labels.submenu
			})
		);
		const service = store.add(new MenuService(new RecordingCommandService(), localization));
		assert.throws(() => service.getMenuActions(MenuId.Account, context()), /Menu cycle/);
		const menu = store.add(
			service.createMenu(MenuId.Account, context(), { emitEventsForSubmenuChanges: true })
		);
		assert.throws(() => menu.getActions(), /Menu cycle/);
	} finally {
		store.dispose();
	}
});

void test('upstream group and title/priority ordering includes falsy groups and fractional navigation order', () => {
	const store = new DisposableStore();
	try {
		const service = store.add(new MenuService(new RecordingCommandService(), localization));
		for (const [index, group] of ['0_hello', 'hello', 'Hello', '', 'navigation'].entries()) {
			store.add(
				MenuRegistry.appendMenuItem(MenuId.Account, {
					command: command(`prctr.test.group${index}`),
					group
				})
			);
		}
		assert.deepStrictEqual(
			service.getMenuActions(MenuId.Account, context()).map(([group]) => group),
			['navigation', '0_hello', 'hello', 'Hello', '']
		);
		for (const [index, order] of [1.3, 1.2, 1.1].entries()) {
			store.add(
				MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
					command: command(`prctr.test.priority${index}`),
					group: 'navigation',
					order
				})
			);
		}
		store.add(
			MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
				command: command('prctr.test.titleBeta', labels.beta),
				group: 'tools',
				order: -1
			})
		);
		store.add(
			MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
				command: command('prctr.test.titleAlpha'),
				group: 'tools',
				order: -1
			})
		);
		store.add(
			MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
				command: command('prctr.test.defaultOrder'),
				group: 'tools'
			})
		);
		const groups = service.getMenuActions(MenuId.GlobalActivity, context());
		assert.deepStrictEqual(
			groups[0]?.[1].map((action) => action.id),
			['prctr.test.priority2', 'prctr.test.priority1', 'prctr.test.priority0']
		);
		assert.deepStrictEqual(
			groups[1]?.[1].map((action) => action.id),
			['prctr.test.titleAlpha', 'prctr.test.titleBeta', 'prctr.test.defaultOrder']
		);
	} finally {
		store.dispose();
	}
});

void test('explicit palette entries and alternates suppress implicit duplicates', () => {
	const store = new DisposableStore();
	try {
		const primary = command('prctr.test.explicit');
		const alternate = command('prctr.test.explicitAlternate');
		store.add(MenuRegistry.addCommand(primary));
		store.add(MenuRegistry.addCommand(alternate));
		store.add(
			MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
				command: { ...primary, title: labels.beta },
				alt: alternate
			})
		);
		const items = MenuRegistry.getMenuItems(MenuId.CommandPalette).filter(
			(item) => 'command' in item && [primary.id, alternate.id].includes(item.command.id)
		);
		assert.strictEqual(items.length, 1);
		assert.ok(items[0] && 'command' in items[0]);
		assert.strictEqual(items[0].command.title, labels.beta);
	} finally {
		store.dispose();
	}
});

void test('localized descriptors retain upstream original-title ordering while displaying translated labels', () => {
	const store = new DisposableStore();
	try {
		const translated = createLocalization({
			requestedLocale: 'fr',
			messages: Object.values(labels),
			catalogs: [
				{
					locale: 'fr',
					direction: 'ltr',
					messages: {
						'test.menu.alpha': 'Zèbre',
						'test.menu.beta': 'Abeille'
					}
				}
			]
		});
		const service = store.add(new MenuService(new RecordingCommandService(), translated));
		store.add(
			MenuRegistry.appendMenuItem(MenuId.Account, {
				command: command('prctr.test.translatedBeta', labels.beta)
			})
		);
		store.add(
			MenuRegistry.appendMenuItem(MenuId.Account, {
				command: command('prctr.test.translatedAlpha')
			})
		);
		const actions = service.getMenuActions(MenuId.Account, context())[0]?.[1];
		assert.deepStrictEqual(
			actions?.map((action) => action.id),
			['prctr.test.translatedAlpha', 'prctr.test.translatedBeta']
		);
		assert.deepStrictEqual(
			actions?.map((action) => action.label),
			['Zèbre', 'Abeille']
		);
	} finally {
		store.dispose();
	}
});

void test('menu services dispose their default visibility state but do not dispose injected state', () => {
	const store = new DisposableStore();
	try {
		const borrowed = store.add(new MenuVisibilityState());
		const service = store.add(
			new MenuService(new RecordingCommandService(), localization, borrowed)
		);
		let changes = 0;
		store.add(borrowed.onDidChange(() => changes++));
		service.dispose();
		borrowed.setHidden(MenuId.Account, 'prctr.test.borrowed', true);
		assert.strictEqual(changes, 1);
		const owner = store.add(new MenuService(new RecordingCommandService(), localization));
		store.add(owner.visibility.onDidChange(() => changes++));
		owner.dispose();
		owner.visibility.setHidden(MenuId.Account, 'prctr.test.owned', true);
		assert.strictEqual(changes, 1);
	} finally {
		store.dispose();
	}
});
