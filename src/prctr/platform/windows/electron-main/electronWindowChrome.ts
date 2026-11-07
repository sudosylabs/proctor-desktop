/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port electron-window-skeleton

import type { IpcMainInvokeEvent, WebContents, ipcMain } from 'electron';
import { Color } from '../../../base/common/color.js';
import { isTahoeOrNewer } from '../../../base/common/platform.js';
import { getTheme, type ThemeId } from '../../theme/common/themes.js';
import {
	AUTHENTICATED_MACOS_TITLEBAR_HEIGHT,
	AUTHENTICATED_MACOS_TRAFFIC_LIGHT_X,
	AUTHENTICATED_TITLEBAR_HEIGHT,
	DEFAULT_PRODUCT_TITLEBAR_HEIGHT,
	LAUNCH_MACOS_TITLEBAR_HEIGHT,
	LAUNCH_TITLEBAR_HEIGHT,
	MACOS_PRODUCT_TITLEBAR_HEIGHT,
	MACOS_TAHOE_PRODUCT_TITLEBAR_HEIGHT,
	type ChromeCapableProductWindowKind,
	type ProductWindowChromeConfiguration,
	type ProductWindowChromePlatform,
	type ProductWindowChromeColors,
	validateProductWindowChromeUpdate
} from '../common/windowChrome.js';
import { WINDOW_CHROME_CHANNELS } from '../common/windowChannels.js';
import type { WindowBackgroundMaterial } from '../common/windowMaterial.js';

/** The window's backdrop, as its owner reports it. */
export interface ElectronWindowMaterialSource {
	readonly material: WindowBackgroundMaterial;
	onDidChange(listener: (material: WindowBackgroundMaterial) => void): { dispose(): void };
}

export type ElectronPlatform = ProductWindowChromePlatform;

export interface ElectronWindowChromeTarget {
	/** Pins the native scheme to the page's, or releases it while the page follows the system. */
	readonly synchronizeTheme?: (scheme: 'light' | 'dark' | 'system') => void;
	readonly window: {
		isFullScreen(): boolean;
		isDestroyed(): boolean;
		off(event: 'enter-full-screen' | 'leave-full-screen', listener: () => void): unknown;
		on(event: 'enter-full-screen' | 'leave-full-screen', listener: () => void): unknown;
		setSheetOffset(offsetY: number, offsetX?: number): void;
		setTitleBarOverlay(options: {
			readonly color?: string;
			readonly symbolColor?: string;
			readonly height?: number;
		}): void;
		setWindowButtonPosition(position: { readonly x: number; readonly y: number } | null): void;
	};
	readonly contents: Pick<WebContents, 'id' | 'isDestroyed' | 'mainFrame' | 'send'>;
}

export function resolveProductWindowChromeConfiguration(
	platform: ElectronPlatform,
	locale: string,
	macOsRelease: string,
	kind?: ChromeCapableProductWindowKind
): ProductWindowChromeConfiguration {
	const macos = platform === 'darwin';
	// LaunchWindow and AuthenticatedWindow keep their accepted designs' title bars on every release.
	const launchHeight = macos ? LAUNCH_MACOS_TITLEBAR_HEIGHT : LAUNCH_TITLEBAR_HEIGHT;
	const authenticatedHeight = macos
		? AUTHENTICATED_MACOS_TITLEBAR_HEIGHT
		: AUTHENTICATED_TITLEBAR_HEIGHT;
	return Object.freeze({
		platform,
		mode: macos ? 'nativeTrafficLights' : 'nativeOverlay',
		controlsLocation: macos && isRightToLeftLocale(locale) ? 'right' : macos ? 'left' : 'right',
		// The bridge reports the live material; a window without an owner has none.
		material: 'none',
		titlebarHeight: kind === 'launch'
			? launchHeight
			: kind === 'authenticated'
			? authenticatedHeight
			: macos
			? isTahoeOrNewer(macOsRelease)
				? MACOS_TAHOE_PRODUCT_TITLEBAR_HEIGHT
				: MACOS_PRODUCT_TITLEBAR_HEIGHT
			: DEFAULT_PRODUCT_TITLEBAR_HEIGHT,
		fullscreen: false
	});
}

export class ElectronWindowChromeBridge {
	readonly #channels: (typeof WINDOW_CHROME_CHANNELS)[ChromeCapableProductWindowKind];
	readonly #kind: ChromeCapableProductWindowKind;
	readonly #configuration: ProductWindowChromeConfiguration;
	readonly #ipc: Pick<typeof ipcMain, 'handle' | 'removeHandler'>;
	readonly #target: ElectronWindowChromeTarget;
	readonly #authorize: (event: IpcMainInvokeEvent) => void;
	readonly #material: ElectronWindowMaterialSource | undefined;
	#materialSubscription: { dispose(): void } | undefined;
	#disposed = false;
	#lastUpdate:
		| { readonly theme: ThemeId; readonly titlebarHeight: number; readonly dimmed: boolean; readonly followsSystemScheme: boolean; readonly colors?: ProductWindowChromeColors }
		| undefined;
	readonly #onDidEnterFullScreen = (): void => this.#sendFullscreen(true);
	readonly #onDidLeaveFullScreen = (): void => this.#sendFullscreen(false);

	constructor(
		ipc: Pick<typeof ipcMain, 'handle' | 'removeHandler'>,
		target: ElectronWindowChromeTarget,
		kind: ChromeCapableProductWindowKind,
		configuration: ProductWindowChromeConfiguration,
		initialTheme: ThemeId,
		authorize: (event: IpcMainInvokeEvent) => void,
		material?: ElectronWindowMaterialSource
	) {
		this.#ipc = ipc;
		this.#target = target;
		this.#channels = WINDOW_CHROME_CHANNELS[kind];
		this.#kind = kind;
		this.#configuration = configuration;
		this.#authorize = authorize;
		this.#material = material;
		const handled: string[] = [];
		try {
			this.#apply(initialTheme, configuration.titlebarHeight, false, true);
			target.window.on('enter-full-screen', this.#onDidEnterFullScreen);
			target.window.on('leave-full-screen', this.#onDidLeaveFullScreen);
			ipc.handle(this.#channels.configuration, (event) => {
				this.#authorize(event);
				return Object.freeze({
					...this.#configuration,
					fullscreen: this.#target.window.isFullScreen(),
					material: this.#material?.material ?? 'none'
				});
			});
			handled.push(this.#channels.configuration);
			ipc.handle(this.#channels.update, (event, value: unknown) => {
				this.#authorize(event);
				const update = validateProductWindowChromeUpdate(value);
				this.#apply(update.theme, update.titlebarHeight, update.dimmed, update.followsSystemScheme, update.colors);
			});
			handled.push(this.#channels.update);
			this.#materialSubscription = material?.onDidChange((value) => {
				this.#sendMaterial(value);
			});
		} catch (error) {
			const cleanupErrors = this.#releaseResources(handled.reverse());
			if (cleanupErrors.length > 0)
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Window chrome construction and rollback failed'
				);
			throw error;
		}
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const errors = this.#releaseResources([
			this.#channels.update,
			this.#channels.configuration
		]);
		if (errors.length > 0)
			throw new AggregateError(errors, 'Window chrome disposal failed');
	}

	#releaseResources(channels: readonly string[]): unknown[] {
		const errors: unknown[] = [];
		for (const release of [
			() => this.#materialSubscription?.dispose(),
			() => this.#target.window.off('leave-full-screen', this.#onDidLeaveFullScreen),
			() => this.#target.window.off('enter-full-screen', this.#onDidEnterFullScreen),
			...channels.map((channel) => () => this.#ipc.removeHandler(channel))
		]) {
			try {
				release();
			} catch (error) {
				errors.push(error);
			}
		}
		return errors;
	}

	#sendFullscreen(fullscreen: boolean): void {
		if (this.#disposed || this.#target.contents.isDestroyed()) return;
		this.#target.contents.send(this.#channels.fullscreenChanged, fullscreen);
	}

	#sendMaterial(material: WindowBackgroundMaterial): void {
		if (this.#disposed || this.#target.contents.isDestroyed()) return;
		this.#target.contents.send(this.#channels.materialChanged, material);
		const last = this.#lastUpdate;
		if (last !== undefined && this.#configuration.mode === 'nativeOverlay') {
			// The caption buttons' background follows the material, so apply the last update again.
			this.#lastUpdate = undefined;
			this.#apply(last.theme, last.titlebarHeight, last.dimmed, last.followsSystemScheme, last.colors);
		}
	}

	#apply(themeId: ThemeId, titlebarHeight: number, dimmed: boolean, followsSystemScheme: boolean, colors?: ProductWindowChromeColors): void {
		if (this.#disposed || this.#target.window.isDestroyed()) return;
		if (
			this.#lastUpdate?.theme === themeId &&
			this.#lastUpdate.titlebarHeight === titlebarHeight &&
			this.#lastUpdate.dimmed === dimmed &&
			this.#lastUpdate.followsSystemScheme === followsSystemScheme &&
			JSON.stringify(this.#lastUpdate.colors) === JSON.stringify(colors)
		)
			return;
		// A pinned scheme would hide later system changes from a page that follows them.
		this.#target.synchronizeTheme?.(followsSystemScheme ? 'system' : getTheme(themeId).isDark ? 'dark' : 'light');
		if (this.#configuration.mode === 'nativeOverlay') {
			const theme = getTheme(themeId);
			const background = colors?.background ?? theme.values['color.background.canvas'];
			const foreground = colors?.foreground ?? theme.colors['titleBar.activeForeground'] ?? theme.values['color.text.primary'];
			// Over Mica the caption buttons sit on the material itself.
			const overMica = this.#material?.material === 'mica';
			this.#target.window.setTitleBarOverlay({
				color: overMica ? '#00000000' : dimmed ? dimColor(background) : background,
				symbolColor: dimmed ? dimColor(foreground) : foreground,
				height: titlebarHeight - 1
			});
		} else {
			// Only the pre-Tahoe standard title bar uses the taller pre-Tahoe button frame.
			const buttonHeight = this.#configuration.titlebarHeight === MACOS_PRODUCT_TITLEBAR_HEIGHT ? 16 : 14;
			const offset = Math.floor((titlebarHeight - buttonHeight) / 2);
			// AuthenticatedWindow centres the traffic lights in its area rail rather than the title bar.
			const x = this.#kind === 'authenticated' ? AUTHENTICATED_MACOS_TRAFFIC_LIGHT_X : offset + 1;
			this.#target.window.setWindowButtonPosition(
				offset === 0 ? null : { x, y: offset }
			);
			this.#target.window.setSheetOffset(this.#configuration.titlebarHeight);
		}
		this.#lastUpdate = Object.freeze({ theme: themeId, titlebarHeight, dimmed, followsSystemScheme, ...(colors ? { colors } : {}) });
	}
}

function dimColor(color: string): string {
	const parsed = Color.Format.CSS.parse(color);
	if (parsed === null) return color;
	const dimFactor = 0.5;
	return `rgb(${Math.round(parsed.rgba.r * dimFactor)}, ${Math.round(parsed.rgba.g * dimFactor)}, ${Math.round(parsed.rgba.b * dimFactor)})`;
}

function isRightToLeftLocale(locale: string): boolean {
	try {
		const value = new Intl.Locale(locale) as Intl.Locale & {
			readonly textInfo?: { readonly direction?: string };
			getTextInfo?(): { readonly direction?: string };
		};
		return (value.getTextInfo?.() ?? value.textInfo)?.direction === 'rtl';
	} catch {
		return false;
	}
}
