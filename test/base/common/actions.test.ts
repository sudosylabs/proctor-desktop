import assert from 'node:assert';

import { Action, ActionRunner, Separator, SubmenuAction, toAction } from '../../../src/prctr/base/common/actions.ts';
import { suite, test } from './upstream/testAdapter.ts';

suite('Actions', () => {
	test('Action publishes only changed state and runs its callback', async () => {
		const seen: unknown[] = [];
		const action = new Action('prctr.test', 'Initial', '', true, value => seen.push(value));
		action.onDidChange(event => seen.push(event));
		action.label = 'Updated';
		action.label = 'Updated';
		action.enabled = false;
		action.checked = true;
		await action.run('context');
		assert.deepStrictEqual(seen, [
			{ label: 'Updated' }, { enabled: false }, { checked: true }, 'context'
		]);
		action.dispose();
	});

	test('ActionRunner orders events, skips disabled actions, and reports failures', async () => {
		const runner = new ActionRunner();
		const events: string[] = [];
		runner.onWillRun(event => events.push(`will:${event.action.id}`));
		runner.onDidRun(event => events.push(`did:${event.action.id}:${event.error?.message ?? 'ok'}`));
		await runner.run(toAction({ id: 'disabled', label: 'Disabled', enabled: false, run: () => events.push('bad') }));
		await runner.run(toAction({ id: 'success', label: 'Success', run: (value: unknown) => events.push(String(value)) }), 'context');
		await runner.run(toAction({ id: 'failure', label: 'Failure', run: () => { throw new Error('boom'); } }));
		assert.deepStrictEqual(events, ['will:success', 'context', 'did:success:ok', 'will:failure', 'did:failure:boom']);
		runner.dispose();
	});

	test('separator cleanup, joining, and submenu composition are deterministic', () => {
		const first = toAction({ id: 'first', label: 'First', run() { } });
		const second = toAction({ id: 'second', label: 'Second', run() { } });
		assert.deepStrictEqual(Separator.join([], [first], [], [second]).map(action => action.id), ['first', Separator.ID, 'second']);
		const dirty = [new Separator(), first, new Separator(), new Separator(), second, new Separator()];
		assert.deepStrictEqual(Separator.clean(dirty).map(action => action.id), ['first', Separator.ID, 'second']);
		assert.deepStrictEqual(new SubmenuAction('submenu', 'Submenu', [first, second]).actions, [first, second]);
	});
});
