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
	settingsSearchResults: defineMessage({
		id: 'account.settings.search.results',
		defaultMessage: 'Matching settings',
		description: 'Group title while finding a setting.'
	}),
	settingsNoMatch: defineMessage({
		id: 'account.settings.no.match',
		defaultMessage: 'No setting matches “{query}”',
		description: 'Find a setting found nothing; {query} is what the person typed.'
	}),
	settingsNoMatchHint: defineMessage({
		id: 'account.settings.no.match.hint',
		defaultMessage:
			'Try another word, such as “dark”, “text” or “zoom”. Every tab is searched.',
		description: 'Hint under a search that found nothing.'
	}),
	clearSearch: defineMessage({
		id: 'account.settings.clear.search',
		defaultMessage: 'Clear search',
		description: 'Empties Find a setting and shows the tabs again.'
	}),
	settingsSearchCount: defineMessage({
		id: 'account.settings.search.count',
		defaultMessage: 'Matching settings · {count}',
		description:
			'Heading of the search results, also announced; {count} is how many settings match.'
	}),
	settingsResultPlace: defineMessage({
		id: 'account.settings.result.place',
		defaultMessage: '{tab} · {group}',
		description: 'Where a found setting lives, above its title, as in Appearance · Size.'
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
		defaultMessage: 'Your changes weren’t saved',
		description: 'Toast title when a save of several settings fails.'
	}),
	settingNotSavedNamed: defineMessage({
		id: 'account.settings.not.saved.named',
		defaultMessage: '{name} wasn’t saved',
		description: 'Toast title when a save of one setting fails; {name} is the setting.'
	}),
	settingsKeptHere: defineMessage({
		id: 'account.settings.kept.here',
		defaultMessage:
			'It still applies on this computer. Proctor saves it to your account when the server answers.',
		description: 'Toast body when a save of one setting fails and the institution is unknown.'
	}),
	settingsKeptHereNamed: defineMessage({
		id: 'account.settings.kept.here.named',
		defaultMessage:
			'It still applies on this computer. Proctor saves it to your account when {institution} answers.',
		description: 'Toast body when a save of one setting fails; {institution} is its name.'
	}),
	settingsKeptHereMany: defineMessage({
		id: 'account.settings.kept.here.many',
		defaultMessage:
			'They still apply on this computer. Proctor saves them to your account when the server answers.',
		description:
			'Toast body when a save of several settings fails and the institution is unknown.'
	}),
	settingsKeptHereManyNamed: defineMessage({
		id: 'account.settings.kept.here.many.named',
		defaultMessage:
			'They still apply on this computer. Proctor saves them to your account when {institution} answers.',
		description: 'Toast body when a save of several settings fails; {institution} is its name.'
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
			'When you join an exam, these settings are copied into it and stay fixed until it ends. An exam can only make text larger or contrast stronger, never less.',
		description: 'Note at the top of the Exam editor tab.'
	}),
	settingsAccessibilityNote: defineMessage({
		id: 'account.settings.accessibility.note',
		defaultMessage: 'High contrast and Interface size are under Appearance.',
		description: 'Note at the top of the Accessibility tab.'
	}),
	openAppearance: defineMessage({
		id: 'account.settings.open.appearance',
		defaultMessage: 'Open Appearance',
		description: 'Opens the Appearance tab from the Accessibility note.'
	}),
	resetSetting: defineMessage({
		id: 'account.settings.reset',
		defaultMessage: 'Reset to {value}',
		description:
			'Puts one setting back to its default; {value} is the default, as in Reset to 14 px.'
	}),
	resetSettingNamed: defineMessage({
		id: 'account.settings.reset.named',
		defaultMessage: 'Reset {name} to {value}',
		description: 'Accessible name of a setting’s Reset button, as in Reset Font size to 14 px.'
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
	}),
	settingsKeywordsWindowTheme: defineMessage({
		id: 'account.settings.keywords.window.theme',
		defaultMessage: 'colour color scheme appearance dark light mode',
		description:
			'Everyday words, separated by spaces, that find the window theme in Find a setting. Translate freely; they are never shown.'
	}),
	settingsKeywordsEditorTheme: defineMessage({
		id: 'account.settings.keywords.editor.theme',
		defaultMessage: 'colour color scheme syntax dark light',
		description:
			'Everyday words, separated by spaces, that find the editor theme in Find a setting. Translate freely; they are never shown.'
	}),
	settingsKeywordsContrast: defineMessage({
		id: 'account.settings.keywords.contrast',
		defaultMessage: 'colour color borders visibility',
		description:
			'Everyday words, separated by spaces, that find high contrast in Find a setting. Translate freely; they are never shown.'
	}),
	settingsKeywordsInterfaceSize: defineMessage({
		id: 'account.settings.keywords.interface.size',
		defaultMessage: 'zoom scale bigger smaller larger',
		description:
			'Everyday words, separated by spaces, that find interface size in Find a setting. Translate freely; they are never shown.'
	}),
	settingsKeywordsBrowserZoom: defineMessage({
		id: 'account.settings.keywords.browser.zoom',
		defaultMessage: 'zoom scale bigger smaller larger pages web',
		description:
			'Everyday words, separated by spaces, that find exam browser zoom in Find a setting. Translate freely; they are never shown.'
	}),
	settingsKeywordsFontSize: defineMessage({
		id: 'account.settings.keywords.font.size',
		defaultMessage: 'text zoom bigger smaller larger',
		description:
			'Everyday words, separated by spaces, that find editor font size in Find a setting. Translate freely; they are never shown.'
	}),
	settingsKeywordsLineHeight: defineMessage({
		id: 'account.settings.keywords.line.height',
		defaultMessage: 'spacing text',
		description:
			'Everyday words, separated by spaces, that find editor line height in Find a setting. Translate freely; they are never shown.'
	}),
	settingsKeywordsMotion: defineMessage({
		id: 'account.settings.keywords.motion',
		defaultMessage: 'animation movement',
		description:
			'Everyday words, separated by spaces, that find reduced motion in Find a setting. Translate freely; they are never shown.'
	}),
	settingsKeywordsScreenReader: defineMessage({
		id: 'account.settings.keywords.screen.reader',
		defaultMessage: 'voiceover narrator nvda jaws',
		description:
			'Everyday words, separated by spaces, that find screen reader mode in Find a setting. Translate freely; they are never shown.'
	})
});
