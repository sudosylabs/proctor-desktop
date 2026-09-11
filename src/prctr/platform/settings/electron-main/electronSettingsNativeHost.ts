import { screen, clipboard, ClipboardItem, nativeImage, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { Blob } from 'node:buffer';
import type { ISerializableContextMenuItem } from '../../../base/parts/contextmenu/common/contextmenu.js';
import { SETTINGS_CLIPBOARD_LIMIT, SETTINGS_CLIPBOARD_IMAGE_LIMIT, validateSettingsClipboardBytes, validateSettingsClipboardText } from '../common/settingsNativeHost.js';
import type { SettingsNativeHost } from './settingsNativeIpc.js';

const resourceFormat = 'electron application/osclipboard;format="code/file-list"';
const findTextFormat = 'electron application/findtext';

async function readPayload(format: string, limit: number): Promise<Uint8Array> {
	const item = (await clipboard.read()).find(item => item.types.includes(format));
	if (!item) return new Uint8Array();
	const blob = await item.getType(format);
	if (!('size' in blob)) throw new Error('Unexpected clipboard payload type');
	if (blob.size > limit) throw new Error('Clipboard data exceeds the Settings limit');
	return validateSettingsClipboardBytes(new Uint8Array(await blob.arrayBuffer()), limit);
}

/** Electron owns native menu rendering and clipboard access for the authenticated Settings editor. */
export function createElectronSettingsNativeHost(window: BrowserWindow): SettingsNativeHost {
	return {
		window: {
			async focus() { if (window.isDestroyed()) throw new Error('Settings window is closed'); window.focus(); },
			async moveTop() { if (window.isDestroyed()) throw new Error('Settings window is closed'); window.moveTop(); },
			async getCursorScreenPoint() {
				if (window.isDestroyed()) throw new Error('Settings window is closed');
				const point = screen.getCursorScreenPoint();
				return { point, display: screen.getDisplayNearestPoint(point).bounds };
			}
		},
		clipboard: {
			async readText(type = 'clipboard') {
				const source = type === 'selection' && process.platform === 'linux' ? clipboard.selection : clipboard;
				return validateSettingsClipboardText(await source.readText());
			},
			async writeText(text, type = 'clipboard') {
				const target = type === 'selection' && process.platform === 'linux' ? clipboard.selection : clipboard;
				await target.writeText(validateSettingsClipboardText(text));
			},
			async readFindText() {
				return process.platform === 'darwin' ? validateSettingsClipboardText(new TextDecoder().decode(await readPayload(findTextFormat, SETTINGS_CLIPBOARD_LIMIT))) : '';
			},
			async writeFindText(text) {
				if (process.platform === 'darwin') await clipboard.write([new ClipboardItem({ [findTextFormat]: validateSettingsClipboardText(text) })]);
			},
			async readResources() { return readPayload(resourceFormat, SETTINGS_CLIPBOARD_LIMIT); },
			async writeResources(value) {
				await clipboard.write([new ClipboardItem({ [resourceFormat]: new Blob([validateSettingsClipboardBytes(value)]) })]);
			},
			async hasResources() { return clipboard.has(resourceFormat); },
			async readImage() {
				for (const format of ['image/png', 'image/jpeg']) {
					const bytes = await readPayload(format, SETTINGS_CLIPBOARD_IMAGE_LIMIT);
					if (!bytes.byteLength) continue;
					const image = nativeImage.createFromBuffer(Buffer.from(bytes));
					const size = image.getSize();
					if (size.width * size.height > 16 * 1024 * 1024) throw new Error('Clipboard image exceeds the Settings limit');
					return validateSettingsClipboardBytes(image.toPNG(), SETTINGS_CLIPBOARD_IMAGE_LIMIT);
				}
				return new Uint8Array();
			},
			async paste() {
				if (window.isDestroyed()) throw new Error('Settings window is closed');
				window.webContents.paste();
			}
		},
		popup(request, selected, closed) {
			let disposed = false;
			let closeTimer: ReturnType<typeof setTimeout> | undefined;
			const build = (items: ISerializableContextMenuItem[]): MenuItemConstructorOptions[] => items.map(item => ({
				label: item.label, type: item.type, accelerator: item.accelerator,
				// Menu accelerators label shortcuts; the renderer's existing keybinding owner dispatches them.
				registerAccelerator: false,
				enabled: item.enabled, visible: item.visible, checked: item.checked,
				...(item.submenu ? { submenu: build(item.submenu) } : { click: (_item: unknown, _window: unknown, event: Electron.KeyboardEvent) => {
					if (!disposed) selected({ id: item.id, event: { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey } });
				} })
			}));
			const menu = Menu.buildFromTemplate(build(request.items));
			const [width, height] = window.getContentSize();
			menu.popup({ window,
				...request.options,
				...(request.options.x === undefined ? {} : { x: Math.min(width, Math.max(0, request.options.x)) }),
				...(request.options.y === undefined ? {} : { y: Math.min(height, Math.max(0, request.options.y)) }),
				callback: () => { closeTimer = setTimeout(() => { if (!disposed) closed(); }, 0); }
			});
			return { dispose() {
				if (disposed) return;
				disposed = true;
				if (closeTimer) clearTimeout(closeTimer);
				if (!window.isDestroyed()) menu.closePopup(window);
			} };
		}
	};
}
