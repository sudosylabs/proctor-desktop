import assert from 'node:assert';
import { test } from 'node:test';

import {
	getSemanticIconIds,
	resolveSemanticIcon
} from '../../../../src/prctr/platform/theme/common/semanticIcons.js';

void test('semantic icon identifiers are unique, stable, and backed by font characters', () => {
	const identifiers = getSemanticIconIds();
	assert.ok(identifiers.length >= 24);
	assert.deepStrictEqual(identifiers, [...identifiers].sort());
	assert.strictEqual(new Set(identifiers).size, identifiers.length);
	for (const id of identifiers) {
		const glyph = resolveSemanticIcon(id);
		assert.strictEqual(glyph.id, id);
		assert.ok(Number.isInteger(glyph.fontCharacter));
		assert.ok(glyph.fontCharacter > 0);
	}
});

void test('semantic icon API keeps the glyph name private', () => {
	assert.deepStrictEqual(resolveSemanticIcon('action.settings'), {
		id: 'action.settings',
		fontCharacter: 0xeb51
	});
});
