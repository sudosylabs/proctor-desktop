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
	'disclosure.collapsed': Codicon.chevronRight,
	'disclosure.expanded': Codicon.chevronDown,
	'identity.account': Codicon.account,
	'security.locked': Codicon.lock,
	'security.unlocked': Codicon.unlock,
	'state.error': Codicon.error,
	'state.info': Codicon.info,
	'state.loading': Codicon.loading,
	'state.success': Codicon.check,
	'state.warning': Codicon.warning,
	'workbench.browser': Codicon.browser,
	'workbench.panel': Codicon.layoutPanel,
	'workbench.terminal': Codicon.terminal,
	'workspace.file': Codicon.file,
	'workspace.folder': Codicon.folder,
	'workspace.folderOpen': Codicon.folderOpened
} as const satisfies Readonly<Record<string, ThemeIcon>>;

export type SemanticIconId = keyof typeof definitions;
export type SemanticIconModifier = 'disabled' | 'spin';
export type SemanticIconSize = 12 | 16 | 20 | 24;

export interface SemanticIconGlyph {
	readonly id: SemanticIconId;
	readonly fontCharacter: number;
}

/** Resolves a Proctor identifier without exposing a Codicon name to callers. */
export function resolveSemanticIcon(id: SemanticIconId): SemanticIconGlyph {
	const icon = definitions[id];
	const fontCharacter = getCodiconFontCharacters()[icon.id];
	if (fontCharacter === undefined) {
		throw new Error(`Semantic icon ${id} has no registered font character.`);
	}
	return { id, fontCharacter };
}

export function getSemanticIconIds(): readonly SemanticIconId[] {
	return Object.freeze(Object.keys(definitions) as SemanticIconId[]);
}
