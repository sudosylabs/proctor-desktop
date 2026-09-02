import assert from 'node:assert';
import { test } from 'node:test';
import { DisposableStore } from '../../../../../src/prctr/base/common/lifecycle.ts';
import { CommandsRegistry } from '../../../../../src/prctr/platform/commands/common/commands.ts';
import { InstantiationService } from '../../../../../src/prctr/platform/instantiation/common/instantiationService.ts';
import { CommandService } from '../../../../../src/prctr/workbench/services/commands/common/commandService.ts';
import { ProctorCommands } from '../../../../../src/prctr/workbench/services/commands/common/proctorCommands.ts';

void test('command execution is synchronous through invocation and emits ordered events', async () => {
	const store = new DisposableStore();
	const service = store.add(new CommandService(new InstantiationService()));
	const order: string[] = [];
	store.add(service.onWillExecuteCommand((event) => order.push(`will:${event.commandId}`)));
	store.add(service.onDidExecuteCommand((event) => order.push(`did:${event.commandId}`)));
	store.add(
		ProctorCommands.register('prctr.test.execute', (_accessor, value: number) => {
			order.push(`handler:${value}`);
			return value * 2;
		})
	);

	const promise = service.executeCommand<number>('prctr.test.execute', 21);
	order.push('after-call');
	assert.strictEqual(await promise, 42);
	assert.deepStrictEqual(order, [
		'will:prctr.test.execute',
		'handler:21',
		'did:prctr.test.execute',
		'after-call'
	]);
	await assert.rejects(service.executeCommand('prctr.test.missing'), /not found/u);
	assert.throws(() => ProctorCommands.register('invalid.command' as never, () => undefined));
	store.dispose();
});

void test('registry stacking restores the prior product command when an override is disposed', () => {
	const first = ProctorCommands.register('prctr.test.stack', () => 'first');
	const second = ProctorCommands.register('prctr.test.stack', () => 'second');
	assert.strictEqual(
		CommandsRegistry.getCommand('prctr.test.stack')?.handler(undefined as never),
		'second'
	);
	second.dispose();
	assert.strictEqual(
		CommandsRegistry.getCommand('prctr.test.stack')?.handler(undefined as never),
		'first'
	);
	first.dispose();
});
