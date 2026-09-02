import assert from 'node:assert';
import { test } from '../../base/common/upstream/testAdapter.ts';
import { composeWorkbench } from '../../../src/prctr/workbench/common/composition.ts';

test('composition validates static topology and freezes the result', () => {
	const composition = composeWorkbench(
		'test',
		'authenticated',
		[
			{
				id: 'common',
				contributions: [
					{ id: 'prctr.first', phase: 'starting' },
					{ id: 'prctr.second', phase: 'ready', dependencies: ['prctr.first'] }
				],
				itemTypes: ['item'],
				destinations: ['home']
			}
		],
		{
			parts: ['titlebar', 'content', 'status'],
			maxContentGroups: 2,
			allowHorizontalSplit: true,
			allowVerticalSplit: false,
			sidebarInitiallyVisible: false,
			panelInitiallyVisible: false
		},
		{ entrypointRestorable: true, restoreItems: true, scope: 'principalComposition' }
	);
	assert.strictEqual(Object.isFrozen(composition), true);
	assert.strictEqual(Object.isFrozen(composition.contributions), true);
	assert.deepStrictEqual(composition.fragments, ['common']);
});

test('composition rejects late dependencies, cycles, duplicate registrations and Candidate restoration', () => {
	const layout = {
		parts: ['titlebar', 'content', 'status'] as const,
		maxContentGroups: 1,
		allowHorizontalSplit: false,
		allowVerticalSplit: false,
		sidebarInitiallyVisible: false,
		panelInitiallyVisible: false
	};
	assert.throws(
		() =>
			composeWorkbench(
				'late',
				'authenticated',
				[
					{
						id: 'x',
						contributions: [
							{ id: 'prctr.a', phase: 'starting', dependencies: ['prctr.b'] },
							{ id: 'prctr.b', phase: 'ready' }
						],
						itemTypes: [],
						destinations: []
					}
				],
				layout,
				{ entrypointRestorable: true, scope: 'windowSession', restoreItems: false }
			),
		/later phase/u
	);
	assert.throws(
		() =>
			composeWorkbench(
				'cycle',
				'authenticated',
				[
					{
						id: 'x',
						contributions: [
							{ id: 'prctr.a', phase: 'ready', dependencies: ['prctr.b'] },
							{ id: 'prctr.b', phase: 'ready', dependencies: ['prctr.a'] }
						],
						itemTypes: [],
						destinations: []
					}
				],
				layout,
				{ entrypointRestorable: true, scope: 'windowSession', restoreItems: false }
			),
		/cycle/u
	);
	assert.throws(
		() =>
			composeWorkbench(
				'candidate',
				'candidate',
				[{ id: 'x', contributions: [], itemTypes: [], destinations: [] }],
				layout,
				{ entrypointRestorable: true, scope: 'attemptPresentation', restoreItems: true }
			),
		/cannot be a restorable/u
	);
});
