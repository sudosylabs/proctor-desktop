import assert from 'node:assert';
import { test } from 'node:test';
import {
	getProctorIconIds,
	hasFilledProctorIcon,
	resolveProctorIcon
} from '../../../../src/prctr/platform/theme/common/proctorIcons.ts';

void test('every Proctor icon resolves to path data on the 256 grid', () => {
	const ids = getProctorIconIds();
	assert.ok(ids.length > 40);
	assert.equal(new Set(ids).size, ids.length);
	for (const id of ids) {
		const glyph = resolveProctorIcon(id);
		assert.equal(glyph.id, id);
		assert.ok(/^M[\d.,\s\-A-Za-z]+$/u.test(glyph.d), id);
	}
});

void test('navigation icons have a fill weight and others fall back to regular', () => {
	for (const id of [
		'area.activity',
		'area.exams',
		'area.administration',
		'account.profile',
		'account.security',
		'account.sessions',
		'account.tokens',
		'account.history',
		'account.settings'
	] as const) {
		assert.ok(hasFilledProctorIcon(id), id);
		assert.ok(resolveProctorIcon(id, true).d !== resolveProctorIcon(id).d, id);
	}
	assert.equal(resolveProctorIcon('action.more', true).d, resolveProctorIcon('action.more').d);
});
