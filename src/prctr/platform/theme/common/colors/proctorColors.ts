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

/*
 * AuthenticatedWindow's frame: the area rail and contextual sidebar sit on the
 * window material, and on these opaque colors when no material shows.
 */

export const frameBackground = registerColor(
	'proctor.frameBackground',
	{
		light: Color.fromHex('#F4F3F0'),
		dark: Color.fromHex('#1E1F22'),
		hcLight: Color.white,
		hcDark: Color.black
	},
	localize(
		'proctor.frameBackground',
		'Window frame behind the area rail and sidebar when no system material shows.'
	)
);

export const frameDivider = registerColor(
	'proctor.frameDivider',
	{
		light: Color.fromHex('#00000012'),
		dark: Color.fromHex('#FFFFFF14'),
		hcLight: Color.fromHex('#0F4A85'),
		hcDark: Color.fromHex('#6FC3DF')
	},
	localize('proctor.frameDivider', 'Hairline between the frame regions.')
);

export const navigationSelectedBackground = registerColor(
	'proctor.navigationSelectedBackground',
	{
		light: Color.fromHex('#0000000F'),
		dark: Color.fromHex('#FFFFFF14'),
		hcLight: Color.fromHex('#0F4A851A'),
		hcDark: Color.fromHex('#6FC3DF33')
	},
	localize(
		'proctor.navigationSelectedBackground',
		'Surface of the selected area, page or account.'
	)
);

export const navigationSelectedForeground = registerColor(
	'proctor.navigationSelectedForeground',
	{
		light: Color.fromHex('#161616'),
		dark: Color.fromHex('#EDEDEE'),
		hcLight: Color.fromHex('#292929'),
		hcDark: Color.white
	},
	localize('proctor.navigationSelectedForeground', 'Text of the selected area, page or account.')
);

export const avatarBackground = registerColor(
	'proctor.avatarBackground',
	{
		light: Color.fromHex('#ECE2F6'),
		dark: Color.fromHex('#3A2B52'),
		hcLight: Color.white,
		hcDark: Color.black
	},
	localize('proctor.avatarBackground', 'Fill behind initials when an account has no photo.')
);

export const avatarForeground = registerColor(
	'proctor.avatarForeground',
	{
		light: Color.fromHex('#4A1488'),
		dark: Color.fromHex('#E3D1FA'),
		hcLight: Color.fromHex('#292929'),
		hcDark: Color.white
	},
	localize('proctor.avatarForeground', 'Initials of an account that has no photo.')
);

export const cardBackground = registerColor(
	'proctor.cardBackground',
	{
		light: Color.fromHex('#FFFFFF'),
		dark: Color.fromHex('#222327'),
		hcLight: Color.white,
		hcDark: Color.black
	},
	localize('proctor.cardBackground', 'Grouped lists and fields that sit on the window canvas.')
);

/*
 * Contrast roles from the 2026-11 design review: field and control edges reach 3:1 against
 * cards and panels, status words 4.5:1 on their tint, frame text 4.5:1 on the window material.
 */

export const fieldBorder = registerColor(
	'proctor.fieldBorder',
	{
		light: Color.fromHex('#8E9196'),
		dark: Color.fromHex('#6B6F76'),
		hcLight: Color.fromHex('#0F4A85'),
		hcDark: Color.fromHex('#6FC3DF')
	},
	localize('proctor.fieldBorder', 'Edge of a field you type or choose in.')
);

export const controlOutline = registerColor(
	'proctor.controlOutline',
	{
		light: Color.fromHex('#7D8086'),
		dark: Color.fromHex('#767A81'),
		hcLight: Color.fromHex('#0F4A85'),
		hcDark: Color.fromHex('#6FC3DF')
	},
	localize(
		'proctor.controlOutline',
		'Outline of a switch that is off, a stepper or a selected segment.'
	)
);

export const accentLine = registerColor(
	'proctor.accentLine',
	{
		light: Color.fromHex('#5C00AA'),
		dark: Color.fromHex('#9B5DE5'),
		hcLight: Color.fromHex('#0F4A85'),
		hcDark: Color.fromHex('#6FC3DF')
	},
	localize('proctor.accentLine', 'Accent stroke of a switch that is on and of the selected tab.')
);

export const selectedRowBackground = registerColor(
	'proctor.selectedRowBackground',
	{
		light: Color.fromHex('#F6F0FC'),
		dark: Color.fromHex('#2A2338'),
		hcLight: Color.fromHex('#0F4A851A'),
		hcDark: Color.fromHex('#6FC3DF33')
	},
	localize('proctor.selectedRowBackground', 'Surface of a selected row in a list or table.')
);

export const statusSafeguardForeground = registerColor(
	'proctor.statusSafeguardForeground',
	{
		light: Color.fromHex('#17693A'),
		dark: Color.fromHex('#62C98C'),
		hcLight: Color.fromHex('#292929'),
		hcDark: Color.white
	},
	localize(
		'proctor.statusSafeguardForeground',
		'Status word for a safeguard in place on your own account.'
	)
);

export const statusAttentionForeground = registerColor(
	'proctor.statusAttentionForeground',
	{
		light: Color.fromHex('#7D4D00'),
		dark: Color.fromHex('#E8B44E'),
		hcLight: Color.fromHex('#292929'),
		hcDark: Color.white
	},
	localize(
		'proctor.statusAttentionForeground',
		'Status word for something that waits on you or lapses soon.'
	)
);

export const frameLabelForeground = registerColor(
	'proctor.frameLabelForeground',
	{
		light: Color.fromHex('#686C72'),
		dark: Color.fromHex('#C9CCD1'),
		hcLight: Color.fromHex('#292929'),
		hcDark: Color.white
	},
	localize('proctor.frameLabelForeground', 'Group labels on the window frame.')
);

export const frameItemForeground = registerColor(
	'proctor.frameItemForeground',
	{
		light: Color.fromHex('#55585D'),
		dark: Color.fromHex('#D0D3D8'),
		hcLight: Color.fromHex('#292929'),
		hcDark: Color.white
	},
	localize('proctor.frameItemForeground', 'Rail and sidebar entries on the window frame.')
);
