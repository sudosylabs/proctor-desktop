import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import {
	isDebuggingArgument,
	refusedDebuggingSwitch
} from '../../../../src/prctr/platform/environment/electron-main/debuggingSwitches.ts';

suite('debugging switches', () => {
	const launch = (built: boolean, switches: readonly string[], argv: readonly string[] = []) => ({
		built,
		argv,
		hasSwitch: (name: string) => switches.includes(name)
	});

	test('an installed build refuses remote debugging', () => {
		assert.strictEqual(
			refusedDebuggingSwitch(launch(true, ['remote-debugging-port'])),
			'--remote-debugging-port'
		);
		assert.strictEqual(
			refusedDebuggingSwitch(launch(true, ['remote-debugging-pipe'])),
			'--remote-debugging-pipe'
		);
		assert.strictEqual(
			refusedDebuggingSwitch(launch(true, ['auto-open-devtools-for-tabs'])),
			'--auto-open-devtools-for-tabs'
		);
	});

	test("an installed build refuses Node's inspector", () => {
		for (const argument of [
			'--inspect',
			'--inspect=9229',
			'--inspect-brk',
			'--inspect-port=1'
		]) {
			assert.strictEqual(
				refusedDebuggingSwitch(launch(true, [], ['/Applications/Proctor', argument])),
				argument.split('=')[0]
			);
		}
		assert.strictEqual(
			refusedDebuggingSwitch(
				launch(true, [], ['/Applications/Proctor', '--inspector-shaped'])
			),
			undefined
		);
	});

	test('an installed build without debugging switches starts', () => {
		assert.strictEqual(
			refusedDebuggingSwitch(launch(true, ['lang'], ['/Applications/Proctor'])),
			undefined
		);
	});

	test('debugging arguments are told apart from other arguments', () => {
		for (const argument of [
			'--remote-debugging-port=9222',
			'--remote-debugging-address=127.0.0.1',
			'--remote-debugging-pipe',
			'--auto-open-devtools-for-tabs',
			'--inspect',
			'--inspect-brk=9229'
		])
			assert.strictEqual(isDebuggingArgument(argument), true, argument);
		for (const argument of [
			'--allow-http-loopback',
			'--release',
			'--remote-debugging-portal',
			'--inspector-shaped',
			'remote-debugging-port'
		])
			assert.strictEqual(isDebuggingArgument(argument), false, argument);
	});

	test('a source checkout keeps its debugging switches', () => {
		assert.strictEqual(
			refusedDebuggingSwitch(
				launch(false, ['remote-debugging-port'], ['electron', '--inspect'])
			),
			undefined
		);
	});
});
