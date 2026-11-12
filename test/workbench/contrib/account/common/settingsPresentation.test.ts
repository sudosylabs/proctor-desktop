import assert from 'node:assert';
import { test } from 'node:test';

import { SETTINGS_MANIFEST } from '../../../../../src/prctr/platform/settings/common/settingsManifest.ts';
import {
	choiceFor,
	isSearching,
	matchingRows,
	settingsLayout,
	settingsPageIds,
	settingsTabs,
	shownValue,
	type SettingRow,
	type SettingSearchText
} from '../../../../../src/prctr/workbench/contrib/account/settings/common/settingsPresentation.ts';

/** Each row's text as the page shows it: the manifest's English and the choice keys as words. */
function englishText(row: SettingRow): SettingSearchText {
	const declaration = SETTINGS_MANIFEST.find((setting) => setting.id === row.id)!;
	const control = row.control;
	return {
		title: declaration.title.defaultMessage,
		description: declaration.description.defaultMessage,
		choices:
			control.kind === 'segmented' || control.kind === 'select'
				? control.choices.map((choice) => choice.label)
				: [],
		keywords: row.keywords === undefined ? '' : `words for ${row.id}`
	};
}

test('the page has three tabs and offers each registered setting once', () => {
	assert.deepStrictEqual(settingsTabs, ['appearance', 'editor', 'accessibility']);
	const ids = settingsPageIds();
	assert.strictEqual(new Set(ids).size, ids.length);
	for (const id of ids)
		assert.ok(
			SETTINGS_MANIFEST.some((setting) => setting.id === id),
			id
		);
});

test('exam browser zoom sits beside interface size on Appearance', () => {
	const size = settingsLayout.appearance.find((group) => group.title === 'settingsGroupSize')!;
	assert.deepStrictEqual(
		size.rows.map((row) => row.id),
		['window.zoomLevel', 'browser.presentation.zoom']
	);
	const zoom = SETTINGS_MANIFEST.find((setting) => setting.id === 'browser.presentation.zoom')!;
	assert.strictEqual(zoom.storage, 'device');
	assert.strictEqual(zoom.title.defaultMessage, 'Exam browser zoom');
});

test('find matches titles, descriptions, choices and keywords, naming tab and group', () => {
	const byTitle = matchingRows('minimap', englishText);
	assert.deepStrictEqual(
		byTitle.map((match) => [match.tab, match.group, match.row.id]),
		[['editor', 'settingsGroupLayout', 'editor.minimap.enabled']]
	);
	const byDescription = matchingRows('tooltip shows', englishText);
	assert.deepStrictEqual(
		byDescription.map((match) => match.row.id),
		['workbench.hover.delay']
	);
	const byChoice = matchingRows('cursorUnderline', englishText);
	assert.deepStrictEqual(
		byChoice.map((match) => match.row.id),
		['editor.cursorStyle']
	);
	const byKeyword = matchingRows('words for window.zoomLevel', englishText);
	assert.deepStrictEqual(
		byKeyword.map((match) => match.row.id),
		['window.zoomLevel']
	);
});

test('find needs every word, ignores case and accents, and nothing for blank queries', () => {
	assert.deepStrictEqual(
		matchingRows('LINE  height', englishText).map((match) => match.row.id),
		['editor.lineHeight']
	);
	assert.deepStrictEqual(
		matchingRows('mínimap', englishText).map((match) => match.row.id),
		['editor.minimap.enabled']
	);
	assert.deepStrictEqual(matchingRows('minimap qqq', englishText), []);
	assert.deepStrictEqual(matchingRows('   ', englishText), []);
	assert.strictEqual(isSearching('   '), false);
	assert.strictEqual(isSearching(' a '), true);
});

test('a stored value maps to the choice the control shows', () => {
	const row = (id: string): SettingRow =>
		settingsTabs
			.flatMap((tab) => settingsLayout[tab].flatMap((group) => group.rows))
			.find((entry) => entry.id === id)!;
	assert.strictEqual(shownValue('editor.wordWrap', 'bounded'), 'on');
	assert.strictEqual(shownValue('accessibility.announcementMode', 'auto'), 'minimal');
	assert.strictEqual(choiceFor(row('workbench.hover.delay'), 500)?.label, 'delayMedium');
	assert.strictEqual(choiceFor(row('editor.wordWrap'), 'wordWrapColumn')?.label, 'choiceOn');
	assert.strictEqual(choiceFor(row('editor.fontSize'), 14), undefined);
});
