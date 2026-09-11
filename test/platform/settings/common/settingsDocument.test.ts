import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import {
	SETTINGS_DOCUMENT_LIMITS,
	parseSettingsDocument
} from '../../../../src/prctr/platform/settings/common/settingsDocument.ts';

suite('User Settings JSONC document', () => {
	test('preserves source, accepts comments/trailing commas, and keeps unknown keys inactive', () => {
		const source =
			'{\n  // preserved\n  "editor.fontSize": 18,\n  "future.safeSetting": true,\n}';
		const parsed = parseSettingsDocument(source);
		assert.strictEqual(parsed.valid, true);
		assert.strictEqual(parsed.source, source);
		assert.strictEqual(parsed.values.get('editor.fontSize'), 18);
		assert.strictEqual(parsed.values.has('future.safeSetting'), false);
		assert.strictEqual(parsed.root?.['future.safeSetting'], true);
	});

	test('supports only declared language overrides', () => {
		const parsed = parseSettingsDocument(
			'{"[TypeScript]":{"editor.fontSize":16,"window.zoomLevel":120}}'
		);
		assert.strictEqual(parsed.valid, false);
		assert.strictEqual(parsed.languageValues.get('typescript')?.get('editor.fontSize'), 16);
		assert.ok(
			parsed.diagnostics.some(
				(item) =>
					item.code === 'invalid-language-override' && item.key === 'window.zoomLevel'
			)
		);
	});

	test('diagnoses duplicate, prohibited, dangerous, confusable, and invalid values', () => {
		const parsed = parseSettingsDocument(
			'{"editor.fontSize":14,"editor.fontSize":99,"http.proxy":"x","__proto__":{},"ｅditor.fontSize":14}'
		);
		for (const code of [
			'duplicate-key',
			'invalid-value',
			'prohibited-key',
			'dangerous-key',
			'confusable-key'
		]) {
			assert.ok(
				parsed.diagnostics.some((item) => item.code === code),
				`missing ${code}`
			);
		}
		assert.strictEqual(parsed.valid, false);
	});

	test('enforces byte, depth, property, string, and override limits', () => {
		assert.ok(
			parseSettingsDocument(
				`{"unknown":"${'x'.repeat(SETTINGS_DOCUMENT_LIMITS.maxBytes)}"}`
			).diagnostics.some((item) => item.code === 'too-large')
		);
		const deep = `${'{"x":'.repeat(SETTINGS_DOCUMENT_LIMITS.maxDepth + 1)}0${'}'.repeat(SETTINGS_DOCUMENT_LIMITS.maxDepth + 1)}`;
		assert.ok(parseSettingsDocument(deep).diagnostics.some((item) => item.code === 'too-deep'));
		const properties = `{${Array.from({ length: SETTINGS_DOCUMENT_LIMITS.maxProperties + 1 }, (_, index) => `"x${index}":0`).join(',')}}`;
		assert.ok(
			parseSettingsDocument(properties).diagnostics.some(
				(item) => item.code === 'too-many-properties'
			)
		);
		assert.ok(
			parseSettingsDocument(
				`{"unknown":"${'x'.repeat(SETTINGS_DOCUMENT_LIMITS.maxStringLength + 1)}"}`
			).diagnostics.some((item) => item.code === 'string-too-long')
		);
		const overrides = `{${Array.from({ length: SETTINGS_DOCUMENT_LIMITS.maxLanguageOverrides + 1 }, (_, index) => `"[x${index}]":{}`).join(',')}}`;
		assert.ok(
			parseSettingsDocument(overrides).diagnostics.some(
				(item) => item.code === 'too-many-overrides'
			)
		);
	});
});

suite('User Settings recursive work limits', () => {
	test('rejects extreme nesting before recursive parsing and retains the editable source', () => {
		const source = '{"unknown":' + '['.repeat(10000) + '0' + ']'.repeat(10000) + '}';
		const result = parseSettingsDocument(source);
		assert.strictEqual(result.valid, false);
		assert.strictEqual(result.diagnostics[0]?.code, 'too-deep');
		assert.strictEqual(result.source, source);
		assert.strictEqual(parseSettingsDocument('{"unknown":[0]}').valid, true);
	});
	test('does not count brackets within strings or JSONC comments as nesting', () => {
		const source = '{ /* ' + '['.repeat(1000) + ' */ "unknown": "' + '['.repeat(1000) + '"}';
		assert.strictEqual(parseSettingsDocument(source).valid, true);
	});
	test('wrong-kind closing delimiters cannot bypass the recursive work limit', () => {
		const source = '{"unknown":' + '[},'.repeat(10000) + '0' + ']'.repeat(10000) + '}';
		const result = parseSettingsDocument(source);
		assert.strictEqual(result.valid, false);
		assert.strictEqual(result.diagnostics[0]?.code, 'too-deep');
		assert.strictEqual(result.source, source);
	});
});
