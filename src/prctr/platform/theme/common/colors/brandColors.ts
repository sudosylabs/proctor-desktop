/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Color } from '../../../../base/common/color.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import { plumPalette } from '../plumPalette.generated.js';
import { registerColor } from '../colorUtils.js';

const L = plumPalette.light;
const D = plumPalette.dark;

/*
 * Proctor's brand colors. They are reserved for the primary action, links,
 * progress and the product mark, so one accent stays recognizable in every
 * bundled theme. Each scheme keeps text on the accent at WCAG AA or better.
 */

export const brandAccent = registerColor(
	'proctor.brandAccent',
	{
		light: Color.fromHex(L.accent[8]),
		dark: Color.fromHex(D.accent[8]),
		hcLight: Color.fromHex('#3F0075'),
		hcDark: Color.fromHex('#C9A3F5')
	},
	localize('proctor.brandAccent', 'Background of Proctor primary actions.')
);

export const brandAccentHover = registerColor(
	'proctor.brandAccentHover',
	{
		light: Color.fromHex(L.accent[9]),
		dark: Color.fromHex(D.accent[9]),
		hcLight: Color.fromHex('#2E0057'),
		hcDark: Color.fromHex('#DCC2F8')
	},
	localize('proctor.brandAccentHover', 'Background of hovered Proctor primary actions.')
);

export const brandAccentForeground = registerColor(
	'proctor.brandAccentForeground',
	{
		light: Color.white,
		dark: Color.white,
		hcLight: Color.white,
		hcDark: Color.black
	},
	localize('proctor.brandAccentForeground', 'Text on Proctor primary actions.')
);

export const brandLink = registerColor(
	'proctor.brandLink',
	{
		light: Color.fromHex(L.accent[8]),
		dark: Color.fromHex(D.accent[10]),
		hcLight: Color.fromHex('#3F0075'),
		hcDark: Color.fromHex('#DCC2F8')
	},
	localize('proctor.brandLink', 'Proctor link text.')
);

export const brandMark = registerColor(
	'proctor.brandMark',
	{
		light: Color.fromHex(L.accent[8]),
		dark: Color.fromHex(D.accent[10]),
		hcLight: Color.fromHex('#3F0075'),
		hcDark: Color.fromHex('#DCC2F8')
	},
	localize('proctor.brandMark', 'Proctor product mark and progress indicators.')
);
