import assert from 'node:assert';
import { test } from 'node:test';

import { defineMessage } from '../../../../../src/prctr/base/common/localization.ts';
import { CommandsRegistry } from '../../../../../src/prctr/platform/commands/common/commands.ts';
import { MenuId, MenuRegistry } from '../../../../../src/prctr/platform/actions/common/menu.ts';
import { KeybindingsRegistry } from '../../../../../src/prctr/platform/keybinding/common/keybindingsRegistry.ts';
import { registerProctorAction } from '../../../../../src/prctr/workbench/services/actions/common/proctorActions.ts';

test('one Proctor action contribution owns command, menus, palette, keybindings, and disposal', () => {
	const id = 'prctr.test.contributedAction';
	const registration = registerProctorAction({
		command: {
			id,
			title: defineMessage({ id: 'test.action.contributed', defaultMessage: 'Contributed', description: 'Contributed action.' }),
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
		assert.ok(MenuRegistry.getMenuItems(MenuId.EditorTitle).some(item => 'command' in item && item.command.id === id));
		assert.ok(MenuRegistry.getMenuItems(MenuId.CommandPalette).some(item => 'command' in item && item.command.id === id));
		assert.ok(KeybindingsRegistry.getDefaultKeybindings().some(item => item.command === id));
	} finally {
		registration.dispose();
	}
	assert.strictEqual(CommandsRegistry.getCommand(id), undefined);
	assert.strictEqual(MenuRegistry.getCommand(id), undefined);
	assert.strictEqual(MenuRegistry.getMenuItems(MenuId.EditorTitle).some(item => 'command' in item && item.command.id === id), false);
	assert.strictEqual(KeybindingsRegistry.getDefaultKeybindings().some(item => item.command === id), false);
});
