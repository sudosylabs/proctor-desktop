/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port editor-browser-services

import { bootstrapWebWorker } from '../../../base/common/worker/webWorkerBootstrap.js';
import { EditorWorker } from '../../common/services/editorWebWorker.js';

bootstrapWebWorker(() => new EditorWorker(null));
