/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ITokenColorCustomizations, ISemanticTokenColorCustomizations } from '../common/workbenchThemeService.js';
import { generateColorThemeCSS } from './colorThemeCss.js';
import './applicationFonts.js';
import { getThemingRegistry } from '../common/themeService.js';
import { getColorRegistry } from '../common/colorRegistry.js';
import { getSizeRegistry } from '../common/sizeRegistry.js';
import type { IColorCustomizations } from '../common/colorCustomizations.js';
import { asCssVariableName as asThemeColorVariable } from '../common/colorUtils.js';
import { Emitter, type Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { asCssVariableName, getDesignTokenDefinitions } from '../common/tokens.js';
import {
	getTheme,
	getDensityTokenOverrides,
	type Density,
	type MotionPreference,
	type ResolvedTheme,
	type TransparencyPreference
} from '../common/themes.js';

export interface PresentationPreferences {
	readonly density: Density;
	readonly motion: MotionPreference;
	readonly transparency: TransparencyPreference;
}

export interface BrowserThemeServiceOptions {
	readonly followSystemColorScheme?: boolean;
	/** The themes used for each system scheme while following it; the bundled defaults otherwise. */
	readonly systemThemes?: { readonly light: string; readonly dark: string };
}

export const BROWSER_THEME_SERVICE = 'prctr.platform.browserTheme';

export class BrowserThemeService extends Disposable {
	private readonly changeEmitter = this._register(new Emitter<ResolvedTheme>());
	readonly onDidChangeTheme: Event<ResolvedTheme> = this.changeEmitter.event;
	private readonly presentationChangeEmitter = this._register(new Emitter<void>());
	readonly onDidChangePresentation: Event<void> = this.presentationChangeEmitter.event;
	private currentTheme: ResolvedTheme;
	private readonly themeStyleSheet: CSSStyleSheet | undefined;
	/** The root presentation found at construction; disposal hands it back unchanged. */
	private readonly previousRoot: RootPresentation;
	private customizations: IColorCustomizations = {};
	private tokenCustomizations: ITokenColorCustomizations = {};
	private semanticCustomizations: ISemanticTokenColorCustomizations | undefined;
	private customizationKey = JSON.stringify([{}, {}, undefined]);
	private appliedColorVariables = new Set<string>();
	private preferences: PresentationPreferences;
	private zoomPercent = 100;
	private readonly forcedColorsQuery: MediaQueryList | undefined;
	private readonly colorSchemeQuery: MediaQueryList | undefined;
	private readonly reducedMotionQuery: MediaQueryList | undefined;
	private readonly reducedTransparencyQuery: MediaQueryList | undefined;
	private followsSystem: boolean;
	private readonly systemThemes: { readonly light: string; readonly dark: string };

	constructor(
		private readonly document: Document,
		initialTheme: string,
		preferences: PresentationPreferences,
		options: BrowserThemeServiceOptions = {}
	) {
		super();
		this.previousRoot = captureRootPresentation(document.documentElement);
		this.themeStyleSheet = document.defaultView ? new document.defaultView.CSSStyleSheet() : undefined;
		if (this.themeStyleSheet) document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.themeStyleSheet];
		this._register({ dispose: () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== this.themeStyleSheet); } });
		this._register(getThemingRegistry().onThemingParticipantAdded(() => this.applyThemeRules()));
		this.preferences = preferences;
		this.followsSystem = options.followSystemColorScheme === true;
		this.systemThemes = options.systemThemes ?? { light: 'light', dark: 'dark' };
		const matchMedia = document.defaultView?.matchMedia?.bind(document.defaultView);
		this.forcedColorsQuery = matchMedia?.('(forced-colors: active)');
		this.colorSchemeQuery = matchMedia?.('(prefers-color-scheme: dark)');
		this.reducedMotionQuery = matchMedia?.('(prefers-reduced-motion: reduce)');
		this.reducedTransparencyQuery = matchMedia?.('(prefers-reduced-transparency: reduce)');
		this.currentTheme = getTheme(this.followsSystem && this.colorSchemeQuery !== undefined ? this.systemTheme(this.colorSchemeQuery) : initialTheme);
		this.listen(this.forcedColorsQuery, () => { this.applyForcedColors(); this.presentationChangeEmitter.fire(); });
		this.listen(this.colorSchemeQuery, () => this.applySystemColorScheme());
		this.listen(this.reducedMotionQuery, () => { this.applyPreferences(); this.presentationChangeEmitter.fire(); });
		this.listen(this.reducedTransparencyQuery, () => { this.applyPreferences(); this.presentationChangeEmitter.fire(); });
		this.apply();
	}

	get presentationPreferences(): PresentationPreferences { return this.preferences; }

	get theme(): ResolvedTheme {
		return this.currentTheme;
	}

	/** The theme comes from the operating-system scheme rather than an explicit selection. */
	get followsSystemColorScheme(): boolean {
		return this.followsSystem;
	}

	get forcedColorsActive(): boolean {
		return this.forcedColorsQuery?.matches === true;
	}

	get reducedMotionActive(): boolean {
		return this.preferences.motion === 'reduced' || this.reducedMotionQuery?.matches === true;
	}

	setTheme(id: string, customizations: IColorCustomizations = {}, tokenCustomizations: ITokenColorCustomizations = {}, semanticCustomizations?: ISemanticTokenColorCustomizations): void {
		const theme = getTheme(id, customizations, tokenCustomizations, semanticCustomizations);
		const customizationKey = JSON.stringify([customizations, tokenCustomizations, semanticCustomizations]);
		const followed = this.followsSystem;
		this.followsSystem = false;
		if (theme.settingsId === this.currentTheme.settingsId && customizationKey === this.customizationKey && JSON.stringify(theme.colors) === JSON.stringify(this.currentTheme.colors)) {
			if (followed) this.presentationChangeEmitter.fire();
			return;
		}
		this.currentTheme = theme;
		this.customizations = customizations;
		this.tokenCustomizations = tokenCustomizations;
		this.semanticCustomizations = semanticCustomizations;
		this.customizationKey = customizationKey;
		this.apply();
		this.changeEmitter.fire(theme);
		this.presentationChangeEmitter.fire();
	}

	/**
	 * Follow the operating-system scheme with the system themes, keeping the given
	 * customizations. A later explicit selection through `setTheme` stops following.
	 */
	followSystemTheme(customizations: IColorCustomizations = {}, tokenCustomizations: ITokenColorCustomizations = {}, semanticCustomizations?: ISemanticTokenColorCustomizations): void {
		if (this.colorSchemeQuery === undefined) {
			this.setTheme(this.systemThemes.light, customizations, tokenCustomizations, semanticCustomizations);
			return;
		}
		const followed = this.followsSystem;
		this.followsSystem = true;
		this.customizations = customizations;
		this.tokenCustomizations = tokenCustomizations;
		this.semanticCustomizations = semanticCustomizations;
		this.customizationKey = JSON.stringify([customizations, tokenCustomizations, semanticCustomizations]);
		const theme = getTheme(this.systemTheme(this.colorSchemeQuery), customizations, tokenCustomizations, semanticCustomizations);
		if (theme.settingsId === this.currentTheme.settingsId && JSON.stringify(theme.colors) === JSON.stringify(this.currentTheme.colors)) {
			if (!followed) this.presentationChangeEmitter.fire();
			return;
		}
		this.currentTheme = theme;
		this.apply();
		this.changeEmitter.fire(theme);
		this.presentationChangeEmitter.fire();
	}

	setPreferences(preferences: PresentationPreferences): void {
		if (preferences.density === this.preferences.density
			&& preferences.motion === this.preferences.motion
			&& preferences.transparency === this.preferences.transparency) return;
		this.preferences = preferences;
		this.applyPreferences();
		this.presentationChangeEmitter.fire();
	}

	setMotionPreference(motion: MotionPreference): void {
		this.setPreferences(Object.freeze({ ...this.preferences, motion }));
	}

	setZoomPercent(zoomPercent: number): void {
		if (!Number.isSafeInteger(zoomPercent) || zoomPercent < 80 || zoomPercent > 200) throw new RangeError('Presentation zoom is outside packaged bounds');
		if (this.zoomPercent === zoomPercent) return;
		this.zoomPercent = zoomPercent;
		this.document.documentElement.style.zoom = String(zoomPercent / 100);
		this.presentationChangeEmitter.fire();
	}

	private applyThemeRules(): void {
		this.themeStyleSheet?.replaceSync(generateColorThemeCSS(this.currentTheme.colorTheme, ":root", getThemingRegistry().getThemingParticipants()).code);
	}

	private apply(): void {
		this.applyThemeRules();
		getColorRegistry().notifyThemeUpdate(this.currentTheme.colorTheme);
		getSizeRegistry().notifyThemeUpdate(this.currentTheme.colorTheme);
		const root = this.document.documentElement;
		for (const definition of getDesignTokenDefinitions()) {
			root.style.setProperty(asCssVariableName(definition.id), this.currentTheme.values[definition.id]);
		}
		const nextVariables = new Set<string>();
		for (const [id, color] of Object.entries(this.currentTheme.colors)) {
			const variable = asThemeColorVariable(id);
			root.style.setProperty(variable, color);
			nextVariables.add(variable);
		}
		for (const variable of this.appliedColorVariables) if (!nextVariables.has(variable)) root.style.removeProperty(variable);
		this.appliedColorVariables = nextVariables;
		root.dataset.prctrTheme = this.currentTheme.id;
		root.dataset.prctrThemeName = this.currentTheme.settingsId;
		root.dataset.prctrThemeContrast = this.currentTheme.isHighContrast ? 'high' : 'normal';
		root.style.colorScheme = this.currentTheme.isDark ? 'dark' : 'light';
		this.applyPreferences();
		this.applyForcedColors();
	}

	private applyPreferences(): void {
		const root = this.document.documentElement;
		const motion = this.preferences.motion === 'reduced' || this.reducedMotionQuery?.matches === true ? 'reduced' : 'full';
		const transparency = this.preferences.transparency === 'reduced' || this.reducedTransparencyQuery?.matches === true ? 'reduced' : 'full';
		const densityOverrides = getDensityTokenOverrides(this.preferences.density);
		for (const definition of getDesignTokenDefinitions()) {
			let value = densityOverrides[definition.id] ?? this.currentTheme.values[definition.id];
			if (motion === 'reduced' && definition.kind === 'duration') value = '0ms';
			if (transparency === 'reduced' && definition.id === 'color.overlay.backdrop') {
				value = this.currentTheme.isDark ? '#000000' : '#ffffff';
			}
			root.style.setProperty(asCssVariableName(definition.id), value);
		}
		root.dataset.prctrDensity = this.preferences.density;
		root.dataset.prctrMotion = motion;
		root.dataset.prctrTransparency = transparency;
	}

	private applySystemColorScheme(): void {
		if (!this.followsSystem || this.colorSchemeQuery === undefined) return;
		const theme = getTheme(this.systemTheme(this.colorSchemeQuery), this.customizations, this.tokenCustomizations, this.semanticCustomizations);
		if (theme.settingsId === this.currentTheme.settingsId && JSON.stringify(theme.colors) === JSON.stringify(this.currentTheme.colors)) return;
		this.currentTheme = theme;
		this.apply();
		this.changeEmitter.fire(theme);
		this.presentationChangeEmitter.fire();
	}

	private systemTheme(query: MediaQueryList): string {
		return query.matches ? this.systemThemes.dark : this.systemThemes.light;
	}

	private listen(query: MediaQueryList | undefined, listener: () => void): void {
		if (query === undefined) return;
		query.addEventListener('change', listener);
		this._register({ dispose: () => query.removeEventListener('change', listener) });
	}

	private applyForcedColors(): void {
		this.document.documentElement.dataset.prctrForcedColors = this.forcedColorsActive ? 'active' : 'none';
	}

	override dispose(): void {
		// A nested owner, such as a test fixture on a shared document, must not erase the outer owner's theme.
		const owned = [
			...getDesignTokenDefinitions().map(definition => asCssVariableName(definition.id)),
			...this.appliedColorVariables,
			'color-scheme',
			'zoom'
		];
		restoreRootPresentation(this.document.documentElement, this.previousRoot, owned);
		this.appliedColorVariables.clear();
		super.dispose();
	}
}

const ROOT_PRESENTATION_ATTRIBUTES = [
	'data-prctr-theme-name',
	'data-prctr-theme',
	'data-prctr-theme-contrast',
	'data-prctr-density',
	'data-prctr-motion',
	'data-prctr-transparency',
	'data-prctr-forced-colors'
] as const;

interface RootPresentation {
	/** Inline style properties present before this owner, with their values. */
	readonly style: ReadonlyMap<string, string>;
	readonly attributes: ReadonlyMap<string, string | null>;
}

function captureRootPresentation(root: HTMLElement): RootPresentation {
	const style = new Map<string, string>();
	for (let index = 0; index < root.style.length; index++) {
		const property = root.style.item(index);
		style.set(property, root.style.getPropertyValue(property));
	}
	return {
		style,
		attributes: new Map(ROOT_PRESENTATION_ATTRIBUTES.map(name => [name, root.getAttribute(name)]))
	};
}

/** Puts back only what this owner wrote: its style properties and presentation attributes. */
function restoreRootPresentation(root: HTMLElement, previous: RootPresentation, ownedProperties: readonly string[]): void {
	for (const property of ownedProperties) {
		const value = previous.style.get(property);
		if (value === undefined) {
			root.style.removeProperty(property);
		} else {
			root.style.setProperty(property, value);
		}
	}
	for (const [name, value] of previous.attributes) {
		if (value === null) {
			root.removeAttribute(name);
		} else {
			root.setAttribute(name, value);
		}
	}
}
