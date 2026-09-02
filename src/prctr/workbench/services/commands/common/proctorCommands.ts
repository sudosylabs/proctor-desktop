import type { IDisposable } from '../../../../base/common/lifecycle.js';
import {
	CommandsRegistry,
	type ICommand,
	type ICommandHandler
} from '../../../../platform/commands/common/commands.js';

export type ProctorCommandId = `prctr.${string}`;

function assertProctorCommandId(id: string): asserts id is ProctorCommandId {
	if (!/^prctr\.[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/u.test(id)) {
		throw new TypeError(`Product command identifiers must use the prctr namespace: ${id}`);
	}
}

export const ProctorCommands = Object.freeze({
	register<Args extends unknown[]>(id: ProctorCommandId, handler: ICommandHandler<Args>): IDisposable {
		assertProctorCommandId(id);
		return CommandsRegistry.registerCommand(id, handler);
	},

	registerCommand<Args extends unknown[]>(command: ICommand<Args> & { readonly id: ProctorCommandId }): IDisposable {
		assertProctorCommandId(command.id);
		return CommandsRegistry.registerCommand(command);
	}
});
