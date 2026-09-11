import { Lazy } from '../../../../base/common/lazy.js';
import type { ITreeSitterAssets } from './treeSitterAssets.js';

const runtime = new Lazy(async () => {
	const [module, wasm] = await Promise.all([
		import('@vscode/tree-sitter-wasm'),
		import('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm')
	]);
	const options = { wasmBinary: wasm.default, locateFile: () => 'proctor-asset:/tree-sitter.wasm' };
	await module.Parser.init(options);
	return module;
});

export class PackagedTreeSitterAssets implements ITreeSitterAssets {
	declare readonly _serviceBrand: undefined;
	loadRuntime() { return runtime.value; }

	async loadGrammar(languageId: string): Promise<Uint8Array> {
		switch (languageId) {
			case 'css': return (await import('@vscode/tree-sitter-wasm/wasm/tree-sitter-css.wasm')).default;
			case 'typescript': return (await import('@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm')).default;
			case 'ini': return (await import('@vscode/tree-sitter-wasm/wasm/tree-sitter-ini.wasm')).default;
			case 'regex': return (await import('@vscode/tree-sitter-wasm/wasm/tree-sitter-regex.wasm')).default;
			default: throw new Error('No packaged Tree-sitter grammar for this language.');
		}
	}

	async loadQuery(languageId: string, kind: 'injections' | 'highlights'): Promise<string | undefined> {
		if (kind === 'injections') {
			return languageId === 'typescript'
				? (await import('../../../../editor/common/languages/injections/typescript.scm')).default
				: undefined;
		}
		switch (languageId) {
			case 'css': return (await import('../../../../editor/common/languages/highlights/css.scm')).default;
			case 'typescript': return (await import('../../../../editor/common/languages/highlights/typescript.scm')).default;
			case 'ini': return (await import('../../../../editor/common/languages/highlights/ini.scm')).default;
			case 'regex': return (await import('../../../../editor/common/languages/highlights/regex.scm')).default;
			default: return undefined;
		}
	}
}
