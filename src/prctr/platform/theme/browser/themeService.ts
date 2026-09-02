/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { asCssVariableName, getDesignTokenDefinitions } from '../common/tokens.js';
import {
	getTheme,
	getDensityTokenOverrides,
	type Density,
	type MotionPreference,
	type ResolvedTheme,
	type ThemeId,
	type TransparencyPreference
} from '../common/themes.js';

export interface PresentationPreferences {
	readonly density: Density;
	readonly motion: MotionPreference;
	readonly transparency: TransparencyPreference;
}

export interface BrowserThemeServiceOptions {
	readonly followSystemColorScheme?: boolean;
}

export const BROWSER_THEME_SERVICE = 'prctr.platform.browserTheme';

export class BrowserThemeService extends Disposable {
	private readonly changeEmitter = this._register(new Emitter<ResolvedTheme>());
	readonly onDidChangeTheme: Event<ResolvedTheme> = this.changeEmitter.event;
	private readonly presentationChangeEmitter = this._register(new Emitter<void>());
	readonly onDidChangePresentation: Event<void> = this.presentationChangeEmitter.event;
	private currentTheme: ResolvedTheme;
	private preferences: PresentationPreferences;
	private zoomPercent = 100;
	private readonly forcedColorsQuery: MediaQueryList | undefined;
	private readonly colorSchemeQuery: MediaQueryList | undefined;
	private readonly reducedMotionQuery: MediaQueryList | undefined;
	private readonly reducedTransparencyQuery: MediaQueryList | undefined;
	private followsSystemColorScheme: boolean;

	constructor(
		private readonly document: Document,
		initialTheme: ThemeId,
		preferences: PresentationPreferences,
		options: BrowserThemeServiceOptions = {}
	) {
		super();
		this.preferences = preferences;
		this.followsSystemColorScheme = options.followSystemColorScheme === true;
		const matchMedia = document.defaultView?.matchMedia?.bind(document.defaultView);
		this.forcedColorsQuery = matchMedia?.('(forced-colors: active)');
		this.colorSchemeQuery = matchMedia?.('(prefers-color-scheme: dark)');
		this.reducedMotionQuery = matchMedia?.('(prefers-reduced-motion: reduce)');
		this.reducedTransparencyQuery = matchMedia?.('(prefers-reduced-transparency: reduce)');
		this.currentTheme = getTheme(this.followsSystemColorScheme && this.colorSchemeQuery !== undefined ? this.colorSchemeQuery.matches ? 'dark' : 'light' : initialTheme);
		this.listen(this.forcedColorsQuery, () => { this.applyForcedColors(); this.presentationChangeEmitter.fire(); });
		this.listen(this.colorSchemeQuery, () => this.applySystemColorScheme());
		this.listen(this.reducedMotionQuery, () => { this.applyPreferences(); this.presentationChangeEmitter.fire(); });
		this.listen(this.reducedTransparencyQuery, () => { this.applyPreferences(); this.presentationChangeEmitter.fire(); });
		this.apply();
	}

	get theme(): ResolvedTheme {
		return this.currentTheme;
	}

	get forcedColorsActive(): boolean {
		return this.forcedColorsQuery?.matches === true;
	}

	get reducedMotionActive(): boolean {
		return this.preferences.motion === 'reduced' || this.reducedMotionQuery?.matches === true;
	}

	setTheme(id: ThemeId): void {
		this.followsSystemColorScheme = false;
		const theme = getTheme(id);
		if (theme === this.currentTheme) return;
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

	private apply(): void {
		const root = this.document.documentElement;
		for (const definition of getDesignTokenDefinitions()) {
			root.style.setProperty(asCssVariableName(definition.id), this.currentTheme.values[definition.id]);
		}
		root.dataset.prctrTheme = this.currentTheme.id;
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
		if (!this.followsSystemColorScheme || this.colorSchemeQuery === undefined) return;
		const theme = getTheme(this.colorSchemeQuery.matches ? 'dark' : 'light');
		if (theme === this.currentTheme) return;
		this.currentTheme = theme;
		this.apply();
		this.changeEmitter.fire(theme);
		this.presentationChangeEmitter.fire();
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
		const root = this.document.documentElement;
		for (const definition of getDesignTokenDefinitions()) {
			root.style.removeProperty(asCssVariableName(definition.id));
		}
		delete root.dataset.prctrTheme;
		delete root.dataset.prctrThemeContrast;
		delete root.dataset.prctrDensity;
		delete root.dataset.prctrMotion;
		delete root.dataset.prctrTransparency;
		delete root.dataset.prctrForcedColors;
		root.style.removeProperty('color-scheme');
		root.style.removeProperty('zoom');
		super.dispose();
	}
}
