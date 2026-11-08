import assert from 'node:assert';
import { test } from 'node:test';

import { calendarDaysBefore, relativeDay } from '../../../src/prctr/base/common/calendarDays.ts';

const NOW = new Date(2026, 10, 7, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

void test('relative days follow the local calendar, not 24-hour spans', () => {
	const lateYesterday = new Date(2026, 10, 6, 23, 30).getTime();
	assert.strictEqual(relativeDay(NOW - 60_000, NOW), 'today');
	assert.strictEqual(relativeDay(lateYesterday, NOW), 'yesterday');
	assert.strictEqual(relativeDay(NOW - 3 * DAY, NOW), 'other');
	assert.strictEqual(calendarDaysBefore(new Date(2026, 10, 1, 1).getTime(), NOW), 6);
});
