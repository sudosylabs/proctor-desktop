/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ProductWindowKind } from './windowProtocol.js';

export const DEFAULT_PRODUCT_TITLEBAR_HEIGHT = 35;
export const MACOS_PRODUCT_TITLEBAR_HEIGHT = 28;
export const MACOS_TAHOE_PRODUCT_TITLEBAR_HEIGHT = 32;
export const MACOS_TRAFFIC_LIGHT_INSET = 70;
export const PRODUCT_WINDOW_TITLE = 'Proctor';

export type ProductWindowChromeMode = 'nativeOverlay' | 'nativeTrafficLights';
export type ProductWindowChromePlatform = 'darwin' | 'linux' | 'win32';
export type ProductWindowControlsLocation = 'left' | 'right';
export type ProductWindowChromeTheme = 'light' | 'dark' | 'highContrastLight' | 'highContrastDark';

export interface ProductWindowChromeConfiguration {
	readonly protocolVersion: 1;
	readonly platform: ProductWindowChromePlatform;
	readonly mode: ProductWindowChromeMode;
	readonly controlsLocation: ProductWindowControlsLocation;
	readonly titlebarHeight: number;
	readonly fullscreen: boolean;
}

export interface ProductWindowChromeUpdate {
	readonly protocolVersion: 1;
	readonly theme: ProductWindowChromeTheme;
	readonly titlebarHeight: number;
	readonly dimmed: boolean;
}

export interface ProductWindowChromeClient {
	configuration(): Promise<ProductWindowChromeConfiguration>;
	onDidChangeFullscreen(listener: (fullscreen: boolean) => unknown): { dispose(): void };
	zoomFactor(): number;
	update(value: ProductWindowChromeUpdate): Promise<void>;
}

export type ChromeCapableProductWindowKind = Exclude<ProductWindowKind, 'candidate'>;

export function validateProductWindowChromeConfiguration(
	value: unknown
): ProductWindowChromeConfiguration {
	if (
		!isRecord(value) ||
		value.protocolVersion !== 1 ||
		!isProductWindowChromePlatform(value.platform) ||
		!isProductWindowChromeMode(value.mode) ||
		!isControlsLocation(value.controlsLocation) ||
		!isConfigurationTitlebarHeight(value.titlebarHeight) ||
		typeof value.fullscreen !== 'boolean' ||
		Object.keys(value).length !== 6
	)
		throw new TypeError('Invalid product window chrome configuration');
	return Object.freeze({
		protocolVersion: 1,
		platform: value.platform,
		mode: value.mode,
		controlsLocation: value.controlsLocation,
		titlebarHeight: value.titlebarHeight,
		fullscreen: value.fullscreen
	});
}

export function validateProductWindowChromeUpdate(value: unknown): ProductWindowChromeUpdate {
	if (
		!isRecord(value) ||
		value.protocolVersion !== 1 ||
		!isThemeId(value.theme) ||
		!isPhysicalTitlebarHeight(value.titlebarHeight) ||
		typeof value.dimmed !== 'boolean' ||
		Object.keys(value).length !== 4
	)
		throw new TypeError('Invalid product window chrome update');
	return Object.freeze({
		protocolVersion: 1,
		theme: value.theme,
		titlebarHeight: value.titlebarHeight,
		dimmed: value.dimmed
	});
}

export function validateProductWindowChromeZoomFactor(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 5)
		throw new RangeError('Invalid product window chrome zoom factor');
	return value;
}

function isProductWindowChromePlatform(value: unknown): value is ProductWindowChromePlatform {
	return value === 'darwin' || value === 'linux' || value === 'win32';
}

function isProductWindowChromeMode(value: unknown): value is ProductWindowChromeMode {
	return value === 'nativeOverlay' || value === 'nativeTrafficLights';
}

function isControlsLocation(value: unknown): value is ProductWindowControlsLocation {
	return value === 'left' || value === 'right';
}

function isConfigurationTitlebarHeight(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 24 && Number(value) <= 256;
}

function isPhysicalTitlebarHeight(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 16 && Number(value) <= 512;
}

function isThemeId(value: unknown): value is ProductWindowChromeTheme {
	return (
		value === 'light' ||
		value === 'dark' ||
		value === 'highContrastLight' ||
		value === 'highContrastDark'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
