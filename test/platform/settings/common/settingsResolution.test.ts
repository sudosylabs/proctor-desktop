import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import { parseSettingsDocument } from '../../../../src/prctr/platform/settings/common/settingsDocument.ts';
import { EffectiveSettings } from '../../../../src/prctr/platform/settings/common/settingsResolution.ts';

suite('Effective User Settings', () => {
	test('applies the complete precedence chain and reports bounded provenance', () => {
		const document = parseSettingsDocument(
			'{"window.zoomLevel":110,"editor.fontSize":15,"[typescript]":{"editor.fontSize":16}}'
		);
		const settings = new EffectiveSettings(document, {
			window: 'candidate',
			language: 'typescript',
			examConstraints: [{ id: 'editor.fontSize', value: 17, reason: 'Exam readability' }],
			platformConstraints: [
				{ id: 'editor.fontSize', value: 18, reason: 'Platform accessibility' }
			],
			safetyInvariants: [{ id: 'editor.fontSize', value: 19, reason: 'Packaged safety' }]
		});
		assert.strictEqual(settings.get('window.zoomLevel'), 110);
		assert.strictEqual(settings.get('editor.fontSize'), 19);
		assert.deepStrictEqual(settings.inspect('editor.fontSize'), {
			id: 'editor.fontSize',
			requested: 16,
			effective: 19,
			source: 'safetyInvariant',
			constraintReason: 'Packaged safety'
		});
		assert.throws(() => settings.get('editor.tabSize'));
	});

	test('keeps device values separate from portable source', () => {
		const settings = new EffectiveSettings(
			parseSettingsDocument('{"terminal.integrated.fontSize":20}'),
			{ window: 'authenticated', deviceValues: { 'terminal.integrated.fontSize': 16 } }
		);
		assert.strictEqual(settings.get('terminal.integrated.fontSize'), 16);
	});
});
