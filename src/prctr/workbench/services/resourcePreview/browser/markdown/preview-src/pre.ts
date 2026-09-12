/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port resource-preview

import { CspAlerter } from './csp.js';
import { StyleLoadingMonitor } from './loading.js';
import { SettingsManager } from './settings.js';

declare global {
	interface Window {
		cspAlerter: CspAlerter;
		styleLoadingMonitor: StyleLoadingMonitor;
	}
}

window.cspAlerter = new CspAlerter(new SettingsManager());
window.styleLoadingMonitor = new StyleLoadingMonitor();
