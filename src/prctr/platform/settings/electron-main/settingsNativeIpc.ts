import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import { Disposable, toDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import {
	SETTINGS_NATIVE_CHANNEL,
	SETTINGS_CLIPBOARD_IMAGE_LIMIT,
	validateSettingsNativeIntent,
	validateSettingsClipboardText,
	validateSettingsClipboardBytes,
	validateSettingsMenuSelection,
	validateSettingsCursorScreenPoint,
	type SettingsWindowClient,
	type SettingsClipboardClient,
	type SettingsMenuRequest,
	type SettingsMenuSelection
} from '../common/settingsNativeHost.js';

export interface SettingsNativeHost {
	readonly window: SettingsWindowClient;
	readonly clipboard: SettingsClipboardClient;
	popup(
		menu: SettingsMenuRequest,
		selected: (selection: SettingsMenuSelection) => void,
		closed: () => void
	): IDisposable;
}

/** Bound to one authenticated sender. No native role, command or generic IPC crosses this interface. */
export class SettingsNativeIpcBridge extends Disposable {
	private closed = false;
	private closeMenu: (() => void) | undefined;
	private menuId: number | undefined;
	constructor(
		ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		host: SettingsNativeHost,
		authorize: (event: IpcMainInvokeEvent) => void
	) {
		super();
		ipc.handle(SETTINGS_NATIVE_CHANNEL, async (event, ...args: unknown[]) => {
			const assertCurrent = (): void => {
				if (this.closed) throw new Error('Settings native host is closed');
				authorize(event);
			};
			assertCurrent();
			if (args.length !== 1) throw new TypeError('Expected one Settings native intent');
			const intent = validateSettingsNativeIntent(args[0]);
			let result: unknown;
			switch (intent.kind) {
				case 'focusWindow':
					await host.window.focus();
					break;
				case 'moveWindowTop':
					await host.window.moveTop();
					break;
				case 'cursorScreenPoint':
					result = validateSettingsCursorScreenPoint(
						await host.window.getCursorScreenPoint()
					);
					break;
				case 'menu':
					return this.showMenu(host, intent.menu, assertCurrent);
				case 'cancelMenu':
					if (this.menuId === intent.requestId) this.closeMenu?.();
					break;
				case 'readText':
					result = validateSettingsClipboardText(
						await host.clipboard.readText(intent.type)
					);
					break;
				case 'writeText':
					await host.clipboard.writeText(intent.text, intent.type);
					break;
				case 'readFindText':
					result = validateSettingsClipboardText(await host.clipboard.readFindText());
					break;
				case 'writeFindText':
					await host.clipboard.writeFindText(intent.text);
					break;
				case 'readImage':
					result = validateSettingsClipboardBytes(
						await host.clipboard.readImage(),
						SETTINGS_CLIPBOARD_IMAGE_LIMIT
					);
					break;
				case 'readResources':
					result = validateSettingsClipboardBytes(await host.clipboard.readResources());
					break;
				case 'writeResources':
					await host.clipboard.writeResources(intent.value);
					break;
				case 'hasResources':
					result = await host.clipboard.hasResources();
					break;
				case 'paste':
					validateSettingsClipboardText(await host.clipboard.readText());
					assertCurrent();
					await host.clipboard.paste();
					break;
			}
			assertCurrent();
			return result;
		});
		this._register(toDisposable(() => ipc.removeHandler(SETTINGS_NATIVE_CHANNEL)));
	}
	private showMenu(
		host: SettingsNativeHost,
		request: SettingsMenuRequest,
		authorize: () => void
	): Promise<SettingsMenuSelection | undefined> {
		this.closeMenu?.();
		this.menuId = request.requestId;
		return new Promise((resolve, reject) => {
			let popup: IDisposable | undefined;
			let finished = false;
			const finish = (value?: SettingsMenuSelection): void => {
				if (finished) return;
				finished = true;
				this.closeMenu = undefined;
				this.menuId = undefined;
				try {
					popup?.dispose();
					if (this.closed) {
						resolve(undefined);
						return;
					}
					authorize();
					const selection = validateSettingsMenuSelection(value);
					if (selection && !selectable(request.items, selection.id))
						throw new TypeError('Settings menu returned an unavailable action');
					resolve(selection);
				} catch (error) {
					reject(error);
				}
			};
			this.closeMenu = () => finish();
			try {
				popup = host.popup(request, finish, () => finish());
				if (finished) popup.dispose();
			} catch (error) {
				finished = true;
				this.closeMenu = undefined;
				this.menuId = undefined;
				reject(error);
			}
		});
	}
	override dispose(): void {
		if (this.closed) return;
		this.closed = true;
		try {
			this.closeMenu?.();
		} finally {
			super.dispose();
		}
	}
}
function selectable(items: SettingsMenuRequest['items'], id: number): boolean {
	for (const item of items) {
		if (item.enabled === false || item.visible === false || item.type === 'separator') continue;
		if (item.submenu) {
			if (selectable(item.submenu, id)) return true;
		} else if (item.id === id) return true;
	}
	return false;
}
