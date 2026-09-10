/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @proctor-vscode-port color-theme-engine
import type { IColorTheme, ICssStyleCollector, IThemingParticipant } from '../common/themeService.js';
import { asCssVariableName, getColorRegistry } from '../common/colorRegistry.js';

/**
 * Generates CSS content (variables + theming participant rules) for a color theme.
 * Pure function - no DOM side effects.
 *
 * @param theme The color theme to generate CSS for
 * @param scopeSelector CSS selector to scope the rules (e.g. '.monaco-workbench')
 * @param themingParticipants Functions that contribute additional CSS rules (optional)
 */
export function generateColorThemeCSS(
	theme: IColorTheme,
	scopeSelector: string,
	themingParticipants?: readonly IThemingParticipant[]
): CSSValue {
	const cssRules = new Set<string>();
	const ruleCollector: ICssStyleCollector = {
		addRule: (rule: string) => {
			if (!cssRules.has(rule)) {
				cssRules.add(rule);
			}
		}
	};

	// Proctor retains its system forced-colors rules instead of suppressing OS adjustment.

	// Theming participant rules
	if (themingParticipants) {
		for (const participant of themingParticipants) {
			participant(theme, ruleCollector);
		}
	}

	// Color CSS variables
	const variables: string[] = [];
	for (const item of getColorRegistry().getColors()) {
		const color = theme.getColor(item.id, true);
		if (color) {
			variables.push(`${asCssVariableName(item.id)}: ${color.toString()};`);
		}
	}

	// Non-color size tokens remain owned by the Proctor presentation registry.

	ruleCollector.addRule(`${scopeSelector} { ${variables.join('\n')} }`);

	return new CSSValue([...cssRules].join('\n'));
}

/**
 * A typed wrapper for CSS content
 */
export class CSSValue {
	constructor(readonly code: string) { }
}
