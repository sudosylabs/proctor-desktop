/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import {
	resolveWindowMaterial,
	supportedWindowMaterial,
	type WindowBackgroundMaterial,
	type WindowMaterialPreferences
} from '../common/windowMaterial.js';

/** Presentation of one glass attachment; see @vnilink/elg. */
export interface GlassOptions {
	readonly cornerRadius?: number;
	/** sRGB `#RRGGBB` or `#RRGGBBAA`; omitted, the glass is untinted. */
	readonly tintColor?: string;
	/** Puts the window's own material behind the glass, so it refracts the window rather than the desktop. */
	readonly opaque?: boolean;
}

/**
 * The part of @vnilink/elg's `LiquidGlass` owner Proctor uses. Declared here
 * because the package installs only on macOS, so other platforms cannot
 * import its types; `liquidGlass.ts` loads it.
 */
export interface LiquidGlassOwner {
	isGlassSupported(): boolean;
	/** A whole-window view is one per window, so adding it again updates it. */
	addView(handle: Uint8Array, options?: GlassOptions): number;
	removeView(id: number): boolean;
	dispose(): void;
}

/** The part of Electron's `BrowserWindow` a material changes. */
export interface MaterialWindow {
	isDestroyed(): boolean;
	setVibrancy(type: 'sidebar' | null): void;
	setBackgroundMaterial(material: 'mica' | 'none'): void;
	setBackgroundColor(color: string): void;
	getNativeWindowHandle(): Uint8Array;
}

/** The theme and accessibility settings a material follows: Electron's `nativeTheme`. */
export interface MaterialTheme {
	readonly shouldUseDarkColors: boolean;
	readonly prefersReducedTransparency: boolean;
	readonly shouldUseHighContrastColors: boolean;
	on(event: 'updated', listener: () => void): unknown;
	off(event: 'updated', listener: () => void): unknown;
}

export interface WindowMaterialOptions {
	readonly platform: string;
	readonly osRelease: string;
	readonly theme: MaterialTheme;
	/** The opaque window color for each scheme, used whenever no material shows. */
	readonly background: (dark: boolean) => string;
	readonly createGlass: () => LiquidGlassOwner | undefined;
}

/**
 * Light glass carries a little of the page's own off-white, as AppKit's
 * sidebars carry grey, so it reads as Proctor's surface over any window;
 * dark glass reads apart from the page untinted.
 */
function glassOptions(dark: boolean): GlassOptions {
	return dark ? { opaque: true } : { opaque: true, tintColor: '#FBFBFAB3' };
}

/** The window options a material needs at creation, before the owner can change it. */
export function windowMaterialCreationOptions(
	platform: string,
	osRelease: string,
	preferences: WindowMaterialPreferences,
	background: string
): {
	readonly backgroundColor: string;
	readonly transparent?: boolean;
	readonly vibrancy?: 'sidebar';
	readonly backgroundMaterial?: 'mica';
} {
	const material = resolveWindowMaterial(platform, osRelease, preferences);
	return {
		backgroundColor: material === 'none' ? background : '#00000000',
		// Glass shows only in a non-opaque window. This follows what the system supports, not
		// the current settings, so turning Reduce Transparency off later can bring glass back.
		...(supportedWindowMaterial(platform, osRelease) === 'glass' ? { transparent: true } : {}),
		...(material === 'vibrancy' ? { vibrancy: 'sidebar' as const } : {}),
		...(material === 'mica' ? { backgroundMaterial: 'mica' as const } : {})
	};
}

/**
 * Owns one window's native backdrop. On macOS 26 and later that is Liquid
 * Glass behind the page, falling back to vibrancy when glass cannot attach;
 * on Windows 11 it is Mica; otherwise, or with Reduce Transparency or
 * Increase Contrast on, the window is opaque. It follows those settings while
 * the window lives.
 */
export class WindowMaterial extends Disposable {
	private readonly changeEmitter = this._register(new Emitter<WindowBackgroundMaterial>());
	readonly onDidChange = this.changeEmitter.event;

	private current: WindowBackgroundMaterial = 'none';
	/** One owner per window, kept for the window's life: a collected owner removes its glass. */
	private glass: LiquidGlassOwner | undefined;
	private glassCreated = false;
	private glassView = -1;

	constructor(
		private readonly window: MaterialWindow,
		private readonly options: WindowMaterialOptions
	) {
		super();
		this._register(
			toDisposable(() => {
				this.glass?.dispose();
				this.glass = undefined;
			})
		);
		this.update();
		const onUpdated = (): void => {
			this.update();
		};
		options.theme.on('updated', onUpdated);
		this._register(toDisposable(() => options.theme.off('updated', onUpdated)));
	}

	get material(): WindowBackgroundMaterial {
		return this.current;
	}

	private update(): void {
		if (this.window.isDestroyed()) {
			return;
		}
		const { platform, osRelease, theme } = this.options;
		const dark = theme.shouldUseDarkColors;
		let material = resolveWindowMaterial(platform, osRelease, {
			reducedTransparency: theme.prefersReducedTransparency,
			highContrast: theme.shouldUseHighContrastColors
		});
		try {
			if (material === 'glass' && !this.attachGlass(dark)) {
				material = 'vibrancy';
			}
			if (material !== 'glass') {
				this.detachGlass();
			}
			if (platform === 'darwin') {
				this.window.setVibrancy(material === 'vibrancy' ? 'sidebar' : null);
			} else if (supportedWindowMaterial(platform, osRelease) === 'mica') {
				this.window.setBackgroundMaterial(material === 'mica' ? 'mica' : 'none');
			}
			this.window.setBackgroundColor(
				material === 'none' ? this.options.background(dark) : '#00000000'
			);
		} catch {
			// A supported system can still refuse composition; the window stays opaque.
			this.detachGlass();
			material = 'none';
			this.window.setBackgroundColor(this.options.background(dark));
		}
		if (material !== this.current) {
			this.current = material;
			this.changeEmitter.fire(material);
		}
	}

	/**
	 * Attaches glass, or updates it. The system removes glass when Reduce
	 * Transparency or Increase Contrast turns on and does not restore it, so
	 * every settings change attaches again.
	 */
	private attachGlass(dark: boolean): boolean {
		if (!this.glassCreated) {
			this.glassCreated = true;
			this.glass = this.options.createGlass();
		}
		if (this.glass === undefined || !this.glass.isGlassSupported()) {
			return false;
		}
		this.glassView = this.glass.addView(
			this.window.getNativeWindowHandle(),
			glassOptions(dark)
		);
		return this.glassView >= 0;
	}

	private detachGlass(): void {
		if (this.glassView >= 0) {
			this.glass?.removeView(this.glassView);
			this.glassView = -1;
		}
	}
}
