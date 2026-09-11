/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @proctor-vscode-port settings-token-customization
import type { ITokenColorCustomizations } from './tokenCustomizationTypes.js';

/** Original configuration-time font-size/line-height inheritance, without changing the stored document. */
export function resolveTokenColorCustomizations(tokenColorCustomization: ITokenColorCustomizations): ITokenColorCustomizations {
		const textMateRules = tokenColorCustomization.textMateRules;
		if (!textMateRules) {
			return tokenColorCustomization;
		}
		const updatedRules = textMateRules.map(rule => {
			const fontSize = rule.settings?.fontSize;
			const lineHeight = rule.settings?.lineHeight;
			if (fontSize !== undefined && lineHeight === undefined) {
				return {
					...rule,
					settings: {
						...rule.settings,
						lineHeight: fontSize
					}
				};
			}
			return rule;
		});
		const updatedTokenColorCustomization = {
			...tokenColorCustomization,
			textMateRules: updatedRules
		};
		return updatedTokenColorCustomization;
}
