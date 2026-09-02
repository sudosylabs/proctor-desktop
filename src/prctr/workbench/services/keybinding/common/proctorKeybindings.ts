import type { IDisposable } from '../../../../base/common/lifecycle.js';
import {
	KeybindingsRegistry,
	type ICommandAndKeybindingRule,
	type IKeybindingRule
} from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import type { ProctorCommandId } from '../../commands/common/proctorCommands.js';

function assertProductCommand(id: string): asserts id is ProctorCommandId {
	if (!/^prctr\.[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/u.test(id)) {
		throw new TypeError(`Keybindings may target only namespaced product commands: ${id}`);
	}
}

export const ProctorKeybindings = Object.freeze({
	registerRule(rule: IKeybindingRule & { readonly id: ProctorCommandId }): IDisposable {
		assertProductCommand(rule.id);
		return KeybindingsRegistry.registerKeybindingRule(rule);
	},

	registerCommandAndKeybinding<Args extends unknown[]>(
		rule: ICommandAndKeybindingRule<Args> & { readonly id: ProctorCommandId }
	): IDisposable {
		assertProductCommand(rule.id);
		return KeybindingsRegistry.registerCommandAndKeybindingRule(rule);
	}
});
