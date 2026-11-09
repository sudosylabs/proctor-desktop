/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { test } from 'node:test';
import {
	foldColumns,
	type AdminColumnLayout
} from '../../../../../src/prctr/workbench/contrib/administration/common/adminTableLayout.ts';

// The Users board: Person, Affiliation, Roles (3), Last active (2), Status, ⋯.
const users: readonly AdminColumnLayout[] = [
	{ label: 'Person', width: '34%' },
	{ label: 'Affiliation', width: '22%' },
	{ label: 'Roles', width: '18%', priority: 3 },
	{ label: 'Last active', width: '13%', align: 'end', priority: 2 },
	{ label: 'Status' }
];
const kinds = ['person', 'text', 'text', 'mono', 'status'];

void test('a wide table keeps every column and its share widths', () => {
	const plan = foldColumns(users, kinds, 1104, { more: true });
	assert.deepEqual(plan.hidden, []);
	assert.deepEqual(plan.widths, ['34%', '22%', '18%', '13%', undefined]);
	assert.equal(plan.minimum, 240 + 140 + 140 + 120 + 120 + 44);
});

void test('lesser columns fold first, and shares give way once anything folds', () => {
	const medium = foldColumns(users, kinds, 760, { more: true });
	assert.deepEqual(medium.hidden, [2]);
	assert.deepEqual(medium.widths, [undefined, undefined, undefined, undefined, undefined]);
	assert.equal(medium.foldInto, 0);
	const narrow = foldColumns(users, kinds, 660, { more: true });
	assert.deepEqual(narrow.hidden, [2, 3]);
	assert.equal(narrow.minimum, 240 + 140 + 120 + 44);
});

void test('a table that still cannot fit pins its first column at its minimum and scrolls', () => {
	const roles: readonly AdminColumnLayout[] = [
		{ label: 'Area', min: 200 },
		...['View', 'Create', 'Change', 'Archive', 'Publish', 'Export'].map((label) => ({
			label,
			width: '84px',
			align: 'center' as const
		}))
	];
	const plan = foldColumns(roles, ['text', ...Array(6).fill('check')], 600);
	assert.deepEqual(plan.hidden, []);
	assert.equal(plan.minimum, 200 + 6 * 84);
	assert.equal(plan.widths[0], '200px');
	assert.equal(plan.widths[1], '84px');
});
