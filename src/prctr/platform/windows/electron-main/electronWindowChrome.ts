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
	DEFAULT_PRODUCT_TITLEBAR_HEIGHT,
	MACOS_PRODUCT_TITLEBAR_HEIGHT,
	MACOS_TAHOE_PRODUCT_TITLEBAR_HEIGHT,
	type ChromeCapableProductWindowKind,
	type ProductWindowChromeConfiguration,
	type ProductWindowChromePlatform,
	type ProductWindowChromeColors,
	validateProductWindowChromeUpdate
} from '../common/windowChrome.js';
import { WINDOW_CHROME_CHANNELS } from '../common/windowChannels.js';

export type ElectronPlatform = ProductWindowChromePlatform;

export interface ElectronWindowChromeTarget {
	readonly synchronizeTheme?: (scheme: 'light' | 'dark') => void;
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
	macOsRelease: string
): ProductWindowChromeConfiguration {
	const macos = platform === 'darwin';
	return Object.freeze({
		protocolVersion: 1,
		platform,
		mode: macos ? 'nativeTrafficLights' : 'nativeOverlay',
		controlsLocation: macos && isRightToLeftLocale(locale) ? 'right' : macos ? 'left' : 'right',
		titlebarHeight: macos
			? isTahoeOrNewer(macOsRelease)
				? MACOS_TAHOE_PRODUCT_TITLEBAR_HEIGHT
				: MACOS_PRODUCT_TITLEBAR_HEIGHT
			: DEFAULT_PRODUCT_TITLEBAR_HEIGHT,
		fullscreen: false
	});
}

export class ElectronWindowChromeBridge {
	readonly #channels: (typeof WINDOW_CHROME_CHANNELS)[ChromeCapableProductWindowKind];
	readonly #configuration: ProductWindowChromeConfiguration;
	readonly #ipc: Pick<typeof ipcMain, 'handle' | 'removeHandler'>;
	readonly #target: ElectronWindowChromeTarget;
	readonly #authorize: (event: IpcMainInvokeEvent) => void;
	#disposed = false;
	#lastUpdate:
		| { readonly theme: ThemeId; readonly titlebarHeight: number; readonly dimmed: boolean; readonly colors?: ProductWindowChromeColors }
		| undefined;
	readonly #onDidEnterFullScreen = (): void => this.#sendFullscreen(true);
	readonly #onDidLeaveFullScreen = (): void => this.#sendFullscreen(false);

	constructor(
		ipc: Pick<typeof ipcMain, 'handle' | 'removeHandler'>,
		target: ElectronWindowChromeTarget,
		kind: ChromeCapableProductWindowKind,
		configuration: ProductWindowChromeConfiguration,
		initialTheme: ThemeId,
		authorize: (event: IpcMainInvokeEvent) => void
	) {
		this.#ipc = ipc;
		this.#target = target;
		this.#channels = WINDOW_CHROME_CHANNELS[kind];
		this.#configuration = configuration;
		this.#authorize = authorize;
		const handled: string[] = [];
		try {
			this.#apply(initialTheme, configuration.titlebarHeight, false);
			target.window.on('enter-full-screen', this.#onDidEnterFullScreen);
			target.window.on('leave-full-screen', this.#onDidLeaveFullScreen);
			ipc.handle(this.#channels.configuration, (event) => {
				this.#authorize(event);
				return Object.freeze({
					...this.#configuration,
					fullscreen: this.#target.window.isFullScreen()
				});
			});
			handled.push(this.#channels.configuration);
			ipc.handle(this.#channels.update, (event, value: unknown) => {
				this.#authorize(event);
				const update = validateProductWindowChromeUpdate(value);
				this.#apply(update.theme, update.titlebarHeight, update.dimmed, update.colors);
			});
			handled.push(this.#channels.update);
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

	#apply(themeId: ThemeId, titlebarHeight: number, dimmed: boolean, colors?: ProductWindowChromeColors): void {
		if (this.#disposed || this.#target.window.isDestroyed()) return;
		if (
			this.#lastUpdate?.theme === themeId &&
			this.#lastUpdate.titlebarHeight === titlebarHeight &&
			this.#lastUpdate.dimmed === dimmed && JSON.stringify(this.#lastUpdate.colors) === JSON.stringify(colors)
		)
			return;
		this.#target.synchronizeTheme?.(getTheme(themeId).isDark ? 'dark' : 'light');
		if (this.#configuration.mode === 'nativeOverlay') {
			const theme = getTheme(themeId);
			const background = colors?.background ?? theme.values['color.background.canvas'];
			const foreground = colors?.foreground ?? theme.colors['titleBar.activeForeground'] ?? theme.values['color.text.primary'];
			this.#target.window.setTitleBarOverlay({
				color: dimmed ? dimColor(background) : background,
				symbolColor: dimmed ? dimColor(foreground) : foreground,
				height: titlebarHeight - 1
			});
		} else {
			const buttonHeight = this.#configuration.titlebarHeight === 32 ? 14 : 16;
			const offset = Math.floor((titlebarHeight - buttonHeight) / 2);
			this.#target.window.setWindowButtonPosition(
				offset === 0 ? null : { x: offset + 1, y: offset }
			);
			this.#target.window.setSheetOffset(this.#configuration.titlebarHeight);
		}
		this.#lastUpdate = Object.freeze({ theme: themeId, titlebarHeight, dimmed, ...(colors ? { colors } : {}) });
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
