import assert from 'node:assert';
import { test } from '../../base/common/upstream/testAdapter.ts';
import {
	PresentationCategoryRegistry,
	sanitizeRestorationReferences
} from '../../../src/prctr/workbench/common/restoration.ts';

test('restoration omits unknown, malformed and sensitive references', () => {
	const result = sanitizeRestorationReferences(
		[
			{
				typeId: 'known',
				logicalIdentity: 'one',
				viewState: { cursor: { line: 4 }, selections: [1, 2] }
			},
			{ typeId: 'unknown', logicalIdentity: 'two' },
			{ typeId: 'known', logicalIdentity: 'three', viewState: { answerText: 'secret' } },
			{ typeId: 'known', logicalIdentity: '' }
		],
		new Set(['known'])
	);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), [
		{
			typeId: 'known',
			logicalIdentity: 'one',
			viewState: { cursor: { line: 4 }, selections: [1, 2] }
		}
	]);
	assert.strictEqual(Object.isFrozen(result), true);
});
test('presentation categories are explicit non-sensitive scoped declarations', () => {
	const registry = new PresentationCategoryRegistry();
	registry.register({
		id: 'layout.main',
		cleanupOwner: 'workbench.layout',
		scope: 'principalComposition',
		sensitivity: 'nonSensitive'
	});
	assert.strictEqual(registry.get('layout.main')?.scope, 'principalComposition');
	assert.throws(
		() =>
			registry.register({
				id: 'layout.main',
				cleanupOwner: 'workbench.layout',
				scope: 'device',
				sensitivity: 'nonSensitive'
			}),
		/already registered/u
	);
});
