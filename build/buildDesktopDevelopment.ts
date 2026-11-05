import { nodeEsmRuntime } from './lib/nodeEsmRuntime.ts';
import { packagedEditorDependencies } from './lib/packagedEditorDependencies.ts';
import { buildEditorWorker } from './lib/editorWorker.ts';
import { buildJsonWorker } from './lib/jsonWorker.ts';
import { buildTextMateWorker } from './lib/textMateWorker.ts';
import { execFileSync } from 'node:child_process';
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import {
	repositoryRoot,
	repositoryPath,
	resetBuildOutput,
	nodeTarget,
	chromiumTarget
} from './lib/paths.ts';

const outdir = resetBuildOutput('desktop-development');
execFileSync(
	'cargo',
	['build', '--locked', '--manifest-path', 'native/Cargo.toml', '-p', 'desktop-key-custody'],
	{ cwd: repositoryRoot, stdio: 'inherit' }
);
const nativeFile =
	process.platform === 'win32'
		? 'desktop_key_custody.dll'
		: `libdesktop_key_custody.${process.platform === 'darwin' ? 'dylib' : 'so'}`;
cpSync(
	repositoryPath(`native/target/debug/${nativeFile}`),
	join(outdir, 'desktop_key_custody.node')
);
await Promise.all([
	buildEditorWorker(outdir),
	buildJsonWorker(outdir),
	buildTextMateWorker(outdir),
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: {
			launch: 'src/prctr/code/electron-browser/launch.main.ts',
			authenticated: 'src/prctr/code/electron-browser/authenticated.main.ts'
		},
		format: 'esm',
		loader: { '.svg': 'file', '.ttf': 'file', '.png': 'file' },
		plugins: [packagedEditorDependencies()],
		outdir,
		platform: 'browser',
		target: chromiumTarget,
		tsconfig: 'build/tsconfig.browser.json'
	}),
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { main: 'src/prctr/code/electron-main/desktopDevelopmentMain.ts' },
		external: ['electron', 'electron/main'],
		format: 'esm',
		loader: { '.css': 'text' },
		outdir,
		platform: 'node',
		...nodeEsmRuntime,
		target: nodeTarget,
		tsconfig: 'build/tsconfig.electron-main.json'
	}),
	...(['launch', 'authenticated'] as const).map((kind) =>
		build({
			absWorkingDir: repositoryRoot,
			bundle: true,
			entryPoints: {
				[`${kind}Preload`]: `src/prctr/code/electron-browser/${kind}Preload.ts`
			},
			external: ['electron'],
			format: 'cjs',
			outExtension: { '.js': '.cjs' },
			outdir,
			platform: 'node',
			target: nodeTarget,
			tsconfig: 'build/tsconfig.electron-browser.json'
		})
	)
]);
for (const kind of ['launch', 'authenticated'])
	writeFileSync(
		join(outdir, `${kind}.html`),
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'${kind === 'authenticated' ? " 'wasm-unsafe-eval'; worker-src 'self' blob:" : ''}; style-src 'self'; img-src 'self'${kind === 'authenticated' ? ' data:' : ''}; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./${kind}.css"><title>Proctor</title></head><body><script type="module" src="./${kind}.js"></script></body></html>\n`
	);
writeFileSync(
	join(outdir, 'package.json'),
	JSON.stringify({
		name: 'proctor-desktop-development',
		private: true,
		type: 'module',
		main: 'main.js'
	}) + '\n'
);

for (const appearance of ['dark', 'light']) {
	const name = `proctor-lockup-vertical-25d-${appearance}.svg`;
	cpSync(
		repositoryPath(`resources/branding/source/lockup/${name}`),
		join(outdir, 'branding', name)
	);
}
