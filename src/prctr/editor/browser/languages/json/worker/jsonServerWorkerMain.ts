/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port json-language-server

import * as l10n from '@vscode/l10n';
import { readJsonWorkerInitialization } from '../../../../common/languages/json/jsonWorkerProtocol.js';

let initialized = false;
const pendingMessages: any[] = [];
const messageHandler = async (e: any) => {
	if (!initialized) {
		const l10nLog: string[] = [];
		initialized = true;
		const messages = readJsonWorkerInitialization(e.data).messages;
		if (messages) {
			try {
				l10n.config({ contents: messages });
				l10nLog.push('l10n: Configured packaged messages.');
			} catch (e) {
				l10nLog.push('l10n: Packaged messages could not be configured.');
			}
		} else {
			l10nLog.push(`l10n: No bundle configured.`);
		}
		await import('./jsonServerMain.js');
		if (self.onmessage !== messageHandler) {
			pendingMessages.forEach(msg => self.onmessage?.(msg));
			pendingMessages.length = 0;
		}
		l10nLog.forEach(console.log);
	} else {
		pendingMessages.push(e);
	}
};
self.onmessage = messageHandler;
