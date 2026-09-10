import type { IColorCustomizations } from '../../theme/common/colorCustomizations.js';
export interface SettingMessageDescriptor {
	readonly id: string;
	readonly defaultMessage: string;
	readonly description: string;
	readonly placeholders: readonly string[];
}
function defineMessage(
	definition: Omit<SettingMessageDescriptor, 'placeholders'>
): SettingMessageDescriptor {
	return Object.freeze({ ...definition, placeholders: Object.freeze([]) });
}

export const SETTINGS_REGISTRY_VERSION = 1;

export type SettingStorageScope = 'portableUser' | 'device';
export type SettingDomain =
	'appearance' | 'accessibility' | 'editor' | 'navigation' | 'terminal' | 'browser' | 'security';
export type SettingWindow = 'authenticated' | 'candidate';
export type SettingActivation = 'immediate' | 'nextWindow';
export type CandidateTreatment =
	'eligible' | 'policyConstrained' | 'nonCandidateOnly' | 'prohibited';

export interface SettingDeclaration {
	readonly id: string;
	readonly type: 'boolean' | 'number' | 'integer' | 'string' | 'object';
	readonly default?: boolean | number | string | IColorCustomizations;
	readonly enum?: readonly (boolean | number | string)[];
	readonly minimum?: number;
	readonly maximum?: number;
	readonly storage: SettingStorageScope;
	readonly domain: SettingDomain;
	readonly windows: readonly SettingWindow[];
	readonly languageOverride: boolean;
	readonly activation: SettingActivation;
	readonly candidate: CandidateTreatment;
	readonly title: SettingMessageDescriptor;
	readonly description: SettingMessageDescriptor;
	readonly migration?: { readonly from: string; readonly removeAfter: number };
	readonly rejectionReason?: SettingMessageDescriptor;
}

/** Literal packaged authority. No runtime or remote contribution may append declarations. */
export const SETTINGS_MANIFEST = [
	{
		id: 'workbench.colorTheme',
		type: 'string',
		default: 'GitHub Dark Default',
		enum: [
			'GitHub Light Default',
			'GitHub Light High Contrast',
			'GitHub Light Colorblind (Beta)',
			'GitHub Dark Default',
			'GitHub Dark High Contrast',
			'GitHub Dark Colorblind (Beta)',
			'GitHub Dark Dimmed',
			'GitHub Light',
			'GitHub Dark',
			'light',
			'dark',
			'hcLight',
			'hcDark'
		],
		storage: 'portableUser',
		domain: 'appearance',
		windows: ['authenticated', 'candidate'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'eligible',
		title: defineMessage({
			id: 'settings.theme.title',
			defaultMessage: 'Color theme',
			description: 'Title for the packaged color theme setting.'
		}),
		description: defineMessage({
			id: 'settings.theme.description',
			defaultMessage: 'Selects one packaged Proctor color theme.',
			description: 'Description of the packaged color theme setting.'
		})
	},
	{
		id: 'workbench.colorCustomizations',
		type: 'object',
		default: {},
		storage: 'portableUser',
		domain: 'appearance',
		windows: ['authenticated'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.colors.title',
			defaultMessage: 'Color customizations',
			description: 'Title for workbench color overrides.'
		}),
		description: defineMessage({
			id: 'settings.colors.description',
			defaultMessage:
				'Overrides workbench colors in settings.json, globally or for a named theme.',
			description: 'Description of data-only workbench color overrides.'
		})
	},
	{
		id: 'workbench.preferHighContrast',
		type: 'boolean',
		default: false,
		storage: 'portableUser',
		domain: 'accessibility',
		windows: ['authenticated', 'candidate'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'policyConstrained',
		title: defineMessage({
			id: 'settings.contrast.title',
			defaultMessage: 'Prefer high contrast',
			description: 'Title for the high contrast preference.'
		}),
		description: defineMessage({
			id: 'settings.contrast.description',
			defaultMessage:
				'Uses a packaged high-contrast theme when stronger accessibility requirements apply.',
			description: 'Description of the high contrast preference.'
		})
	},
	{
		id: 'window.zoomLevel',
		type: 'integer',
		default: 100,
		minimum: 80,
		maximum: 200,
		storage: 'portableUser',
		domain: 'appearance',
		windows: ['authenticated', 'candidate'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'policyConstrained',
		title: defineMessage({
			id: 'settings.zoom.title',
			defaultMessage: 'Interface zoom',
			description: 'Title for the interface zoom setting.'
		}),
		description: defineMessage({
			id: 'settings.zoom.description',
			defaultMessage: 'Sets bounded interface zoom as a percentage.',
			description: 'Description of the interface zoom setting.'
		})
	},
	{
		id: 'editor.fontSize',
		type: 'integer',
		default: 14,
		minimum: 12,
		maximum: 24,
		storage: 'portableUser',
		domain: 'editor',
		windows: ['authenticated', 'candidate'],
		languageOverride: true,
		activation: 'immediate',
		candidate: 'policyConstrained',
		title: defineMessage({
			id: 'settings.editor.fontsize.title',
			defaultMessage: 'Editor font size',
			description: 'Title for the editor font size setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.fontsize.description',
			defaultMessage: 'Sets the editor font size in pixels.',
			description: 'Description of the editor font size setting.'
		})
	},
	{
		id: 'editor.lineHeight',
		type: 'integer',
		default: 22,
		minimum: 16,
		maximum: 40,
		storage: 'portableUser',
		domain: 'editor',
		windows: ['authenticated', 'candidate'],
		languageOverride: true,
		activation: 'immediate',
		candidate: 'policyConstrained',
		title: defineMessage({
			id: 'settings.editor.lineheight.title',
			defaultMessage: 'Editor line height',
			description: 'Title for the editor line height setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.lineheight.description',
			defaultMessage: 'Sets the editor line height in pixels.',
			description: 'Description of the editor line height setting.'
		})
	},
	{
		id: 'editor.tabSize',
		type: 'integer',
		default: 4,
		minimum: 1,
		maximum: 8,
		storage: 'portableUser',
		domain: 'editor',
		windows: ['authenticated'],
		languageOverride: true,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.editor.tabsize.title',
			defaultMessage: 'Tab size',
			description: 'Title for the editor tab size setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.tabsize.description',
			defaultMessage: 'Sets the displayed indentation width outside an Attempt.',
			description: 'Description of the editor tab size setting.'
		})
	},
	{
		id: 'editor.wordWrap',
		type: 'string',
		default: 'off',
		enum: ['off', 'on', 'wordWrapColumn', 'bounded'],
		storage: 'portableUser',
		domain: 'editor',
		windows: ['authenticated'],
		languageOverride: true,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.editor.wordwrap.title',
			defaultMessage: 'Word wrap',
			description: 'Title for the editor word wrap setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.wordwrap.description',
			defaultMessage: 'Controls editor word wrapping outside an Attempt.',
			description: 'Description of the editor word wrap setting.'
		})
	},
	{
		id: 'editor.lineNumbers',
		type: 'string',
		default: 'on',
		enum: ['off', 'on', 'relative'],
		storage: 'portableUser',
		domain: 'editor',
		windows: ['authenticated'],
		languageOverride: true,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.editor.linenumbers.title',
			defaultMessage: 'Line numbers',
			description: 'Title for the editor line numbers setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.linenumbers.description',
			defaultMessage: 'Controls editor line-number presentation outside an Attempt.',
			description: 'Description of the editor line numbers setting.'
		})
	},
	{
		id: 'editor.minimap.enabled',
		type: 'boolean',
		default: true,
		storage: 'portableUser',
		domain: 'editor',
		windows: ['authenticated'],
		languageOverride: true,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.editor.minimap.title',
			defaultMessage: 'Minimap',
			description: 'Title for the editor minimap setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.minimap.description',
			defaultMessage: 'Shows the editor minimap outside an Attempt.',
			description: 'Description of the editor minimap setting.'
		})
	},
	{
		id: 'editor.cursorStyle',
		type: 'string',
		default: 'line',
		enum: ['line', 'block', 'underline'],
		storage: 'portableUser',
		domain: 'editor',
		windows: ['authenticated', 'candidate'],
		languageOverride: true,
		activation: 'immediate',
		candidate: 'eligible',
		title: defineMessage({
			id: 'settings.editor.cursorstyle.title',
			defaultMessage: 'Cursor style',
			description: 'Title for the editor cursor style setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.cursorstyle.description',
			defaultMessage: 'Selects the editor cursor shape.',
			description: 'Description of the editor cursor style setting.'
		})
	},
	{
		id: 'editor.cursorBlinking',
		type: 'string',
		default: 'blink',
		enum: ['blink', 'smooth', 'phase', 'expand', 'solid'],
		storage: 'portableUser',
		domain: 'editor',
		windows: ['authenticated', 'candidate'],
		languageOverride: true,
		activation: 'immediate',
		candidate: 'eligible',
		title: defineMessage({
			id: 'settings.editor.cursorblinking.title',
			defaultMessage: 'Cursor blinking',
			description: 'Title for the editor cursor blinking setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.cursorblinking.description',
			defaultMessage: 'Selects the editor cursor animation.',
			description: 'Description of the editor cursor blinking setting.'
		})
	},
	{
		id: 'accessibility.reducedMotion',
		type: 'boolean',
		default: false,
		storage: 'portableUser',
		domain: 'accessibility',
		windows: ['authenticated', 'candidate'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'policyConstrained',
		title: defineMessage({
			id: 'settings.accessibility.motion.title',
			defaultMessage: 'Reduced motion',
			description: 'Title for the reduced motion preference.'
		}),
		description: defineMessage({
			id: 'settings.accessibility.motion.description',
			defaultMessage: 'Reduces nonessential interface animation.',
			description: 'Description of the reduced motion preference.'
		})
	},
	{
		id: 'accessibility.screenReaderMode',
		type: 'string',
		default: 'auto',
		enum: ['auto', 'on', 'off'],
		storage: 'portableUser',
		domain: 'accessibility',
		windows: ['authenticated', 'candidate'],
		languageOverride: false,
		activation: 'nextWindow',
		candidate: 'policyConstrained',
		title: defineMessage({
			id: 'settings.accessibility.screenreader.title',
			defaultMessage: 'Screen reader mode',
			description: 'Title for the screen reader mode setting.'
		}),
		description: defineMessage({
			id: 'settings.accessibility.screenreader.description',
			defaultMessage: 'Controls screen-reader optimized presentation.',
			description: 'Description of the screen reader mode setting.'
		})
	},
	{
		id: 'accessibility.announcementMode',
		type: 'string',
		default: 'auto',
		enum: ['auto', 'verbose', 'minimal'],
		storage: 'portableUser',
		domain: 'accessibility',
		windows: ['authenticated', 'candidate'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'policyConstrained',
		title: defineMessage({
			id: 'settings.accessibility.announcements.title',
			defaultMessage: 'Announcements',
			description: 'Title for the assistive announcements setting.'
		}),
		description: defineMessage({
			id: 'settings.accessibility.announcements.description',
			defaultMessage: 'Controls the detail of assistive announcements.',
			description: 'Description of the assistive announcements setting.'
		})
	},
	{
		id: 'workbench.tree.indent',
		type: 'integer',
		default: 8,
		minimum: 4,
		maximum: 20,
		storage: 'portableUser',
		domain: 'navigation',
		windows: ['authenticated'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.navigation.indent.title',
			defaultMessage: 'Tree indentation',
			description: 'Title for the tree indentation setting.'
		}),
		description: defineMessage({
			id: 'settings.navigation.indent.description',
			defaultMessage: 'Sets indentation for hierarchical navigation outside an Attempt.',
			description: 'Description of the tree indentation setting.'
		}),
		migration: { from: 'explorer.tree.indent', removeAfter: 2 }
	},
	{
		id: 'terminal.integrated.fontSize',
		type: 'integer',
		default: 14,
		minimum: 12,
		maximum: 24,
		storage: 'device',
		domain: 'terminal',
		windows: ['authenticated'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.terminal.fontsize.title',
			defaultMessage: 'Terminal font size',
			description: 'Title for the terminal font size setting.'
		}),
		description: defineMessage({
			id: 'settings.terminal.fontsize.description',
			defaultMessage: 'Sets terminal presentation outside an Attempt.',
			description: 'Description of the terminal font size setting.'
		})
	},
	{
		id: 'browser.presentation.zoom',
		type: 'integer',
		default: 100,
		minimum: 80,
		maximum: 200,
		storage: 'device',
		domain: 'browser',
		windows: ['authenticated'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.browser.zoom.title',
			defaultMessage: 'Browser zoom',
			description: 'Title for the integrated browser zoom setting.'
		}),
		description: defineMessage({
			id: 'settings.browser.zoom.description',
			defaultMessage: 'Sets integrated-browser presentation outside an Attempt.',
			description: 'Description of the integrated browser zoom setting.'
		})
	},
	{
		id: 'terminal.integrated.shell',
		type: 'string',
		storage: 'portableUser',
		domain: 'security',
		windows: [],
		languageOverride: false,
		activation: 'nextWindow',
		candidate: 'prohibited',
		title: defineMessage({
			id: 'settings.prohibited.shell.title',
			defaultMessage: 'Terminal shell',
			description: 'Title for the prohibited terminal shell key.'
		}),
		description: defineMessage({
			id: 'settings.prohibited.shell.description',
			defaultMessage: 'Executable terminal selection is not a User Setting.',
			description: 'Description of the prohibited terminal shell key.'
		}),
		rejectionReason: defineMessage({
			id: 'settings.prohibited.shell.rejection',
			defaultMessage:
				'Execution configuration is server-authoritative and prohibited in User Settings.',
			description: 'Diagnostic reason for rejecting terminal shell configuration.'
		})
	},
	{
		id: 'http.proxy',
		type: 'string',
		storage: 'portableUser',
		domain: 'security',
		windows: [],
		languageOverride: false,
		activation: 'nextWindow',
		candidate: 'prohibited',
		title: defineMessage({
			id: 'settings.prohibited.proxy.title',
			defaultMessage: 'Network proxy',
			description: 'Title for the prohibited proxy key.'
		}),
		description: defineMessage({
			id: 'settings.prohibited.proxy.description',
			defaultMessage: 'Network routing is not a User Setting.',
			description: 'Description of the prohibited proxy key.'
		}),
		rejectionReason: defineMessage({
			id: 'settings.prohibited.proxy.rejection',
			defaultMessage: 'Network and browser policy are authoritative security configuration.',
			description: 'Diagnostic reason for rejecting proxy configuration.'
		})
	},
	{
		id: 'files.autoSave',
		type: 'string',
		storage: 'portableUser',
		domain: 'security',
		windows: [],
		languageOverride: false,
		activation: 'nextWindow',
		candidate: 'prohibited',
		title: defineMessage({
			id: 'settings.prohibited.autosave.title',
			defaultMessage: 'Automatic save',
			description: 'Title for the prohibited automatic save key.'
		}),
		description: defineMessage({
			id: 'settings.prohibited.autosave.description',
			defaultMessage: 'Workspace durability is not a User Setting.',
			description: 'Description of the prohibited automatic save key.'
		}),
		rejectionReason: defineMessage({
			id: 'settings.prohibited.autosave.rejection',
			defaultMessage:
				'Attempt Workspace durability is server-acknowledged and cannot be configured here.',
			description: 'Diagnostic reason for rejecting automatic save configuration.'
		})
	},
	{
		id: 'editor.defaultFormatter',
		type: 'string',
		storage: 'portableUser',
		domain: 'security',
		windows: [],
		languageOverride: true,
		activation: 'nextWindow',
		candidate: 'prohibited',
		title: defineMessage({
			id: 'settings.prohibited.formatter.title',
			defaultMessage: 'Default formatter',
			description: 'Title for the prohibited default formatter key.'
		}),
		description: defineMessage({
			id: 'settings.prohibited.formatter.description',
			defaultMessage: 'Executable formatter selection is not a User Setting.',
			description: 'Description of the prohibited default formatter key.'
		}),
		rejectionReason: defineMessage({
			id: 'settings.prohibited.formatter.rejection',
			defaultMessage:
				'Executable and extension-backed behavior is prohibited in User Settings.',
			description: 'Diagnostic reason for rejecting formatter configuration.'
		})
	}
] as const satisfies readonly SettingDeclaration[];

export type SettingId = (typeof SETTINGS_MANIFEST)[number]['id'];
export type EffectiveSettingId = Exclude<
	SettingId,
	'terminal.integrated.shell' | 'http.proxy' | 'files.autoSave' | 'editor.defaultFormatter'
>;

export interface SettingValueMap {
	readonly 'workbench.colorTheme': string;
	readonly 'workbench.colorCustomizations': IColorCustomizations;
	readonly 'workbench.preferHighContrast': boolean;
	readonly 'window.zoomLevel': number;
	readonly 'editor.fontSize': number;
	readonly 'editor.lineHeight': number;
	readonly 'editor.tabSize': number;
	readonly 'editor.wordWrap': 'off' | 'on' | 'wordWrapColumn' | 'bounded';
	readonly 'editor.lineNumbers': 'off' | 'on' | 'relative';
	readonly 'editor.minimap.enabled': boolean;
	readonly 'editor.cursorStyle': 'line' | 'block' | 'underline';
	readonly 'editor.cursorBlinking': 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
	readonly 'accessibility.reducedMotion': boolean;
	readonly 'accessibility.screenReaderMode': 'auto' | 'on' | 'off';
	readonly 'accessibility.announcementMode': 'auto' | 'verbose' | 'minimal';
	readonly 'workbench.tree.indent': number;
	readonly 'terminal.integrated.fontSize': number;
	readonly 'browser.presentation.zoom': number;
}
