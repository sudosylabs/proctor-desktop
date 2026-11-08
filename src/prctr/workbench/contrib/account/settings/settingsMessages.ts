/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Account Settings page. */
export const settingsMessages = Object.freeze({
	settingsTabAppearance: defineMessage({
		id: 'account.settings.tab.appearance',
		defaultMessage: 'Appearance',
		description: 'Settings tab.'
	}),
	settingsTabEditor: defineMessage({
		id: 'account.settings.tab.editor',
		defaultMessage: 'Exam editor',
		description: 'Settings tab for the exam editor.'
	}),
	settingsTabAccessibility: defineMessage({
		id: 'account.settings.tab.accessibility',
		defaultMessage: 'Accessibility',
		description: 'Settings tab.'
	}),
	settingsTabBrowser: defineMessage({
		id: 'account.settings.tab.browser',
		defaultMessage: 'Browser',
		description: 'Settings tab for the exam browser.'
	}),
	settingsGroupTheme: defineMessage({
		id: 'account.settings.group.theme',
		defaultMessage: 'Theme',
		description: 'Settings group.'
	}),
	settingsGroupSize: defineMessage({
		id: 'account.settings.group.size',
		defaultMessage: 'Size',
		description: 'Settings group.'
	}),
	settingsGroupLook: defineMessage({
		id: 'account.settings.group.look',
		defaultMessage: 'Look',
		description: 'Settings group for how the editor looks.'
	}),
	settingsGroupLayout: defineMessage({
		id: 'account.settings.group.layout',
		defaultMessage: 'Layout',
		description: 'Settings group for editor layout.'
	}),
	settingsGroupMotion: defineMessage({
		id: 'account.settings.group.motion',
		defaultMessage: 'Motion and timing',
		description: 'Settings group.'
	}),
	settingsGroupScreenReaders: defineMessage({
		id: 'account.settings.group.screen.readers',
		defaultMessage: 'Screen readers',
		description: 'Settings group.'
	}),
	settingsGroupExamBrowser: defineMessage({
		id: 'account.settings.group.exam.browser',
		defaultMessage: 'Exam browser',
		description: 'Settings group.'
	}),
	settingsSearchResults: defineMessage({
		id: 'account.settings.search.results',
		defaultMessage: 'Matching settings',
		description: 'Group title while finding a setting.'
	}),
	settingsNoMatch: defineMessage({
		id: 'account.settings.no.match',
		defaultMessage: 'No setting matches that.',
		description: 'Find a setting found nothing.'
	}),
	findSetting: defineMessage({
		id: 'account.settings.find',
		defaultMessage: 'Find a setting',
		description: 'Accessible name and placeholder of the settings filter.'
	}),
	settingsSaved: defineMessage({
		id: 'account.settings.saved',
		defaultMessage: 'Saved',
		description: 'Every change is saved.'
	}),
	settingsSaving: defineMessage({
		id: 'account.settings.saving',
		defaultMessage: 'Saving…',
		description: 'A change is being saved.'
	}),
	settingsNotSavedShort: defineMessage({
		id: 'account.settings.not.saved.short',
		defaultMessage: 'Not saved',
		description: 'The last change could not be saved.'
	}),
	settingsReadOnly: defineMessage({
		id: 'account.settings.read.only',
		defaultMessage: 'Read only',
		description: 'Settings cannot be changed right now.'
	}),
	settingsNotSaved: defineMessage({
		id: 'account.settings.not.saved',
		defaultMessage: 'Couldn’t save your settings',
		description: 'Toast title when a save fails.'
	}),
	settingsKeptHere: defineMessage({
		id: 'account.settings.kept.here',
		defaultMessage: 'Your change is kept on this page; try again when the server answers.',
		description: 'Toast body when a save fails.'
	}),
	settingsInvalid: defineMessage({
		id: 'account.settings.invalid',
		defaultMessage: 'That value isn’t allowed.',
		description: 'Toast body when a value is refused.'
	}),
	settingsUnavailable: defineMessage({
		id: 'account.settings.unavailable',
		defaultMessage: 'Settings can’t be changed right now. Your current settings still apply.',
		description: 'Banner when settings are read only or unavailable.'
	}),
	settingsExamOverride: defineMessage({
		id: 'account.settings.exam.override',
		defaultMessage:
			'An exam can set its own editor settings. When it does, they apply only while you take that exam.',
		description: 'Banner on the Exam editor tab.'
	}),
	resetSetting: defineMessage({
		id: 'account.settings.reset',
		defaultMessage: 'Reset',
		description: 'Puts one setting back to its default.'
	}),
	resetSettingNamed: defineMessage({
		id: 'account.settings.reset.named',
		defaultMessage: 'Reset {name}',
		description: 'Accessible name of a setting’s Reset button.'
	}),
	themeSystem: defineMessage({
		id: 'account.settings.theme.system',
		defaultMessage: 'System',
		description: 'Window theme follows the operating system.'
	}),
	themeLight: defineMessage({
		id: 'account.settings.theme.light',
		defaultMessage: 'Light',
		description: 'Window theme choice.'
	}),
	themeDark: defineMessage({
		id: 'account.settings.theme.dark',
		defaultMessage: 'Dark',
		description: 'Window theme choice.'
	}),
	choiceOn: defineMessage({
		id: 'account.settings.choice.on',
		defaultMessage: 'On',
		description: 'A setting choice.'
	}),
	choiceOff: defineMessage({
		id: 'account.settings.choice.off',
		defaultMessage: 'Off',
		description: 'A setting choice.'
	}),
	lineNumbersRelative: defineMessage({
		id: 'account.settings.line.numbers.relative',
		defaultMessage: 'Relative',
		description: 'Line numbers counted from the cursor line.'
	}),
	cursorLine: defineMessage({
		id: 'account.settings.cursor.line',
		defaultMessage: 'Line',
		description: 'Cursor shape.'
	}),
	cursorBlock: defineMessage({
		id: 'account.settings.cursor.block',
		defaultMessage: 'Block',
		description: 'Cursor shape.'
	}),
	cursorUnderline: defineMessage({
		id: 'account.settings.cursor.underline',
		defaultMessage: 'Underline',
		description: 'Cursor shape.'
	}),
	blinkBlink: defineMessage({
		id: 'account.settings.blink.blink',
		defaultMessage: 'Blink',
		description: 'Cursor animation.'
	}),
	blinkSmooth: defineMessage({
		id: 'account.settings.blink.smooth',
		defaultMessage: 'Smooth',
		description: 'Cursor animation.'
	}),
	blinkPhase: defineMessage({
		id: 'account.settings.blink.phase',
		defaultMessage: 'Phase',
		description: 'Cursor animation.'
	}),
	blinkExpand: defineMessage({
		id: 'account.settings.blink.expand',
		defaultMessage: 'Expand',
		description: 'Cursor animation.'
	}),
	blinkSolid: defineMessage({
		id: 'account.settings.blink.solid',
		defaultMessage: 'Solid',
		description: 'Cursor animation: no blinking.'
	}),
	delayNone: defineMessage({
		id: 'account.settings.delay.none',
		defaultMessage: 'None',
		description: 'Tooltip delay choice.'
	}),
	delayShort: defineMessage({
		id: 'account.settings.delay.short',
		defaultMessage: 'Short · 0.3 s',
		description: 'Tooltip delay choice.'
	}),
	delayMedium: defineMessage({
		id: 'account.settings.delay.medium',
		defaultMessage: 'Medium · 0.5 s',
		description: 'Tooltip delay choice.'
	}),
	delayLong: defineMessage({
		id: 'account.settings.delay.long',
		defaultMessage: 'Long · 1 s',
		description: 'Tooltip delay choice.'
	}),
	delayLonger: defineMessage({
		id: 'account.settings.delay.longer',
		defaultMessage: 'Longer · 1.5 s',
		description: 'Tooltip delay choice.'
	}),
	screenReaderAuto: defineMessage({
		id: 'account.settings.screen.reader.auto',
		defaultMessage: 'Detect automatically',
		description: 'Screen reader mode choice.'
	}),
	motionFollowSystem: defineMessage({
		id: 'account.settings.motion.follow.system',
		defaultMessage: 'Follow {system}',
		description:
			'Reduced motion choice: reduce motion only when the operating system asks; {system} is macOS, Windows or Linux.'
	}),
	motionAlwaysReduce: defineMessage({
		id: 'account.settings.motion.always',
		defaultMessage: 'Always reduce',
		description: 'Reduced motion choice: reduce motion whatever the operating system says.'
	}),
	announceBrief: defineMessage({
		id: 'account.settings.announce.brief',
		defaultMessage: 'Brief',
		description: 'Announcement detail choice.'
	}),
	announceDetailed: defineMessage({
		id: 'account.settings.announce.detailed',
		defaultMessage: 'Detailed',
		description: 'Announcement detail choice.'
	}),
	percentValue: defineMessage({
		id: 'account.settings.percent',
		defaultMessage: '{value}%',
		description: 'A percentage.'
	}),
	smaller: defineMessage({
		id: 'account.settings.smaller',
		defaultMessage: 'Smaller',
		description: 'Decreases a number.'
	}),
	larger: defineMessage({
		id: 'account.settings.larger',
		defaultMessage: 'Larger',
		description: 'Increases a number.'
	}),
	editorPreview: defineMessage({
		id: 'account.settings.editor.preview',
		defaultMessage: 'Editor preview',
		description: 'Accessible name of the code preview.'
	}),
	editorPreviewLabel: defineMessage({
		id: 'account.settings.editor.preview.label',
		defaultMessage: 'Preview · {theme}, {size} px',
		description: 'Label above the code preview.'
	})
});
