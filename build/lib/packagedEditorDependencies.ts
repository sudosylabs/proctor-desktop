import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Plugin } from 'esbuild';
import ts from 'typescript';

const treeSitterAssets: Readonly<Record<string, string>> = {
	'tree-sitter.js': '874f4a37c4beddef04d8eb9a8dbd28a65b63111f2d2123a38fd3f5333ee046dd',
	'tree-sitter.wasm': '3a31af706ffdf4a7116b064cdd4988df6791823298615009fc5b6bccbd42909b',
	'tree-sitter-css.wasm': '8a23977fe271357cce6f254ef88c9bebf3854602d8046605aef6a45c02135c59',
	'tree-sitter-typescript.wasm':
		'778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d',
	'tree-sitter-ini.wasm': '1e8cdf3027209100fa54a43d0faed69721ae1116428164c8ad6dcc496a9aa6af',
	'tree-sitter-regex.wasm': 'e63c28e3a023614e14f2086b0d818e190239ebe5b2fcce7e64a9940091d83a79'
};

/** Adapt only the pinned diff package's resource acquisition to a sandboxed browser bundle. */
export function packagedEditorDependencies(): Plugin {
	return {
		name: 'packaged-editor-dependencies',
		setup(build) {
			build.onLoad(
				{ filter: /[\\/]resources[\\/]file-icons[\\/]seti[\\/]seti\.woff$/ },
				(args) => {
					const bytes = readFileSync(args.path);
					if (
						createHash('sha256').update(bytes).digest('hex') !==
						'b127762058f89b37b08d76185e3b0558f5c28859e39a3840a27cb28b9739d6e2'
					)
						throw new Error('Pinned Seti font changed.');
					return { contents: bytes, loader: 'file' };
				}
			);
			// The pinned extension asset is JSONC. Normalize only its serialization;
			// the complete source language-configuration parser still runs in the renderer.
			build.onLoad(
				{
					filter: /[\\/]prctr[\\/]workbench[\\/]services[\\/]textMate[\\/]common[\\/]json[\\/]language-configuration\.json$/
				},
				(args) => {
					const parsed = ts.parseConfigFileTextToJson(
						args.path,
						readFileSync(args.path, 'utf8')
					);
					if (parsed.error)
						throw new Error('The packaged JSON language configuration is invalid.');
					return { contents: JSON.stringify(parsed.config), loader: 'json' };
				}
			);
			build.onLoad(
				{
					filter: /[\\/]vscode-(textmate|oniguruma)[\\/]release[\\/](main\.js|onig\.wasm)$/
				},
				(args) => {
					const bytes = readFileSync(args.path);
					const key = args.path.replaceAll('\\', '/').split('/node_modules/').at(-1)!;
					const hashes: Readonly<Record<string, string>> = {
						'vscode-textmate/release/main.js':
							'9da91ca33178e8d68ac5b9ea5733258275fe2f1924db02930ef9cf7e0d850e0f',
						'vscode-oniguruma/release/main.js':
							'8eeebfd13b75baaf42e014e8492366e5e28c9a1336b006193a39a0f15bfb0b1e',
						'vscode-oniguruma/release/onig.wasm':
							'fd885c2d12e5951e59d761ebd4a006e06254b1491fd6f530c92b69fb4d8d77d9'
					};
					if (createHash('sha256').update(bytes).digest('hex') !== hashes[key])
						throw new Error('Unadmitted TextMate asset or changed package bytes.');
					return {
						contents: bytes,
						loader: key.endsWith('.wasm') ? 'binary' : 'js',
						resolveDir: dirname(args.path)
					};
				}
			);

			build.onLoad(
				{ filter: /[\\/]@vscode[\\/]tree-sitter-wasm[\\/]wasm[\\/][^/\\]+$/ },
				(args) => {
					const bytes = readFileSync(args.path);
					const name = basename(args.path);
					if (createHash('sha256').update(bytes).digest('hex') !== treeSitterAssets[name])
						throw new Error('Unadmitted Tree-sitter asset or changed package bytes.');
					if (name.endsWith('.wasm')) return { contents: bytes, loader: 'binary' };
					let contents = bytes.toString('utf8');
					const guards = [
						"typeof __filename !== 'undefined'",
						'globalThis.process?.versions.node'
					];
					for (const guard of guards) {
						if (contents.split(guard).length !== 2)
							throw new Error('Pinned Tree-sitter platform guard changed.');
						contents = contents.replace(guard, 'false');
					}
					const nodeFlag =
						'var ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string";';
					if (contents.split(nodeFlag).length !== 2)
						throw new Error('Pinned Tree-sitter environment flag changed.');
					contents = contents
						.replace(nodeFlag, '')
						.replace(/\bENVIRONMENT_IS_NODE\b/g, 'false');
					return { contents, loader: 'js', resolveDir: dirname(args.path) };
				}
			);
			build.onLoad(
				{
					filter: /[\\/]prctr[\\/]editor[\\/]common[\\/]languages[\\/](highlights|injections)[\\/](css|typescript|ini|regex)\.scm$/
				},
				(args) => ({
					contents: readFileSync(args.path, 'utf8'),
					loader: 'text'
				})
			);

			build.onLoad({ filter: /[\\/]@vscode[\\/]diff[\\/]dist[\\/]wire\.js$/ }, (args) => {
				const source = readFileSync(args.path, 'utf8');
				if (
					createHash('sha256').update(source).digest('hex') !==
					'f92a8e248f5d5777e9a534f7ce3917cd0888d0d4c4244efb16eac7a9d7a22518'
				)
					throw new Error('Pinned diff package loader changed.');
				const asset =
					"new URL(new URL('diff_wasm_bg-c6YkaZRL.wasm', import.meta.url).href)";
				if (source.split(asset).length !== 3)
					throw new Error('Pinned diff WASM loader changed.');
				const nodeCondition = "typeof process !== 'undefined' && process.versions?.node";
				if (source.split(nodeCondition).length !== 2)
					throw new Error('Pinned diff platform loader changed.');
				const contents =
					"import prctrDiffWasm from './diff_wasm_bg-c6YkaZRL.wasm';\n" +
					source.replaceAll(asset, 'prctrDiffWasm').replace(nodeCondition, 'false');
				return { contents, loader: 'js', resolveDir: dirname(args.path) };
			});
			build.onLoad(
				{ filter: /[\\/]@vscode[\\/]diff[\\/]dist[\\/]diff_wasm_bg-c6YkaZRL\.wasm$/ },
				(args) => {
					const bytes = readFileSync(args.path);
					if (
						createHash('sha256').update(bytes).digest('hex') !==
						'cf44cc0cfb929a2cb714e181b73d3c8964af74593ce07dfdfaf0fb1d4824d241'
					)
						throw new Error('Pinned diff WASM bytes changed.');
					return { contents: bytes, loader: 'binary' };
				}
			);
		}
	};
}
