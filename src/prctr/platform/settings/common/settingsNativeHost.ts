import type { IContextMenuEvent, IPopupOptions, ISerializableContextMenuItem } from '../../../base/parts/contextmenu/common/contextmenu.js';

export const SETTINGS_NATIVE_CHANNEL = 'prctr:settings:native';
export const SETTINGS_CLIPBOARD_LIMIT = 1024 * 1024;
export const SETTINGS_CLIPBOARD_IMAGE_LIMIT = 4 * 1024 * 1024;
export type SettingsClipboardType = 'clipboard' | 'selection';
export interface SettingsMenuSelection { readonly id: number; readonly event: IContextMenuEvent; }
export interface SettingsMenuRequest { readonly requestId: number; readonly items: ISerializableContextMenuItem[]; readonly options: IPopupOptions; }
export type SettingsNativeIntent =
	| { readonly kind: 'menu'; readonly menu: SettingsMenuRequest }
	| { readonly kind: 'cancelMenu'; readonly requestId: number }
	| { readonly kind: 'readText'; readonly type: SettingsClipboardType }
	| { readonly kind: 'writeText'; readonly type: SettingsClipboardType; readonly text: string }
	| { readonly kind: 'focusWindow' | 'moveWindowTop' | 'cursorScreenPoint' }
	| { readonly kind: 'readFindText' | 'readImage' | 'readResources' | 'hasResources' | 'paste' }
	| { readonly kind: 'writeFindText'; readonly text: string }
	| { readonly kind: 'writeResources'; readonly value: Uint8Array };

export interface SettingsClipboardClient {
	readText(type?: SettingsClipboardType): Promise<string>;
	writeText(text: string, type?: SettingsClipboardType): Promise<void>;
	readFindText(): Promise<string>;
	writeFindText(text: string): Promise<void>;
	readImage(): Promise<Uint8Array>;
	readResources(): Promise<Uint8Array>;
	writeResources(value: Uint8Array): Promise<void>;
	hasResources(): Promise<boolean>;
	paste(): Promise<void>;
}
export interface SettingsCursorScreenPoint {
	readonly point: { readonly x: number; readonly y: number };
	readonly display: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}
export function validateSettingsCursorScreenPoint(value: unknown): SettingsCursorScreenPoint {
	const item = record(value); keys(item, ['point', 'display']);
	const point = record(item.point); keys(point, ['x', 'y']);
	const display = record(item.display); keys(display, ['x', 'y', 'width', 'height']);
	for (const value of [point.x, point.y, display.x, display.y, display.width, display.height])
		if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1000000) throw new TypeError('Invalid Settings cursor geometry');
	if (Number(display.width) < 0 || Number(display.height) < 0) throw new TypeError('Invalid Settings display size');
	return { point: { x: Number(point.x), y: Number(point.y) }, display: { x: Number(display.x), y: Number(display.y), width: Number(display.width), height: Number(display.height) } };
}
export interface SettingsWindowClient {
	focus(): Promise<void>;
	moveTop(): Promise<void>;
	getCursorScreenPoint(): Promise<SettingsCursorScreenPoint>;
}
export interface SettingsNativeClient {
	readonly window: SettingsWindowClient;
	readonly clipboard: SettingsClipboardClient;
	popup(menu: SettingsMenuRequest): Promise<SettingsMenuSelection | undefined>;
	cancelPopup(requestId: number): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Settings native request');
	return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
	if (Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError('Unexpected Settings native field');
}
export function validateSettingsClipboardText(value: unknown): string {
	if (typeof value !== 'string' || value.length > SETTINGS_CLIPBOARD_LIMIT || new TextEncoder().encode(value).byteLength > SETTINGS_CLIPBOARD_LIMIT)
		throw new TypeError('Clipboard text exceeds the Settings limit');
	return value;
}
export function validateSettingsClipboardBytes(value: unknown, max = SETTINGS_CLIPBOARD_LIMIT): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength > max) throw new TypeError('Clipboard data exceeds the Settings limit');
	return value;
}
export function validateSettingsNativeIntent(value: unknown): SettingsNativeIntent {
	const item = record(value);
	switch (item.kind) {
		case 'menu': keys(item, ['kind', 'menu']); return { kind: 'menu', menu: validateSettingsMenu(item.menu) };
		case 'cancelMenu':
			keys(item, ['kind', 'requestId']);
			if (!Number.isSafeInteger(item.requestId) || (item.requestId as number) < 0) throw new TypeError('Invalid Settings menu request');
			return { kind: item.kind, requestId: item.requestId as number };
		case 'readText':
		case 'writeText': {
			keys(item, item.kind === 'readText' ? ['kind', 'type'] : ['kind', 'type', 'text']);
			if (item.type !== 'clipboard' && item.type !== 'selection') throw new TypeError('Invalid clipboard type');
			return item.kind === 'readText' ? { kind: item.kind, type: item.type } : { kind: item.kind, type: item.type, text: validateSettingsClipboardText(item.text) };
		}
		case 'writeFindText': keys(item, ['kind', 'text']); return { kind: item.kind, text: validateSettingsClipboardText(item.text) };
		case 'writeResources': keys(item, ['kind', 'value']); return { kind: item.kind, value: validateSettingsClipboardBytes(item.value) };
		case 'focusWindow': case 'moveWindowTop': case 'cursorScreenPoint':
		case 'readFindText': case 'readImage': case 'readResources': case 'hasResources': case 'paste':
			keys(item, ['kind']); return { kind: item.kind };
		default: throw new TypeError('Unsupported Settings native operation');
	}
}
export function validateSettingsMenu(value: unknown): SettingsMenuRequest {
	const menu = record(value); keys(menu, ['requestId', 'items', 'options']);
	if (!Number.isSafeInteger(menu.requestId) || (menu.requestId as number) < 0) throw new TypeError('Invalid Settings menu request');
	const ids = new Set<number>();
	const visit = (values: unknown, depth: number): ISerializableContextMenuItem[] => {
		if (depth > 8 || !Array.isArray(values) || values.length > 128) throw new TypeError('Settings menu exceeds its limit');
		return values.map(value => {
			const item = record(value); keys(item, ['id', 'label', 'type', 'accelerator', 'enabled', 'visible', 'checked', 'submenu']);
			if (!Number.isSafeInteger(item.id) || (item.id as number) < 0 || ids.has(item.id as number) || ids.size >= 128) throw new TypeError('Invalid Settings menu item');
			ids.add(item.id as number);
			if (item.type !== undefined && !['normal', 'separator', 'submenu', 'checkbox', 'radio'].includes(item.type as string)) throw new TypeError('Invalid Settings menu type');
			for (const name of ['enabled', 'visible', 'checked']) if (item[name] !== undefined && typeof item[name] !== 'boolean') throw new TypeError('Invalid Settings menu state');
			for (const name of ['label', 'accelerator']) if (item[name] !== undefined && (typeof item[name] !== 'string' || (item[name] as string).length > (name === 'label' ? 512 : 96) || /[\r\n\0]/u.test(item[name] as string))) throw new TypeError('Invalid Settings menu text');
			return { ...item, ...(item.submenu === undefined ? {} : { submenu: visit(item.submenu, depth + 1) }) } as unknown as ISerializableContextMenuItem;
		});
	};
	const items = visit(menu.items, 0);
	const options = record(menu.options); keys(options, ['x', 'y', 'positioningItem']);
	for (const name of ['x', 'y', 'positioningItem']) if (options[name] !== undefined && (!Number.isSafeInteger(options[name]) || Math.abs(options[name] as number) > 100000)) throw new TypeError('Invalid Settings menu anchor');
	if (options.positioningItem !== undefined && ((options.positioningItem as number) < 0 || (options.positioningItem as number) >= items.length)) throw new TypeError('Invalid Settings menu positioning item');
	return { requestId: menu.requestId as number, items, options };
}
export function validateSettingsMenuSelection(value: unknown): SettingsMenuSelection | undefined {
	if (value === undefined || value === null) return undefined;
	const selected = record(value); keys(selected, ['id', 'event']);
	if (!Number.isSafeInteger(selected.id) || (selected.id as number) < 0) throw new TypeError('Invalid Settings menu selection');
	const event = record(selected.event); keys(event, ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']);
	if (Object.values(event).some(value => typeof value !== 'boolean')) throw new TypeError('Invalid Settings menu modifiers');
	return { id: selected.id as number, event };
}
