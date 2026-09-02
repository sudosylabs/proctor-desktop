/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, type IDisposable } from '../../../../base/common/lifecycle.js';
import type { ICommandHandler } from '../../../../platform/commands/common/commands.js';
import {
	MenuRegistry,
	MenuId,
	type MenuCommand,
	type MenuItem,
	type ProctorMenuId
} from '../../../../platform/actions/common/menu.js';
import type { IKeybindingRule } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ProctorCommands, type ProctorCommandId } from '../../commands/common/proctorCommands.js';
import { ProctorKeybindings } from '../../keybinding/common/proctorKeybindings.js';

export interface ProctorActionMenuPlacement extends Omit<MenuItem, 'command'> {
	readonly id: ProctorMenuId;
}

export interface ProctorActionContribution<Args extends unknown[] = unknown[]> {
	readonly command: MenuCommand & { readonly id: ProctorCommandId };
	readonly handler: ICommandHandler<Args>;
	readonly menus?: readonly ProctorActionMenuPlacement[];
	readonly keybindings?: readonly Omit<IKeybindingRule, 'id'>[];
	readonly commandPalette?: boolean;
}

export function registerProctorAction<Args extends unknown[]>(
	contribution: ProctorActionContribution<Args>
): IDisposable {
	const result = new DisposableStore();
	try {
		result.add(ProctorCommands.register(contribution.command.id, contribution.handler));
		result.add(MenuRegistry.addCommand(contribution.command));
		for (const placement of contribution.menus ?? []) {
			const { id, ...item } = placement;
			result.add(MenuRegistry.appendMenuItem(id, { ...item, command: contribution.command }));
		}
		if (contribution.commandPalette === true) {
			result.add(
				MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
					command: contribution.command,
					when: contribution.command.precondition
				})
			);
		}
		for (const keybinding of contribution.keybindings ?? []) {
			result.add(
				ProctorKeybindings.registerRule({ ...keybinding, id: contribution.command.id })
			);
		}
		return result;
	} catch (error) {
		result.dispose();
		throw error;
	}
}
