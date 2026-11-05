import assert from 'node:assert';
import { test } from 'node:test';

import { defineMessage } from '../../../../../src/prctr/base/common/localization.ts';
import { CommandsRegistry } from '../../../../../src/prctr/platform/commands/common/commands.ts';
import { MenuId, MenuRegistry } from '../../../../../src/prctr/platform/actions/common/menu.ts';
import { KeybindingsRegistry } from '../../../../../src/prctr/platform/keybinding/common/keybindingsRegistry.ts';
import { ContextKeyExpr } from '../../../../../src/prctr/platform/contextkey/common/contextkey.ts';
import { ContextKeyService } from '../../../../../src/prctr/platform/contextkey/browser/contextKeyService.ts';
import { registerProctorAction } from '../../../../../src/prctr/workbench/services/actions/common/proctorActions.ts';
import { DisposableStore } from '../../../../../src/prctr/base/common/lifecycle.ts';
import { InstantiationService } from '../../../../../src/prctr/platform/instantiation/common/instantiationService.ts';
import { CommandService } from '../../../../../src/prctr/workbench/services/commands/common/commandService.ts';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/common/upstream/upstreamTestUtils.ts';

ensureNoDisposablesAreLeakedInTestSuite();

void test('one Proctor action contribution owns command, menus, palette, keybindings, and disposal', () => {
	const id = 'prctr.test.contributedAction';
	const registration = registerProctorAction({
		command: {
			id,
			title: defineMessage({
				id: 'test.action.contributed',
				defaultMessage: 'Contributed',
				description: 'Contributed action.'
			}),
			icon: 'action.save'
		},
		handler: () => undefined,
		commandPalette: true,
		menus: [{ id: MenuId.EditorTitle, group: 'navigation', order: 1 }],
		keybindings: [{ primary: 2048 | 49, weight: 100 }]
	});
	try {
		assert.ok(CommandsRegistry.getCommand(id));
		assert.ok(MenuRegistry.getCommand(id));
		assert.ok(
			MenuRegistry.getMenuItems(MenuId.EditorTitle).some(
				(item) => 'command' in item && item.command.id === id
			)
		);
		assert.ok(
			MenuRegistry.getMenuItems(MenuId.CommandPalette).some(
				(item) => 'command' in item && item.command.id === id
			)
		);
		assert.ok(KeybindingsRegistry.getDefaultKeybindings().some((item) => item.command === id));
	} finally {
		registration.dispose();
	}
	assert.strictEqual(CommandsRegistry.getCommand(id), undefined);
	assert.strictEqual(MenuRegistry.getCommand(id), undefined);
	assert.strictEqual(
		MenuRegistry.getMenuItems(MenuId.EditorTitle).some(
			(item) => 'command' in item && item.command.id === id
		),
		false
	);
	assert.strictEqual(
		KeybindingsRegistry.getDefaultKeybindings().some((item) => item.command === id),
		false
	);
});

for (const commandPalette of [false, undefined]) {
	void test(`palette membership is opt-in (${String(commandPalette)})`, () => {
		const id = 'prctr.test.privateAction';
		const registration = registerProctorAction({
			command: {
				id,
				title: defineMessage({
					id: 'test.action.private',
					defaultMessage: 'Private',
					description: 'Private action.'
				})
			},
			handler: () => undefined,
			commandPalette,
			menus: [{ id: MenuId.Account }]
		});
		try {
			assert.ok(CommandsRegistry.getCommand(id));
			assert.strictEqual(MenuRegistry.getCommand(id), undefined);
			assert.strictEqual(
				MenuRegistry.getMenuItems(MenuId.CommandPalette).some(
					(item) => 'command' in item && item.command.id === id
				),
				false
			);
			assert.ok(
				MenuRegistry.getMenuItems(MenuId.Account).some(
					(item) => 'command' in item && item.command.id === id
				)
			);
		} finally {
			registration.dispose();
		}
	});
}

void test('action preconditions constrain every keybinding in addition to its own when clause', () => {
	const context = new ContextKeyService();
	const ready = context.createKey<boolean>('prctr.test.ready', false);
	const focused = context.createKey<boolean>('prctr.test.focused', false);
	const id = 'prctr.test.guardedAction';
	const registration = registerProctorAction({
		command: {
			id,
			title: defineMessage({
				id: 'test.action.guarded',
				defaultMessage: 'Guarded',
				description: 'Guarded action.'
			}),
			precondition: ContextKeyExpr.has('prctr.test.ready')
		},
		handler: () => undefined,
		keybindings: [
			{ primary: 2048 | 49, weight: 100, when: ContextKeyExpr.has('prctr.test.focused') },
			{ primary: 2048 | 50, weight: 100 }
		]
	});
	try {
		const rules = KeybindingsRegistry.getDefaultKeybindings().filter(
			(item) => item.command === id
		);
		assert.strictEqual(rules.length, 2);
		assert.ok(rules.every((rule) => !context.contextMatchesRules(rule.when ?? undefined)));
		ready.set(true);
		assert.strictEqual(
			rules.filter((rule) => context.contextMatchesRules(rule.when ?? undefined)).length,
			1
		);
		focused.set(true);
		assert.ok(rules.every((rule) => context.contextMatchesRules(rule.when ?? undefined)));
		ready.set(false);
		assert.ok(rules.every((rule) => !context.contextMatchesRules(rule.when ?? undefined)));
	} finally {
		registration.dispose();
		context.dispose();
	}
});

void test('a failed contribution removes earlier command and menu registrations', () => {
	const id = 'prctr.test.failedAction';
	assert.throws(() =>
		registerProctorAction({
			command: {
				id,
				title: defineMessage({
					id: 'test.action.failed',
					defaultMessage: 'Failed',
					description: 'Failed action.'
				})
			},
			handler: () => undefined,
			menus: [{ id: MenuId.Account }, { id: { id: MenuId.Account.id } as MenuId }],
			commandPalette: true
		})
	);
	assert.strictEqual(CommandsRegistry.getCommand(id), undefined);
	assert.strictEqual(MenuRegistry.getCommand(id), undefined);
	assert.strictEqual(
		MenuRegistry.getMenuItems(MenuId.Account).some(
			(item) => 'command' in item && item.command.id === id
		),
		false
	);
});

void test('duplicate actions cannot shadow a command even when neither is in the palette', () => {
	const action = {
		command: {
			id: 'prctr.test.uniqueAction' as const,
			title: defineMessage({
				id: 'test.action.unique',
				defaultMessage: 'Unique',
				description: 'Unique action.'
			})
		},
		handler: () => undefined
	};
	const registration = registerProctorAction(action);
	try {
		const original = CommandsRegistry.getCommand(action.command.id);
		assert.throws(() => registerProctorAction(action), /two actions/);
		assert.strictEqual(CommandsRegistry.getCommand(action.command.id), original);
	} finally {
		registration.dispose();
	}
});

void test('action metadata validates arguments and menu-only enablement overrides do not weaken keybindings', async () => {
	const store = new DisposableStore();
	try {
		const service = store.add(new CommandService(store.add(new InstantiationService())));
		const keys = store.add(new ContextKeyService());
		const id = 'prctr.test.validatedAction';
		const metadata = {
			description: 'Validation contract',
			args: [{ name: 'value', constraint: 'number' as const }]
		};
		let value: number | undefined;
		store.add(
			registerProctorAction({
				command: {
					id,
					title: defineMessage({
						id: 'test.action.validated',
						defaultMessage: 'Validated',
						description: 'Validated action.'
					}),
					precondition: ContextKeyExpr.has('prctr.test.ready'),
					metadata
				},
				handler: (_accessor, input: number) => {
					value = input;
				},
				menus: [{ id: MenuId.Account, precondition: null }],
				keybindings: [{ primary: 2048 | 49, weight: 100 }]
			})
		);
		assert.strictEqual(CommandsRegistry.getCommand(id)?.metadata, metadata);
		await assert.rejects(service.executeCommand(id, 'invalid'));
		assert.strictEqual(value, undefined);
		await service.executeCommand(id, 42);
		assert.strictEqual(value, 42);
		const item = MenuRegistry.getMenuItems(MenuId.Account).find(
			(item) => 'command' in item && item.command.id === id
		);
		assert.ok(item && 'command' in item);
		assert.strictEqual(item.command.precondition, undefined);
		const binding = KeybindingsRegistry.getDefaultKeybindings().find(
			(item) => item.command === id
		);
		assert.ok(binding);
		assert.strictEqual(keys.contextMatchesRules(binding.when ?? undefined), false);
	} finally {
		store.dispose();
	}
});
