/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ipcRenderer, webFrame } from 'electron';
import {
	type ChromeCapableProductWindowKind,
	type ProductWindowChromeClient,
	type ProductWindowChromeUpdate,
	validateProductWindowChromeConfiguration,
	validateProductWindowChromeUpdate,
	validateProductWindowChromeZoomFactor
} from '../../platform/windows/common/windowChrome.js';
import { WINDOW_CHROME_CHANNELS } from '../../platform/windows/common/windowChannels.js';

export function createWindowChromePreloadClient(
	kind: ChromeCapableProductWindowKind
): ProductWindowChromeClient {
	const channels = WINDOW_CHROME_CHANNELS[kind];
	return Object.freeze({
		configuration: async () =>
			validateProductWindowChromeConfiguration(
				await ipcRenderer.invoke(channels.configuration)
			),
		onDidChangeFullscreen: (
			listener: Parameters<ProductWindowChromeClient['onDidChangeFullscreen']>[0]
		) => {
			const receive = (_event: unknown, value: unknown): void => {
				if (typeof value !== 'boolean') return;
				listener(value);
			};
			ipcRenderer.on(channels.fullscreenChanged, receive);
			return Object.freeze({
				dispose: () => ipcRenderer.removeListener(channels.fullscreenChanged, receive)
			});
		},
		zoomFactor: () => validateProductWindowChromeZoomFactor(webFrame.getZoomFactor()),
		update: async (value: ProductWindowChromeUpdate) => {
			const update = validateProductWindowChromeUpdate(value);
			await ipcRenderer.invoke(
				channels.update,
				validateProductWindowChromeUpdate({
					...update,
					titlebarHeight: Math.round(update.titlebarHeight * webFrame.getZoomFactor())
				})
			);
		}
	});
}
