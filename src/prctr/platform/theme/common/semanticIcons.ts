/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { getCodiconFontCharacters } from '../../../base/common/codiconsUtil.js';
import type { ThemeIcon } from '../../../base/common/themables.js';

const definitions = {
	'action.add': Codicon.add,
	'action.back': Codicon.arrowLeft,
	'action.close': Codicon.close,
	'action.delete': Codicon.trash,
	'action.discard': Codicon.discard,
	'action.edit': Codicon.edit,
	'action.forward': Codicon.arrowRight,
	'action.more': Codicon.more,
	'action.refresh': Codicon.refresh,
	'action.remove': Codicon.remove,
	'action.save': Codicon.save,
	'action.search': Codicon.search,
	'action.settings': Codicon.settingsGear,
	'action.signOut': Codicon.signOut,
	'device.desktop': Codicon.deviceDesktop,
	'session.desktop': Codicon.window,
	'session.web': Codicon.globe,
	'disclosure.collapsed': Codicon.chevronRight,
	'disclosure.expanded': Codicon.chevronDown,
	'identity.account': Codicon.account,
	'navigation.back': Codicon.chevronLeft,
	'navigation.forward': Codicon.chevronRight,
	'notification.bell': Codicon.bell,
	'notification.clearAll': Codicon.clearAll,
	'notification.collapse': Codicon.chevronDown,
	'notification.expand': Codicon.chevronUp,
	'notification.muted': Codicon.bellSlash,
	'notification.position': Codicon.arrowSwap,
	'notification.read': Codicon.book,
	'notification.unread': Codicon.bellDot,
	'security.locked': Codicon.lock,
	'security.unlocked': Codicon.unlock,
	'state.info': Codicon.info,
	'workbench.browser': Codicon.browser,
	'workbench.panel': Codicon.layoutPanel,
	'workbench.sidebarLeft': Codicon.layoutSidebarLeft,
	'workbench.terminal': Codicon.terminal,
	'workspace.file': Codicon.file,
	'workspace.folder': Codicon.folder,
	'workspace.folderOpen': Codicon.folderOpened
} as const satisfies Readonly<Record<string, ThemeIcon>>;

/** Original Proctor line glyphs for institutional work, on a shared 24-unit grid. */
const productGlyphs = {
	'product.exams': [
		'M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
		'M9 2h6v6H9z',
		'm8 13 1 1 2-2M14 13h3M8 18h9'
	],
	'product.management': [
		'M8 3h10a2 2 0 0 1 2 2v12',
		'M4 7h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z',
		'M6 12h6M6 16h4'
	],
	'product.administration': ['m3 8 9-5 9 5v2H3z', 'M5 10v9M10 10v9M14 10v9M19 10v9M3 21h18'],
	'product.calendar': [
		'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
		'M7 3v4M17 3v4M3 11h18M7 15h2M13 15h2M7 18h2'
	]
} as const;
/** One shape of a status glyph: a 1.5-unit stroke, or a fill drawn with the even-odd rule. */
export interface StatusGlyphShape {
	readonly d: string;
	readonly paint: 'stroke' | 'fill';
	/** A stroke dash pattern, for a step that has not started. */
	readonly dash?: string;
	/** Drawn in the quiet track color instead of the glyph's own color. */
	readonly track?: boolean;
}

/**
 * Proctor's status glyphs on a 16-unit grid. Every status has its own shape, so
 * none depends on color: a check in a circle, a filled circle with a cut-out
 * cross, an exclamation in a circle, a spinning arc on a track, a dashed circle
 * and a dash.
 */
const statusGlyphs = {
	'state.success': [
		{ d: 'M8 1a7 7 0 1 1 0 14A7 7 0 1 1 8 1Z', paint: 'stroke' },
		{ d: 'M5 8.2l2 2 4-4.4', paint: 'stroke' }
	],
	'state.error': [
		{
			d: 'M8 1a7 7 0 1 0 0 14A7 7 0 1 0 8 1ZM8 9.13L10.4 11.53L11.53 10.4L9.13 8L11.53 5.6L10.4 4.47L8 6.87L5.6 4.47L4.47 5.6L6.87 8L4.47 10.4L5.6 11.53Z',
			paint: 'fill'
		}
	],
	'state.warning': [
		{ d: 'M8 1a7 7 0 1 1 0 14A7 7 0 1 1 8 1Z', paint: 'stroke' },
		{ d: 'M8 4.6v4.2', paint: 'stroke' },
		{ d: 'M8 10.25a0.95 0.95 0 1 1 0 1.9a0.95 0.95 0 1 1 0-1.9Z', paint: 'fill' }
	],
	'state.loading': [
		{ d: 'M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13Z', paint: 'stroke', track: true },
		{ d: 'M8 1.5a6.5 6.5 0 0 1 6.5 6.5', paint: 'stroke' }
	],
	'state.pending': [
		{ d: 'M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13Z', paint: 'stroke', dash: '2 2.4' }
	],
	'state.skipped': [{ d: 'M5 8h6', paint: 'stroke' }]
} as const satisfies Readonly<Record<string, readonly StatusGlyphShape[]>>;

export type SemanticIconId =
	keyof typeof definitions | keyof typeof productGlyphs | keyof typeof statusGlyphs;
export type SemanticIconModifier = 'disabled' | 'spin';
export type SemanticIconSize = 12 | 16 | 20 | 24;

export type SemanticIconGlyph = { readonly id: SemanticIconId } & (
	| { readonly fontCharacter: number }
	| { readonly paths: readonly string[] }
	| { readonly shapes: readonly StatusGlyphShape[] }
);

/** Resolves a Proctor identifier without exposing a Codicon name to callers. */
export function resolveSemanticIcon(id: SemanticIconId): SemanticIconGlyph {
	if (Object.hasOwn(statusGlyphs, id))
		return { id, shapes: statusGlyphs[id as keyof typeof statusGlyphs] };
	if (Object.hasOwn(productGlyphs, id))
		return { id, paths: productGlyphs[id as keyof typeof productGlyphs] };
	const icon = definitions[id as keyof typeof definitions];
	const fontCharacter = getCodiconFontCharacters()[icon.id];
	if (fontCharacter === undefined) {
		throw new Error(`Semantic icon ${id} has no registered font character.`);
	}
	return { id, fontCharacter };
}

export function getSemanticIconIds(): readonly SemanticIconId[] {
	return Object.freeze(
		[
			...Object.keys(definitions),
			...Object.keys(productGlyphs),
			...Object.keys(statusGlyphs)
		].sort() as SemanticIconId[]
	);
}
