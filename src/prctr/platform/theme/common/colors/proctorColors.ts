/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Color } from '../../../../base/common/color.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import { registerColor } from '../colorUtils.js';

/*
 * Proctor roles that VS Code has no color for. The defaults are the Proctor
 * Light and Proctor Dark palette, so every bundled theme gets the same quiet
 * tertiary text, pending glyphs, disabled fills and development stripes.
 */

export const tertiaryForeground = registerColor(
	'proctor.tertiaryForeground',
	{
		light: Color.fromHex('#686C72'),
		dark: Color.fromHex('#9DA1A7'),
		hcLight: Color.fromHex('#292929'),
		hcDark: Color.white
	},
	localize('proctor.tertiaryForeground', 'Quiet supporting text, such as addresses and details.')
);

export const pendingForeground = registerColor(
	'proctor.pendingForeground',
	{
		light: Color.fromHex('#B4B7BB'),
		dark: Color.fromHex('#62666C'),
		hcLight: Color.fromHex('#292929'),
		hcDark: Color.white
	},
	localize('proctor.pendingForeground', 'Glyphs of steps that have not started or were skipped.')
);

export const disabledBackground = registerColor(
	'proctor.disabledBackground',
	{
		light: Color.fromHex('#ECECE9'),
		dark: Color.fromHex('#2A2C30'),
		hcLight: Color.white,
		hcDark: Color.black
	},
	localize('proctor.disabledBackground', 'Fill of an unavailable primary action.')
);

export const developmentBackground = registerColor(
	'proctor.developmentBackground',
	{
		light: Color.fromHex('#FFF3D1'),
		dark: Color.fromHex('#3A2E10'),
		hcLight: Color.white,
		hcDark: Color.black
	},
	localize('proctor.developmentBackground', 'First stripe of the development-server strip.')
);

export const developmentStripe = registerColor(
	'proctor.developmentStripe',
	{
		light: Color.fromHex('#FBE6AE'),
		dark: Color.fromHex('#30260D'),
		hcLight: Color.white,
		hcDark: Color.black
	},
	localize('proctor.developmentStripe', 'Second stripe of the development-server strip.')
);

export const developmentForeground = registerColor(
	'proctor.developmentForeground',
	{
		light: Color.fromHex('#5B3B00'),
		dark: Color.fromHex('#F2D489'),
		hcLight: Color.fromHex('#292929'),
		hcDark: Color.white
	},
	localize('proctor.developmentForeground', 'Text of the development-server strip.')
);
