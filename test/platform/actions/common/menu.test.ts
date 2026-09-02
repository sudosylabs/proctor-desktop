import assert from 'node:assert';
import { test } from 'node:test';

import { Emitter } from '../../../../src/prctr/base/common/event.ts';
import { createLocalization, defineMessage } from '../../../../src/prctr/base/common/localization.ts';
import { DisposableStore } from '../../../../src/prctr/base/common/lifecycle.ts';
import {
	MenuId,
	MenuRegistry,
	MenuService,
	MenuVisibilityState,
	ResolvedSubmenuAction,
	type MenuCommand
} from '../../../../src/prctr/platform/actions/common/menu.ts';
import type { ICommandEvent, ICommandService } from '../../../../src/prctr/platform/commands/common/commands.ts';
import { ContextKeyExpr, type ContextKeyValue, type IContext } from '../../../../src/prctr/platform/contextkey/common/contextkey.ts';

const labels = {
	alpha: defineMessage({ id: 'test.menu.alpha', defaultMessage: 'Alpha', description: 'Alpha command.' }),
	beta: defineMessage({ id: 'test.menu.beta', defaultMessage: 'Beta', description: 'Beta command.' }),
	checked: defineMessage({ id: 'test.menu.checked', defaultMessage: 'Checked', description: 'Checked command.' }),
	submenu: defineMessage({ id: 'test.menu.submenu', defaultMessage: 'Submenu', description: 'Submenu title.' })
};
const localization = createLocalization({ requestedLocale: 'en', messages: Object.values(labels) });

class RecordingCommandService implements ICommandService {
	declare readonly _serviceBrand: undefined;
	private readonly willEmitter = new Emitter<ICommandEvent>();
	private readonly didEmitter = new Emitter<ICommandEvent>();
	readonly onWillExecuteCommand = this.willEmitter.event;
	readonly onDidExecuteCommand = this.didEmitter.event;
	readonly calls: Array<readonly unknown[]> = [];
	async executeCommand<R>(commandId: string, ...args: unknown[]): Promise<R | undefined> {
		this.calls.push([commandId, ...args]);
		return undefined;
	}
}

function context(values: Readonly<Record<string, ContextKeyValue>> = {}): IContext {
	return { getValue<T extends ContextKeyValue>(key: string): T | undefined { return values[key] as T | undefined; } };
}

function command(id: `prctr.${string}`, title = labels.alpha): MenuCommand {
	return { id, title };
}

test('menu resolution preserves navigation/group/order/title sorting, context, toggles, alt, and invocation', async () => {
	const disposables = new DisposableStore();
	try {
		const service = new RecordingCommandService();
		const resolver = new MenuService(service, localization);
		const alpha = command('prctr.test.menuAlpha');
		const beta = command('prctr.test.menuBeta', labels.beta);
		const toggled = {
			...command('prctr.test.menuToggle'),
			toggled: { condition: ContextKeyExpr.equals('prctr.test.checked', true), title: labels.checked, icon: 'state.success' as const }
		};
		disposables.add(MenuRegistry.appendMenuItems([
			{ id: MenuId.EditorTitle, item: { command: beta, group: 'tools', order: 2 } },
			{ id: MenuId.EditorTitle, item: { command: alpha, alt: beta, group: 'navigation', order: 2 } },
			{ id: MenuId.EditorTitle, item: { command: toggled, group: 'tools', order: 1, when: ContextKeyExpr.has('prctr.test.visible') } }
		]));

		const groups = resolver.getActions(MenuId.EditorTitle, context({ 'prctr.test.visible': true, 'prctr.test.checked': true }), ['fixed']);
		assert.deepStrictEqual(groups.map(([group]) => group), ['navigation', 'tools']);
		assert.deepStrictEqual(groups[1]?.[1].map(action => action.label), ['Checked', 'Beta']);
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

test('submenus join groups with separators and hidden defaults can be overridden and reset', () => {
	const disposables = new DisposableStore();
	const visibility = disposables.add(new MenuVisibilityState());
	try {
		const resolver = new MenuService(new RecordingCommandService(), localization, visibility);
		const alpha = command('prctr.test.subAlpha');
		const beta = command('prctr.test.subBeta', labels.beta);
		disposables.add(MenuRegistry.appendMenuItems([
			{ id: MenuId.WorkspaceContext, item: { command: alpha, group: 'navigation' } },
			{ id: MenuId.WorkspaceContext, item: { command: beta, group: 'tools' } },
			{ id: MenuId.WorkbenchTitle, item: { submenu: MenuId.WorkspaceContext, title: labels.submenu, group: 'navigation' } },
			{ id: MenuId.WorkbenchTitle, item: { command: command('prctr.test.hidden'), isHiddenByDefault: true } }
		]));
		let groups = resolver.getActions(MenuId.WorkbenchTitle, context());
		const submenu = groups[0]?.[1][0];
		assert.ok(submenu instanceof ResolvedSubmenuAction);
		assert.deepStrictEqual(submenu.actions.map(action => action.id), [alpha.id, 'vs.actions.separator', beta.id]);
		assert.strictEqual(groups.flatMap(([, actions]) => actions).some(action => action.id === 'prctr.test.hidden'), false);
		visibility.setHidden(MenuId.WorkbenchTitle, 'prctr.test.hidden', false);
		groups = resolver.getActions(MenuId.WorkbenchTitle, context());
		assert.strictEqual(groups.flatMap(([, actions]) => actions).some(action => action.id === 'prctr.test.hidden'), true);
		visibility.reset(MenuId.WorkbenchTitle);
		assert.strictEqual(resolver.getActions(MenuId.WorkbenchTitle, context()).flatMap(([, actions]) => actions).some(action => action.id === 'prctr.test.hidden'), false);
	} finally {
		disposables.dispose();
	}
});

test('command palette includes registered implicit commands and registry changes are microtask-batched', async () => {
	const disposables = new DisposableStore();
	try {
		const events: number[] = [];
		disposables.add(MenuRegistry.onDidChangeMenu(event => events.push(event.has(MenuId.CommandPalette) ? 1 : 0)));
		const alpha = command('prctr.test.paletteAlpha');
		const beta = command('prctr.test.paletteBeta', labels.beta);
		disposables.add(MenuRegistry.addCommand(alpha));
		disposables.add(MenuRegistry.addCommand(beta));
		await Promise.resolve();
		assert.deepStrictEqual(events, [1]);
		const actions = new MenuService(new RecordingCommandService(), localization).getActions(MenuId.CommandPalette, context()).flatMap(([, group]) => group);
		assert.ok(actions.some(action => action.id === alpha.id));
		assert.ok(actions.some(action => action.id === beta.id));
	} finally {
		disposables.dispose();
	}
});

test('menu registration rejects non-namespaced commands and static labels with placeholders', () => {
	assert.throws(() => MenuRegistry.addCommand({ id: 'foreign.command' as `prctr.${string}`, title: labels.alpha }));
	const dynamic = defineMessage({ id: 'test.menu.dynamic', defaultMessage: 'Open {name}', description: 'Dynamic label.' });
	assert.throws(() => MenuRegistry.addCommand({ id: 'prctr.test.dynamic', title: dynamic }));
});
