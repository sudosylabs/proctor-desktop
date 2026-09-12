/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port resource-preview

import type { WebviewApi } from '../../previewApi.js';
import type { FromWebviewMessage } from '../types/previewMessaging.js';
import { SettingsManager } from './settings.js';

export interface MessagePoster {
	/**
	 * Post a message to the markdown extension
	 */
	postMessage<T extends FromWebviewMessage.Type>(
		type: T['type'],
		body: Omit<T, 'source' | 'type'>
	): void;
}

export const createPosterForVsCode = (
	vscode: WebviewApi<unknown>,
	settingsManager: SettingsManager
): MessagePoster => {
	return {
		postMessage<T extends FromWebviewMessage.Type>(
			type: T['type'],
			body: Omit<T, 'source' | 'type'>
		): void {
			vscode.postMessage({
				type,
				source: settingsManager.settings!.source,
				...body
			});
		}
	};
};
