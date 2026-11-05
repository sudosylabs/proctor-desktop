import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseElementDescription } from '../../../src/prctr/base/common/elementDescription.ts';

void test('descriptions default to a div and keep id and classes', () => {
	assert.deepEqual(parseElementDescription('.a.b'), { tag: 'div', classes: ['a', 'b'] });
	assert.deepEqual(parseElementDescription('button#save.primary'), {
		tag: 'button',
		id: 'save',
		classes: ['primary']
	});
	assert.deepEqual(parseElementDescription('span'), { tag: 'span', classes: [] });
});

void test('malformed descriptions are rejected', () => {
	assert.throws(() => parseElementDescription('div foo'), /Malformed element description/);
	assert.throws(() => parseElementDescription('div.'), /Malformed element description/);
});
