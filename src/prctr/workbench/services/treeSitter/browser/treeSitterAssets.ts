import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ITreeSitterAssets = createDecorator<ITreeSitterAssets>('treeSitterAssets');

/** The parser can acquire only packaged bytes and queries, never a caller-provided location. */
export interface ITreeSitterAssets {
	readonly _serviceBrand: undefined;
	loadRuntime(): Promise<typeof import('@vscode/tree-sitter-wasm')>;
	loadGrammar(languageId: string): Promise<Uint8Array>;
	loadQuery(languageId: string, kind: 'injections' | 'highlights'): Promise<string | undefined>;
}
