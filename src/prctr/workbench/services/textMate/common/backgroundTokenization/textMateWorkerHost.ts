/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-textmate

import type { UriComponents } from '../../../../../base/common/uri.js';
import type { IWebWorkerServer, IWebWorkerClient } from '../../../../../base/common/worker/webWorker.js';
import type { ISerializedAnnotation } from '../../../../../editor/common/model/tokens/annotations.js';
import type { IFontTokenOption } from '../../../../../editor/common/textModelEvents.js';
import type { StateDeltas } from './textMateWorkerProtocol.js';

export abstract class TextMateWorkerHost {
	public static CHANNEL_NAME = 'textMateWorkerHost';
	public static getChannel(workerServer: IWebWorkerServer): TextMateWorkerHost {
		return workerServer.getChannel<TextMateWorkerHost>(TextMateWorkerHost.CHANNEL_NAME);
	}
	public static setChannel(workerClient: IWebWorkerClient<unknown>, obj: TextMateWorkerHost): void {
		workerClient.setChannel<TextMateWorkerHost>(TextMateWorkerHost.CHANNEL_NAME, obj);
	}

	abstract $readFile(_resource: UriComponents): Promise<string>;
	abstract $setTokensAndStates(controllerId: number, versionId: number, tokens: Uint8Array, fontTokens: ISerializedAnnotation<IFontTokenOption>[], lineEndStateDeltas: StateDeltas[]): Promise<void>;
	abstract $reportTokenizationTime(timeMs: number, languageId: string, sourceExtensionId: string | undefined, lineLength: number, isRandomSample: boolean): void;
}
