import assert from 'node:assert';
import { test } from '../../base/common/upstream/testAdapter.ts';
import { Event } from '../../../src/prctr/base/common/event.ts';
import { WorkbenchContentModel, WorkbenchGroupModel } from '../../../src/prctr/workbench/common/contentGroups.ts';
import type { WorkbenchItem } from '../../../src/prctr/workbench/common/workbenchItem.ts';

const item = (id: string, closable = true): WorkbenchItem => ({ typeId: 'test', logicalIdentity: id, presentation: { title: id, accessibleLabel: id }, closable, restorable: true, onDidChangePresentation: Event.None, matches: other => other.typeId === 'test' && other.logicalIdentity === id });
test('groups deduplicate identity, retain history, honor close capability and split policy', () => {
	const content = new WorkbenchContentModel(2, new Set(['horizontal'])); const first = content.groups[0]; if (first === undefined) throw new Error('missing first group');
	const a = first.open(item('a')); first.open(item('b')); assert.strictEqual(first.open(item('a')), a); assert.deepStrictEqual(first.history.map(value => value.logicalIdentity), ['a', 'b']);
	const fixed = first.open(item('fixed', false)); assert.strictEqual(first.close(fixed), false); assert.strictEqual(first.close(fixed, true), true);
	const second = content.split(first, 'horizontal'); assert.strictEqual(content.groups.length, 2); assert.throws(() => content.split(second, 'horizontal'), /limit/u); assert.throws(() => content.remove(new WorkbenchGroupModel()), /does not belong/u); content.remove(second); assert.throws(() => content.remove(first), /last/u); content.dispose();
});
