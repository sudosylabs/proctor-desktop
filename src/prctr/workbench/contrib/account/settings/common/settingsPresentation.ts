/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { EffectiveSettingId } from '../../../../../platform/settings/common/settingsManifest.js';
import type { ProctorIconId } from '../../../../../platform/theme/common/proctorIcons.js';

/**
 * The Settings page: Proctor's own controls over the registered settings. People never edit
 * settings.json; each control writes one key and the page saves it for them.
 */
export const settingsTabs = ['appearance', 'editor', 'accessibility', 'browser'] as const;
export type SettingsTab = (typeof settingsTabs)[number];

export const settingsTabIcons: Readonly<Record<SettingsTab, ProctorIconId>> = Object.freeze({
	appearance: 'settings.appearance',
	editor: 'settings.editor',
	accessibility: 'settings.accessibility',
	browser: 'settings.browser'
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
						control: {
							kind: 'segmented',
							choices: [
								{ value: 'system', label: 'themeSystem', icon: 'theme.system' },
								{ value: 'light', label: 'themeLight', icon: 'theme.light' },
								{ value: 'dark', label: 'themeDark', icon: 'theme.dark' }
							]
						}
					},
					{ id: 'workbench.preferHighContrast', control: { kind: 'switch' } }
				]
			},
			{
				title: 'settingsGroupSize',
				rows: [
					{
						id: 'window.zoomLevel',
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
					{ id: 'workbench.colorTheme', control: { kind: 'select', choices: [] } },
					{
						id: 'editor.fontSize',
						control: { kind: 'stepper', minimum: 12, maximum: 24, unit: 'px' }
					},
					{
						id: 'editor.lineHeight',
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
		],
		browser: [
			{
				title: 'settingsGroupExamBrowser',
				rows: [
					{
						id: 'browser.presentation.zoom',
						control: {
							kind: 'select',
							choices: percent([80, 90, 100, 110, 125, 150, 175, 200])
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

/** Rows whose title or description contains `query`, across every tab. */
export function matchingRows(
	query: string,
	describe: (id: EffectiveSettingId) => { readonly title: string; readonly description: string }
): readonly SettingRow[] {
	const needle = query.trim().toLocaleLowerCase();
	if (needle === '') return [];
	return settingsTabs.flatMap((tab) =>
		settingsLayout[tab].flatMap((group) =>
			group.rows.filter((row) => {
				const text = describe(row.id);
				return `${text.title} ${text.description}`.toLocaleLowerCase().includes(needle);
			})
		)
	);
}

/** How long after the last change the page saves, so a run of steps is one save. */
export const SETTINGS_SAVE_DELAY_MS = 400;

export type SettingsSaveStatus = 'saved' | 'saving' | 'failed' | 'readonly';
