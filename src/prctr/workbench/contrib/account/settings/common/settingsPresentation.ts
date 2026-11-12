/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { EffectiveSettingId } from '../../../../../platform/settings/common/settingsManifest.js';
import type { ProctorIconId } from '../../../../../platform/theme/common/proctorIcons.js';

/**
 * The Settings page: Proctor's own controls over the registered settings. People never edit
 * settings.json; each control writes one key and the page saves it for them.
 */
export const settingsTabs = ['appearance', 'editor', 'accessibility'] as const;
export type SettingsTab = (typeof settingsTabs)[number];

export const settingsTabIcons: Readonly<Record<SettingsTab, ProctorIconId>> = Object.freeze({
	appearance: 'settings.appearance',
	editor: 'settings.editor',
	accessibility: 'settings.accessibility'
});

/** A choice of fixed values. `label` names a page message; the value is what is stored. */
export interface SettingChoice {
	readonly value: string | number | boolean;
	readonly label: string;
	readonly icon?: ProctorIconId;
}

export type SettingControl =
	| { readonly kind: 'segmented'; readonly choices: readonly SettingChoice[] }
	| { readonly kind: 'select'; readonly choices: readonly SettingChoice[] }
	| { readonly kind: 'switch' }
	| {
			readonly kind: 'stepper';
			readonly minimum: number;
			readonly maximum: number;
			readonly unit: 'px';
	  };

export interface SettingRow {
	readonly id: EffectiveSettingId;
	readonly control: SettingControl;
	/** A page message of everyday words that should find this row, separated by spaces. */
	readonly keywords?: string;
}

export interface SettingGroup {
	/** A page message naming the group. */
	readonly title: string;
	readonly rows: readonly SettingRow[];
}

const percent = (values: readonly number[]): readonly SettingChoice[] =>
	values.map((value) => ({ value, label: `percent:${value}` }));

export const settingsLayout: Readonly<Record<SettingsTab, readonly SettingGroup[]>> = Object.freeze(
	{
		appearance: [
			{
				title: 'settingsGroupTheme',
				rows: [
					{
						id: 'window.theme',
						keywords: 'settingsKeywordsWindowTheme',
						control: {
							kind: 'segmented',
							choices: [
								{ value: 'system', label: 'themeSystem', icon: 'theme.system' },
								{ value: 'light', label: 'themeLight', icon: 'theme.light' },
								{ value: 'dark', label: 'themeDark', icon: 'theme.dark' }
							]
						}
					},
					{
						id: 'workbench.preferHighContrast',
						keywords: 'settingsKeywordsContrast',
						control: { kind: 'switch' }
					}
				]
			},
			{
				title: 'settingsGroupSize',
				rows: [
					{
						id: 'window.zoomLevel',
						keywords: 'settingsKeywordsInterfaceSize',
						control: {
							kind: 'select',
							choices: percent([80, 90, 100, 110, 125, 150, 175, 200])
						}
					},
					{
						id: 'browser.presentation.zoom',
						keywords: 'settingsKeywordsBrowserZoom',
						control: {
							kind: 'select',
							choices: percent([80, 90, 100, 110, 125, 150, 175, 200])
						}
					}
				]
			}
		],
		editor: [
			{
				title: 'settingsGroupLook',
				rows: [
					{
						id: 'workbench.colorTheme',
						keywords: 'settingsKeywordsEditorTheme',
						control: { kind: 'select', choices: [] }
					},
					{
						id: 'editor.fontSize',
						keywords: 'settingsKeywordsFontSize',
						control: { kind: 'stepper', minimum: 12, maximum: 24, unit: 'px' }
					},
					{
						id: 'editor.lineHeight',
						keywords: 'settingsKeywordsLineHeight',
						control: { kind: 'stepper', minimum: 16, maximum: 40, unit: 'px' }
					},
					{
						id: 'editor.cursorStyle',
						control: {
							kind: 'segmented',
							choices: [
								{ value: 'line', label: 'cursorLine' },
								{ value: 'block', label: 'cursorBlock' },
								{ value: 'underline', label: 'cursorUnderline' }
							]
						}
					},
					{
						id: 'editor.cursorBlinking',
						control: {
							kind: 'select',
							choices: [
								{ value: 'blink', label: 'blinkBlink' },
								{ value: 'smooth', label: 'blinkSmooth' },
								{ value: 'phase', label: 'blinkPhase' },
								{ value: 'expand', label: 'blinkExpand' },
								{ value: 'solid', label: 'blinkSolid' }
							]
						}
					}
				]
			},
			{
				title: 'settingsGroupLayout',
				rows: [
					{
						id: 'editor.tabSize',
						control: {
							kind: 'segmented',
							choices: [
								{ value: 2, label: 'number:2' },
								{ value: 4, label: 'number:4' },
								{ value: 8, label: 'number:8' }
							]
						}
					},
					{
						id: 'editor.wordWrap',
						control: {
							kind: 'segmented',
							choices: [
								{ value: 'off', label: 'choiceOff' },
								{ value: 'on', label: 'choiceOn' }
							]
						}
					},
					{
						id: 'editor.lineNumbers',
						control: {
							kind: 'segmented',
							choices: [
								{ value: 'on', label: 'choiceOn' },
								{ value: 'relative', label: 'lineNumbersRelative' },
								{ value: 'off', label: 'choiceOff' }
							]
						}
					},
					{ id: 'editor.minimap.enabled', control: { kind: 'switch' } },
					{
						id: 'workbench.tree.indent',
						control: { kind: 'stepper', minimum: 4, maximum: 20, unit: 'px' }
					}
				]
			}
		],
		accessibility: [
			{
				title: 'settingsGroupMotion',
				rows: [
					{
						id: 'accessibility.reducedMotion',
						keywords: 'settingsKeywordsMotion',
						// The system's own request always applies; this can only add to it.
						control: {
							kind: 'select',
							choices: [
								{ value: false, label: 'motionFollowSystem' },
								{ value: true, label: 'motionAlwaysReduce' }
							]
						}
					},
					{
						id: 'workbench.hover.delay',
						control: {
							kind: 'select',
							choices: [
								{ value: 0, label: 'delayNone' },
								{ value: 300, label: 'delayShort' },
								{ value: 500, label: 'delayMedium' },
								{ value: 1000, label: 'delayLong' },
								{ value: 1500, label: 'delayLonger' }
							]
						}
					}
				]
			},
			{
				title: 'settingsGroupScreenReaders',
				rows: [
					{
						id: 'accessibility.screenReaderMode',
						keywords: 'settingsKeywordsScreenReader',
						control: {
							kind: 'select',
							choices: [
								{ value: 'auto', label: 'screenReaderAuto' },
								{ value: 'on', label: 'choiceOn' },
								{ value: 'off', label: 'choiceOff' }
							]
						}
					},
					{
						id: 'accessibility.announcementMode',
						control: {
							kind: 'segmented',
							choices: [
								{ value: 'minimal', label: 'announceBrief' },
								{ value: 'verbose', label: 'announceDetailed' }
							]
						}
					}
				]
			}
		]
	} satisfies Record<SettingsTab, readonly SettingGroup[]>
);

/** Every setting the page offers, in page order. */
export function settingsPageIds(): readonly EffectiveSettingId[] {
	return settingsTabs.flatMap((tab) =>
		settingsLayout[tab].flatMap((group) => group.rows.map((row) => row.id))
	);
}

/** The words of one row that Find a setting looks through, all in the page's language. */
export interface SettingSearchText {
	readonly title: string;
	readonly description: string;
	readonly choices: readonly string[];
	readonly keywords: string;
}

/** A row found by Find a setting, with the tab and group it lives in. */
export interface SettingMatch {
	readonly tab: SettingsTab;
	/** The page message naming the row's group. */
	readonly group: string;
	readonly row: SettingRow;
}

/**
 * Rows, across every tab in page order, whose title, description, choice labels or
 * everyday words contain every word of `query`.
 */
export function matchingRows(
	query: string,
	text: (row: SettingRow) => SettingSearchText
): readonly SettingMatch[] {
	const words = searchWords(query);
	if (words.length === 0) return [];
	return settingsTabs.flatMap((tab) =>
		settingsLayout[tab].flatMap((group) =>
			group.rows
				.filter((row) => {
					const found = text(row);
					const haystack = normalize(
						[found.title, found.description, ...found.choices, found.keywords].join(' ')
					);
					return words.every((word) => haystack.includes(word));
				})
				.map((row) => ({ tab, group: group.title, row }))
		)
	);
}

/** Whether `query` asks for anything; spaces alone do not. */
export function isSearching(query: string): boolean {
	return searchWords(query).length > 0;
}

function searchWords(query: string): readonly string[] {
	return normalize(query)
		.split(/\s+/u)
		.filter((word) => word !== '');
}

/** Case and accents never stop a match, so “colour” and “Colour” find the same rows. */
function normalize(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLocaleLowerCase();
}

/**
 * The choice a control shows for a stored value. Word wrap's other values are kinds of On, and
 * automatic announcements read as Brief.
 */
export function shownValue(id: EffectiveSettingId, value: string | number | boolean): string {
	if (id === 'editor.wordWrap' && value !== 'off') return 'on';
	if (id === 'accessibility.announcementMode' && value === 'auto') return 'minimal';
	return String(value);
}

/** The choice of `row` that stands for `value`, if the row offers one. */
export function choiceFor(
	row: SettingRow,
	value: string | number | boolean
): SettingChoice | undefined {
	const control = row.control;
	if (control.kind !== 'segmented' && control.kind !== 'select') return undefined;
	const shown = shownValue(row.id, value);
	return control.choices.find((choice) => String(choice.value) === shown);
}

/** How long after the last change the page saves, so a run of steps is one save. */
export const SETTINGS_SAVE_DELAY_MS = 400;

/**
 * What the tab bar says about saving. `idle` says nothing: “Saved” appears only once a change
 * made on this visit has been saved.
 */
export type SettingsSaveStatus = 'idle' | 'saved' | 'saving' | 'failed' | 'readonly';
