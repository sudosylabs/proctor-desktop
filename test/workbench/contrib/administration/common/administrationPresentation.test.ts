import assert from 'node:assert';
import { test } from 'node:test';

import {
	administrationFailureNeedsRead,
	administrationFailureWithdraws,
	parseEmails,
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
