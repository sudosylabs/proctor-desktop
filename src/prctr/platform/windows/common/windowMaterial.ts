/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * The backdrop a window draws behind its page. `glass` is macOS Liquid Glass
 * (macOS 26 and later), `vibrancy` its fallback on earlier macOS, `mica` the
 * Windows 11 material, and `none` an opaque window in the theme's own color.
 */
export type WindowBackgroundMaterial = 'none' | 'vibrancy' | 'glass' | 'mica';

export function isWindowBackgroundMaterial(value: unknown): value is WindowBackgroundMaterial {
	return value === 'none' || value === 'vibrancy' || value === 'glass' || value === 'mica';
}

/** The system settings that turn a material off. */
export interface WindowMaterialPreferences {
	readonly reducedTransparency: boolean;
	readonly highContrast: boolean;
}

/** Darwin 25 is macOS 26, the first release with Liquid Glass. */
const FIRST_GLASS_DARWIN = 25;
/** Darwin 18 is macOS 10.14, the first release with the `sidebar` vibrancy. */
const FIRST_VIBRANCY_DARWIN = 18;
/** Windows 11 22H2, the first build where Electron's Mica applies. */
const FIRST_MICA_BUILD = 22621;

/**
 * The best material this system supports. Reduce Transparency and Increase
 * Contrast always win: the window is then opaque, as the person asked.
 */
export function resolveWindowMaterial(
	platform: string,
	osRelease: string,
	preferences: WindowMaterialPreferences
): WindowBackgroundMaterial {
	if (preferences.reducedTransparency || preferences.highContrast) {
		return 'none';
	}
	return supportedWindowMaterial(platform, osRelease);
}

/** The material the system could show, ignoring the person's current settings. */
export function supportedWindowMaterial(
	platform: string,
	osRelease: string
): WindowBackgroundMaterial {
	const version = /^(\d+)\.(\d+)\.(\d+)/.exec(osRelease);
	if (version === null) {
		return 'none';
	}
	const major = Number(version[1]);
	const build = Number(version[3]);
	if (platform === 'darwin' && major >= FIRST_GLASS_DARWIN) {
		return 'glass';
	}
	if (platform === 'darwin' && major >= FIRST_VIBRANCY_DARWIN) {
		return 'vibrancy';
	}
	if (platform === 'win32' && major >= 10 && build >= FIRST_MICA_BUILD) {
		return 'mica';
	}
	return 'none';
}
