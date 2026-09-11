/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port editor-text-model

import * as platform from '../../../../../src/prctr/base/common/platform.js';
import type { URI } from '../../../../../src/prctr/base/common/uri.js';
import type { ITextResourcePropertiesService } from '../../../../../src/prctr/editor/common/services/textResourceConfiguration.js';
import { IConfigurationService } from '../../../../../src/prctr/platform/configuration/common/configuration.js';

export class TestTextResourcePropertiesService implements ITextResourcePropertiesService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
	}

	getEOL(resource: URI, language?: string): string {
		const eol = this.configurationService.getValue('files.eol', { overrideIdentifier: language, resource });
		if (eol && typeof eol === 'string' && eol !== 'auto') {
			return eol;
		}
		return (platform.isLinux || platform.isMacintosh) ? '\n' : '\r\n';
	}
}
