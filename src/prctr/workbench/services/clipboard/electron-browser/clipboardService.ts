/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-browser-host

import type { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { URI } from '../../../../base/common/uri.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { ISettingsClipboardClient } from '../../../../platform/settings/common/settingsClipboard.js';
import type { SettingsClipboardClient } from '../../../../platform/settings/common/settingsNativeHost.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';

export class NativeClipboardService implements IClipboardService {


	declare readonly _serviceBrand: undefined;

	constructor(
		@ISettingsClipboardClient private readonly nativeHostService: SettingsClipboardClient,
		@ILogService private readonly logService: ILogService
	) { }

	async triggerPaste(targetWindowId: number): Promise<void> {
		this.logService.trace('NativeClipboardService#triggerPaste called');
		if (targetWindowId !== mainWindow.vscodeWindowId) throw new Error('Clipboard target belongs to another window.');
		return this.nativeHostService.paste();
	}

	async readImage(): Promise<Uint8Array> {
		return this.nativeHostService.readImage();
	}

	async writeText(text: string, type?: 'selection' | 'clipboard'): Promise<void> {
		this.logService.trace('NativeClipboardService#writeText called with type:', type, ' with text.length:', text.length);
		return this.nativeHostService.writeText(text, type);
	}

	async readText(type?: 'selection' | 'clipboard'): Promise<string> {
		this.logService.trace('NativeClipboardService#readText called with type:', type);
		return this.nativeHostService.readText(type);
	}

	async readFindText(): Promise<string> {
		if (isMacintosh) {
			return this.nativeHostService.readFindText();
		}

		return '';
	}

	async writeFindText(text: string): Promise<void> {
		if (isMacintosh) {
			return this.nativeHostService.writeFindText(text);
		}
	}

	async writeResources(resources: URI[]): Promise<void> {
		if (resources.length) {
			return this.nativeHostService.writeResources(this.resourcesToBuffer(resources).buffer);
		}
	}

	async readResources(): Promise<URI[]> {
		return this.bufferToResources(VSBuffer.wrap(await this.nativeHostService.readResources()));
	}

	async hasResources(): Promise<boolean> {
		return this.nativeHostService.hasResources();
	}

	private resourcesToBuffer(resources: URI[]): VSBuffer {
		return VSBuffer.fromString(resources.map(r => r.toString()).join('\n'));
	}

	private bufferToResources(buffer: VSBuffer): URI[] {
		if (!buffer) {
			return [];
		}

		const bufferValue = buffer.toString();
		if (!bufferValue) {
			return [];
		}

		try {
			return bufferValue.split('\n').map(f => URI.parse(f));
		} catch (error) {
			return []; // do not trust clipboard data
		}
	}
}

