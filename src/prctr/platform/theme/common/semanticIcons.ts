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
	'state.error': Codicon.error,
	'state.info': Codicon.info,
	'state.loading': Codicon.loading,
	'state.success': Codicon.check,
	'state.warning': Codicon.warning,
	'workbench.browser': Codicon.browser,
	'workbench.configureLayout': Codicon.layout,
	'workbench.panel': Codicon.layoutPanel,
	'workbench.sidebarLeft': Codicon.layoutSidebarLeft,
	'workbench.sidebarLeftHidden': Codicon.layoutSidebarLeftOff,
	'workbench.sidebarRight': Codicon.layoutSidebarRight,
	'workbench.sidebarRightHidden': Codicon.layoutSidebarRightOff,
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
export type SemanticIconId = keyof typeof definitions | keyof typeof productGlyphs;
export type SemanticIconModifier = 'disabled' | 'spin';
export type SemanticIconSize = 12 | 16 | 20 | 24;

export type SemanticIconGlyph = { readonly id: SemanticIconId } & (
	{ readonly fontCharacter: number } | { readonly paths: readonly string[] }
);

/** Resolves a Proctor identifier without exposing a Codicon name to callers. */
export function resolveSemanticIcon(id: SemanticIconId): SemanticIconGlyph {
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
		[...Object.keys(definitions), ...Object.keys(productGlyphs)].sort() as SemanticIconId[]
	);
}
