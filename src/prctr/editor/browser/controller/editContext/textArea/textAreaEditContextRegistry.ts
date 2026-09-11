/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port editor-browser-core

import type { IDisposable } from '../../../../../base/common/lifecycle.js';
import type { TextAreaEditContext } from './textAreaEditContext.js';

class TextAreaEditContextRegistryImpl {

	private _textAreaEditContextMapping: Map<string, TextAreaEditContext> = new Map();

	register(ownerID: string, textAreaEditContext: TextAreaEditContext): IDisposable {
		this._textAreaEditContextMapping.set(ownerID, textAreaEditContext);
		return {
			dispose: () => {
				this._textAreaEditContextMapping.delete(ownerID);
			}
		};
	}

	get(ownerID: string): TextAreaEditContext | undefined {
		return this._textAreaEditContextMapping.get(ownerID);
	}
}

export const TextAreaEditContextRegistry = new TextAreaEditContextRegistryImpl();
