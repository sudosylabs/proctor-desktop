import { localize } from '../../../../base/common/vscodeNls.js';
import { settingsRegistry } from '../../../../platform/settings/common/settingsRegistry.js';
import type { SettingDomain } from '../../../../platform/settings/common/settingsManifest.js';
import type { ITOCEntry } from '../../../contrib/preferences/browser/settingsLayout.js';

export const commonlyUsedSettings = [
	'workbench.colorTheme',
	'editor.fontSize',
	'editor.fontFamily',
	'editor.wordWrap',
	'editor.tabSize'
] as const;

const sections: readonly { id: SettingDomain; label: string }[] = [
	{ id: 'appearance', label: localize('proctor.settings.appearance', 'Appearance') },
	{ id: 'editor', label: localize('proctor.settings.editor', 'Text Editor') },
	{ id: 'accessibility', label: localize('proctor.settings.accessibility', 'Accessibility') },
	{ id: 'navigation', label: localize('proctor.settings.navigation', 'Navigation') },
	{ id: 'terminal', label: localize('proctor.settings.terminal', 'Terminal') },
	{ id: 'browser', label: localize('proctor.settings.browser', 'Browser') }
];

/** Product categories select packaged declarations; the upstream tree still resolves, filters and orders them. */
export const settingsEditorLayout: ITOCEntry<string> = {
	id: 'root',
	label: localize('proctor.settings.catalog', 'Settings'),
	children: sections
		.map((section) => ({
			id: section.id,
			label: section.label,
			settings: settingsRegistry.declarations
				.filter(
					(setting) =>
						setting.domain === section.id &&
						setting.candidate !== 'prohibited' &&
						setting.windows.includes('authenticated')
				)
				.map((setting) => setting.id)
		}))
		.filter((section) => section.settings.length > 0)
};
