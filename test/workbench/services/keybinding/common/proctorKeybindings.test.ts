import assert from 'node:assert';
import { test } from 'node:test';
import { KeyCode, KeyMod } from '../../../../../src/prctr/base/common/keyCodes.ts';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../../src/prctr/platform/keybinding/common/keybindingsRegistry.ts';
import { ProctorKeybindings } from '../../../../../src/prctr/workbench/services/keybinding/common/proctorKeybindings.ts';

test('product keybindings are static, namespaced, ordered, and disposable', () => {
	const before = KeybindingsRegistry.getDefaultKeybindings().length;
	const registration = ProctorKeybindings.registerRule({
		id: 'prctr.test.keybinding',
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.CtrlCmd | KeyCode.KeyK
	});
	const after = KeybindingsRegistry.getDefaultKeybindings();
	assert.strictEqual(after.length, before + 1);
	assert.strictEqual(after.at(-1)?.command, 'prctr.test.keybinding');
	registration.dispose();
	assert.strictEqual(KeybindingsRegistry.getDefaultKeybindings().length, before);
	assert.throws(() => ProctorKeybindings.registerRule({
		id: 'foreign.command' as never,
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyCode.F1
	}));
});
