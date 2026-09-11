import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import type { IValidGrammarDefinition } from './TMScopeRegistry.js';
import onigurumaWasm from 'vscode-oniguruma/release/onig.wasm';
import json from './json/syntaxes/JSON.tmLanguage.json' with { type: 'json' };
import jsonc from './json/syntaxes/JSONC.tmLanguage.json' with { type: 'json' };

export const ITextMateAssets = createDecorator<ITextMateAssets>('textMateAssets');
export interface ITextMateAssets {
	readonly _serviceBrand: undefined;
	readonly grammars: readonly IValidGrammarDefinition[];
	readGrammar(resource: URI): Promise<string>;
	loadTextMate(): Promise<typeof import('vscode-textmate')>;
	loadOniguruma(): Promise<typeof import('vscode-oniguruma')>;
}

const jsonResource = URI.parse('proctor-asset:/grammars/JSON.tmLanguage.json');
const jsoncResource = URI.parse('proctor-asset:/grammars/JSONC.tmLanguage.json');
let oniguruma: Promise<typeof import('vscode-oniguruma')> | undefined;

/** Literal assets shared by renderer and worker; no URL supplied by a document is fetched. */
export class PackagedTextMateAssets implements ITextMateAssets {
	declare readonly _serviceBrand: undefined;
	readonly grammars: readonly IValidGrammarDefinition[] = [
		{
			location: jsonResource,
			language: 'json',
			scopeName: 'source.json',
			embeddedLanguages: {},
			tokenTypes: {},
			balancedBracketSelectors: ['*'],
			unbalancedBracketSelectors: []
		},
		{
			location: jsoncResource,
			language: 'jsonc',
			scopeName: 'source.json.comments',
			embeddedLanguages: {},
			tokenTypes: {},
			balancedBracketSelectors: ['*'],
			unbalancedBracketSelectors: []
		}
	];

	async readGrammar(resource: URI): Promise<string> {
		switch (resource.toString()) {
			case jsonResource.toString():
				return JSON.stringify(json);
			case jsoncResource.toString():
				return JSON.stringify(jsonc);
			default:
				throw new Error('Unregistered TextMate grammar resource.');
		}
	}
	loadTextMate(): Promise<typeof import('vscode-textmate')> {
		return import('vscode-textmate');
	}
	loadOniguruma(): Promise<typeof import('vscode-oniguruma')> {
		if (!oniguruma)
			oniguruma = (async () => {
				try {
					const library = await import('vscode-oniguruma');
					await library.loadWASM(new Uint8Array(onigurumaWasm).buffer);
					return library;
				} catch (error) {
					oniguruma = undefined;
					throw error;
				}
			})();
		return oniguruma;
	}
}
