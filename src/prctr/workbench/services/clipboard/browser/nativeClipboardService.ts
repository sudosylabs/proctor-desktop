/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from '../../../../base/common/uri.js';
import type { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import type {
	SettingsClipboardClient,
	SettingsClipboardType
} from '../../../../platform/settings/common/settingsNativeHost.js';

/**
 * The window's clipboard through its privileged preload path. Only text crosses the
 * process boundary; find text and copied resources stay inside the window.
 */
export class NativeClipboardService implements IClipboardService {
	declare readonly _serviceBrand: undefined;

	private findText = '';
	private resources: URI[] = [];

	constructor(private readonly client: SettingsClipboardClient) {}

	triggerPaste(): Promise<void> | undefined {
		return undefined;
	}

	writeText(text: string, type?: string): Promise<void> {
		return this.client.writeText(text, clipboardType(type));
	}

	readText(type?: string): Promise<string> {
		return this.client.readText(clipboardType(type));
	}

	async readFindText(): Promise<string> {
		return this.findText;
	}

	async writeFindText(text: string): Promise<void> {
		this.findText = text;
	}

	async writeResources(resources: URI[]): Promise<void> {
		this.resources = [...resources];
	}

	async readResources(): Promise<URI[]> {
		return [...this.resources];
	}

	async hasResources(): Promise<boolean> {
		return this.resources.length > 0;
	}

	clearInternalState(): void {
		this.resources = [];
	}

	async readImage(): Promise<Uint8Array> {
		return new Uint8Array();
	}
}

function clipboardType(type: string | undefined): SettingsClipboardType | undefined {
	return type === 'selection' ? 'selection' : type === undefined ? undefined : 'clipboard';
}
