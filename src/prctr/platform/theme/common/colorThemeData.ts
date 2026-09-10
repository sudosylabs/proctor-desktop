/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port color-theme-engine

import { Color } from '../../../base/common/color.js';
import * as types from '../../../base/common/types.js';
import * as Json from '../../../base/common/json.js';
import { getColorRegistry, DEFAULT_COLOR_CONFIG_VALUE, type ColorIdentifier } from './colorRegistry.js';
import type { ColorScheme } from './theme.js';
import type { IColorTheme } from './themeService.js';

import type { IColorCustomizations } from './colorCustomizations.js';
export type { IColorCustomizations } from './colorCustomizations.js';
type IThemeScopableCustomizations = Readonly<Record<string, unknown>>;
type IThemeScopedCustomizations = Record<string, unknown>;
const THEME_SCOPE_WILDCARD = '*';
const themeScopeRegex = /\[[^\]]*\]/g;
const colorRegistry = getColorRegistry();

/** Color-only slice of ColorThemeData. Token styling is admitted with the editor. */
export class ColorThemeData implements IColorTheme {
 private colorMap: Record<string, Color> = Object.create(null);
 private customColorMap: Record<string, Color | typeof DEFAULT_COLOR_CONFIG_VALUE> = Object.create(null);
 constructor(readonly settingsId: string, readonly type: ColorScheme, readonly label = settingsId) {}
	public getColor(colorId: ColorIdentifier, useDefault?: boolean): Color | undefined {
		const customColor = this.customColorMap[colorId];
		if (customColor instanceof Color) {
			return customColor;
		}
		if (customColor === undefined) { /* !== DEFAULT_COLOR_CONFIG_VALUE */
			const color = this.colorMap[colorId];
			if (color !== undefined) {
				return color;
			}
		}
		if (useDefault !== false) {
			return this.getDefault(colorId);
		}
		return undefined;
	}

	public getDefault(colorId: ColorIdentifier): Color | undefined {
		return colorRegistry.resolveDefaultColor(colorId, this);
	}


	public defines(colorId: ColorIdentifier): boolean {
		const customColor = this.customColorMap[colorId];
		if (customColor instanceof Color) {
			return true;
		}
		return customColor === undefined /* !== DEFAULT_COLOR_CONFIG_VALUE */ && Object.hasOwn(this.colorMap, colorId);
	}

	public getColorCustomization(colorId: ColorIdentifier): Color | undefined {
		const customColor = this.customColorMap[colorId];
		return customColor instanceof Color ? customColor : undefined;
	}

	public setCustomColors(colors: IColorCustomizations) {
		this.customColorMap = Object.create(null);
		this.overwriteCustomColors(colors);

		const themeSpecificColors = this.getThemeSpecificColors(colors) as IColorCustomizations;
		if (types.isObject(themeSpecificColors)) {
			this.overwriteCustomColors(themeSpecificColors);
		}

	}

	private overwriteCustomColors(colors: IColorCustomizations) {
		for (const id in colors) {
			const colorVal = colors[id];
			if (colorVal === DEFAULT_COLOR_CONFIG_VALUE) {
				this.customColorMap[id] = DEFAULT_COLOR_CONFIG_VALUE;
			} else if (typeof colorVal === 'string') {
				this.customColorMap[id] = Color.fromHex(colorVal);
			}
		}
	}

	public isThemeScopeMatch(themeId: string): boolean {
		const themeIdFirstChar = themeId.charAt(0);
		const themeIdLastChar = themeId.charAt(themeId.length - 1);
		const themeIdPrefix = themeId.slice(0, -1);
		const themeIdInfix = themeId.slice(1, -1);
		const themeIdSuffix = themeId.slice(1);
		return themeId === this.settingsId
			|| (this.settingsId.includes(themeIdInfix) && themeIdFirstChar === THEME_SCOPE_WILDCARD && themeIdLastChar === THEME_SCOPE_WILDCARD)
			|| (this.settingsId.startsWith(themeIdPrefix) && themeIdLastChar === THEME_SCOPE_WILDCARD)
			|| (this.settingsId.endsWith(themeIdSuffix) && themeIdFirstChar === THEME_SCOPE_WILDCARD);
	}

	public getThemeSpecificColors(colors: IThemeScopableCustomizations): IThemeScopedCustomizations | undefined {
		let themeSpecificColors: IThemeScopedCustomizations | undefined;
		for (const key in colors) {
			const scopedColors = colors[key];
			if (this.isThemeScope(key) && scopedColors instanceof Object && !Array.isArray(scopedColors)) {
				const themeScopeList = key.match(themeScopeRegex) || [];
				for (const themeScope of themeScopeList) {
					const themeId = themeScope.substring(1, themeScope.length - 1);
					if (this.isThemeScopeMatch(themeId)) {
						if (!themeSpecificColors) {
							themeSpecificColors = Object.create(null) as IThemeScopedCustomizations;
						}
						const scopedThemeSpecificColors = scopedColors as IThemeScopedCustomizations;
						for (const subkey in scopedThemeSpecificColors) {
							const originalColors = themeSpecificColors[subkey];
							const overrideColors = scopedThemeSpecificColors[subkey];
							if (Array.isArray(originalColors) && Array.isArray(overrideColors)) {
								themeSpecificColors[subkey] = originalColors.concat(overrideColors);
							} else if (overrideColors) {
								themeSpecificColors[subkey] = overrideColors;
							}
						}
					}
				}
			}
		}
		return themeSpecificColors;
	}


 private isThemeScope(key: string): boolean { return key[0] === '[' && key[key.length - 1] === ']'; }
 setColors(colors: Readonly<Record<string, string>>): void {
  const next: Record<string, Color> = Object.create(null);
  for (const [id, value] of Object.entries(colors)) {
   if (value !== DEFAULT_COLOR_CONFIG_VALUE) next[id] = Color.fromHex(value);
  }
  this.colorMap = next;
 }
}

/** Resource access is supplied by the bundled catalog, never by theme content. */
export interface ThemeResourceLoader { read(path: string): string; resolve(from: string, include: string): string; }
export function loadColorTheme(loader: ThemeResourceLoader, path: string): Readonly<Record<string, string>> {
 const colors: Record<string, string> = Object.create(null);
 const visiting = new Set<string>();
 function load(location: string): void {
  if (visiting.has(location) || visiting.size >= 32) throw new Error('Cyclic or excessive theme includes');
  visiting.add(location);
  const errors: Json.ParseError[] = [];
  const value = Json.parse(loader.read(location), errors);
  if (errors.length || Json.getNodeType(value) !== 'object') throw new Error('Invalid theme JSON');
  if (value.include !== undefined) {
   if (typeof value.include !== 'string') throw new Error('Invalid theme include');
   load(loader.resolve(location, value.include));
  }
  if (value.colors !== undefined) {
   if (!value.colors || typeof value.colors !== 'object' || Array.isArray(value.colors)) throw new Error('Invalid theme colors');
   for (const id of Object.keys(value.colors)) {
    const color = value.colors[id];
    if (color === DEFAULT_COLOR_CONFIG_VALUE) delete colors[id];
    else if (typeof color === 'string') colors[id] = color;
   }
  }
  visiting.delete(location);
 }
 load(path);
 return Object.freeze(colors);
}
