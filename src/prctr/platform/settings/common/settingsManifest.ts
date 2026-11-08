import type {
	ITokenColorCustomizations,
	ISemanticTokenColorCustomizations
} from '../../theme/common/tokenCustomizationTypes.js';
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

export type SettingStorageScope = 'portableUser' | 'device';
export type SettingDomain =
	'appearance' | 'accessibility' | 'editor' | 'navigation' | 'browser' | 'security';
export type SettingWindow = 'authenticated' | 'candidate';
export type SettingActivation = 'immediate' | 'nextWindow';
export type CandidateTreatment =
	'eligible' | 'policyConstrained' | 'nonCandidateOnly' | 'prohibited';

export interface SettingDeclaration {
	readonly id: string;
	readonly type: 'boolean' | 'number' | 'integer' | 'string' | 'object';
	readonly default?: boolean | number | string | IColorCustomizations;
	readonly platformDefaults?: Readonly<
		Partial<Record<'mac' | 'windows' | 'linux', boolean | number | string>>
	>;
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
	readonly rejectionReason?: SettingMessageDescriptor;
}

/** Literal packaged authority. No runtime or remote contribution may append declarations. */
export const SETTINGS_MANIFEST = [
	{
		id: 'workbench.hover.delay',
		type: 'number',
		default: 500,
		platformDefaults: { mac: 1500 },
		minimum: 0,
		storage: 'portableUser',
		domain: 'appearance',
		windows: ['authenticated'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.hover.delay.title',
			defaultMessage: 'Tooltip delay',
			description: 'Title for the workbench hover delay setting.'
		}),
		description: defineMessage({
			id: 'settings.hover.delay.description',
			defaultMessage: 'How long to point at something before its tooltip shows.',
			description: 'Description of the source workbench hover delay.'
		})
	},
	{
		id: 'workbench.hover.reducedDelay',
		type: 'number',
		default: 500,
		minimum: 0,
		storage: 'portableUser',
		domain: 'appearance',
		windows: ['authenticated'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.hover.reduced.delay.title',
			defaultMessage: 'Reduced hover delay',
			description: 'Title for the reduced workbench hover delay setting.'
		}),
		description: defineMessage({
			id: 'settings.hover.reduced.delay.description',
			defaultMessage:
				'Controls the reduced delay in milliseconds used for showing hovers in specific contexts where faster feedback is beneficial.',
			description: 'Description of the source reduced hover delay.'
		})
	},
	{
		id: 'editor.semanticTokenColorCustomizations',
		type: 'object',
		default: {},
		storage: 'portableUser',
		domain: 'appearance',
		windows: ['authenticated'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.semantic.token.colors.title',
			defaultMessage: 'Semantic token color customizations',
			description: 'Title for editor token theme customization.'
		}),
		description: defineMessage({
			id: 'settings.semantic.token.colors.description',
			defaultMessage: 'Overrides semantic token colors and styles from the selected theme.',
			description: 'Description of data-only editor token styles.'
		})
	},
	{
		id: 'editor.tokenColorCustomizations',
		type: 'object',
		default: {},
		storage: 'portableUser',
		domain: 'appearance',
		windows: ['authenticated'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.token.colors.title',
			defaultMessage: 'Token color customizations',
			description: 'Title for editor token theme customization.'
		}),
		description: defineMessage({
			id: 'settings.token.colors.description',
			defaultMessage:
				'Overrides editor syntax colors and font style from the selected theme.',
			description: 'Description of data-only editor token styles.'
		})
	},
	{
		id: 'window.theme',
		type: 'string',
		default: 'system',
		enum: ['system', 'light', 'dark'],
		storage: 'portableUser',
		domain: 'appearance',
		windows: ['authenticated'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'nonCandidateOnly',
		title: defineMessage({
			id: 'settings.window.theme.title',
			defaultMessage: 'Window theme',
			description:
				'Title for the Proctor Light or Dark choice of the sign-in and signed-in windows.'
		}),
		description: defineMessage({
			id: 'settings.window.theme.description',
			defaultMessage: 'For sign-in and this window. Exams use the editor theme.',
			description: 'Description of the window theme setting.'
		})
	},
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
		windows: ['candidate'],
		languageOverride: false,
		activation: 'immediate',
		candidate: 'eligible',
		title: defineMessage({
			id: 'settings.theme.title',
			defaultMessage: 'Editor theme',
			description: 'Title for the packaged color theme setting.'
		}),
		description: defineMessage({
			id: 'settings.theme.description',
			defaultMessage: 'Colours for code in the exam editor.',
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
			defaultMessage: 'High contrast',
			description: 'Title for the high contrast preference.'
		}),
		description: defineMessage({
			id: 'settings.contrast.description',
			defaultMessage: 'Stronger borders and text, for either theme.',
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
			defaultMessage: 'Interface size',
			description: 'Title for the interface zoom setting.'
		}),
		description: defineMessage({
			id: 'settings.zoom.description',
			defaultMessage: 'Makes everything in Proctor larger or smaller.',
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
			defaultMessage: 'Font size',
			description: 'Title for the editor font size setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.fontsize.description',
			defaultMessage: 'Text size in the editor.',
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
			defaultMessage: 'Line height',
			description: 'Title for the editor line height setting.'
		}),
		description: defineMessage({
			id: 'settings.editor.lineheight.description',
			defaultMessage: 'Space between lines in the editor.',
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
			defaultMessage: 'How wide one level of indentation looks.',
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
			defaultMessage: 'Wrap long lines instead of scrolling sideways.',
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
			defaultMessage: 'Numbers beside each line of code.',
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
			defaultMessage: 'A small outline of the file beside the code.',
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
			defaultMessage: 'The shape of the text cursor.',
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
			defaultMessage: 'How the text cursor animates.',
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
			defaultMessage: 'Turns off nonessential animation.',
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
			defaultMessage: 'Optimises the editor for screen readers.',
			description: 'Description of the screen reader mode setting.'
		})
	},
	{
		id: 'accessibility.announcementMode',
		type: 'string',
		default: 'minimal',
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
			defaultMessage: 'How much Proctor says when something changes.',
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
			defaultMessage: 'How far nested files are indented.',
			description: 'Description of the tree indentation setting.'
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
			defaultMessage: 'Page zoom',
			description: 'Title for the integrated browser zoom setting.'
		}),
		description: defineMessage({
			id: 'settings.browser.zoom.description',
			defaultMessage: 'Zoom for pages opened in the exam browser.',
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
	readonly 'workbench.hover.delay': number;
	readonly 'workbench.hover.reducedDelay': number;
	readonly 'editor.tokenColorCustomizations': ITokenColorCustomizations;
	readonly 'editor.semanticTokenColorCustomizations': ISemanticTokenColorCustomizations;
	readonly 'window.theme': 'system' | 'light' | 'dark';
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
