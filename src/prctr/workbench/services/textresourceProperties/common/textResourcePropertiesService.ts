/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-runtime-services

import type { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import type { ITextResourcePropertiesService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { OperatingSystem, OS } from '../../../../base/common/platform.js';

export class TextResourcePropertiesService implements ITextResourcePropertiesService {

	declare readonly _serviceBrand: undefined;


	constructor(@IConfigurationService private readonly configurationService: IConfigurationService) {}

	getEOL(resource?: URI, language?: string): string {
		const eol = this.configurationService.getValue('files.eol', { overrideIdentifier: language, resource });
		if (eol && typeof eol === 'string' && eol !== 'auto') {
			return eol;
		}
		const os = OS;
		return os === OperatingSystem.Linux || os === OperatingSystem.Macintosh ? '\n' : '\r\n';
	}

}
