import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import { refusedDebuggingSwitch } from '../../../../src/prctr/platform/environment/electron-main/debuggingSwitches.ts';

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

	test('a source checkout keeps its debugging switches', () => {
		assert.strictEqual(
			refusedDebuggingSwitch(
				launch(false, ['remote-debugging-port'], ['electron', '--inspect'])
			),
			undefined
		);
	});
});
