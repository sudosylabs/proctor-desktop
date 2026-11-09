import assert from 'node:assert';
import { test } from 'node:test';

import {
	administrationFailureNeedsRead,
	administrationFailureWithdraws,
	parseEmails,
	permissionMatrix,
	readableCode
} from '../../../../../src/prctr/workbench/contrib/administration/common/administrationPresentation.ts';

void test('addresses split on lines, commas and semicolons, once each, keeping the rest as invalid', () => {
	const parsed = parseEmails(
		'a@northfield.example, B@northfield.example\nb@northfield.example; not-an-email\n\n'
	);
	assert.deepStrictEqual(parsed.valid, ['a@northfield.example', 'B@northfield.example']);
	assert.deepStrictEqual(parsed.invalid, ['not-an-email']);
	assert.deepStrictEqual(parseEmails('   ').valid, []);
});

void test('a refusal withdraws data and an unconfirmed change reads again', () => {
	assert.ok(administrationFailureWithdraws('noAccess'));
	assert.ok(!administrationFailureWithdraws('unavailable'));
	assert.ok(administrationFailureNeedsRead('unconfirmed'));
	assert.ok(!administrationFailureNeedsRead('invalid'));
});

void test('server codes read as words until the catalogue names them', () => {
	assert.strictEqual(readableCode('user.disable'), 'User disable');
	assert.strictEqual(readableCode('role_binding'), 'Role binding');
	assert.strictEqual(readableCode(''), '');
});

void test('permissions form a grid of areas by verbs, with absent pairs told apart from denied ones', () => {
	const matrix = permissionMatrix(['exam.view', 'exam.manage', 'user.view'], ['exam.view']);
	assert.deepStrictEqual(matrix.verbs, ['manage', 'view']);
	assert.deepStrictEqual(matrix.areas, [
		{ area: 'exam', cells: ['denied', 'allowed'] },
		{ area: 'user', cells: ['absent', 'denied'] }
	]);
});
