/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port actions-menus

import { DisposableStore, type IDisposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry, type ICommandHandler } from '../../../../platform/commands/common/commands.js';
import {
	MenuRegistry,
	MenuId,
	type MenuCommand,
	type MenuItem,
	type ProctorMenuId
} from '../../../../platform/actions/common/menu.js';
import type { IKeybindingRule } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ProctorCommands, type ProctorCommandId } from '../../commands/common/proctorCommands.js';
import { ProctorKeybindings } from '../../keybinding/common/proctorKeybindings.js';

export interface ProctorActionMenuPlacement extends Omit<MenuItem, 'command'> {
	readonly id: ProctorMenuId;
	readonly precondition?: null;
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
	if (CommandsRegistry.getCommand(contribution.command.id)) {
		throw new Error(`Cannot register two actions with the same command id: ${contribution.command.id}`);
	}
	const result = new DisposableStore();
	try {
		result.add(ProctorCommands.registerCommand({
			id: contribution.command.id,
			handler: contribution.handler,
			metadata: contribution.command.metadata ?? { description: contribution.command.title.defaultMessage }
		}));
		for (const placement of contribution.menus ?? []) {
			const { id, precondition, ...item } = placement;
			const command = precondition === null ? { ...contribution.command, precondition: undefined } : contribution.command;
			result.add(MenuRegistry.appendMenuItem(id, { ...item, command }));
		}
		if (contribution.commandPalette === true) {
			result.add(MenuRegistry.addCommand(contribution.command));
			result.add(
				MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
					command: contribution.command,
					when: contribution.command.precondition
				})
			);
		}
		for (const keybinding of contribution.keybindings ?? []) {
			result.add(
				ProctorKeybindings.registerRule({
					...keybinding,
					id: contribution.command.id,
					when: contribution.command.precondition
						? ContextKeyExpr.and(contribution.command.precondition, keybinding.when)
						: keybinding.when
				})
			);
		}
		return result;
	} catch (error) {
		result.dispose();
		throw error;
	}
}
