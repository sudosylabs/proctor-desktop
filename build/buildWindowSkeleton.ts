import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromiumTarget, nodeTarget, repositoryRoot, resetBuildOutput } from './lib/paths.ts';

const outdir = resetBuildOutput('window-skeleton');
await Promise.all([
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { launch: 'src/prctr/code/electron-browser/launch.main.ts' },
		format: 'esm',
		loader: { '.svg': 'file' },
		outdir,
		platform: 'browser',
		target: chromiumTarget,
		tsconfig: 'build/tsconfig.browser.json'
	}),
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { main: 'test/electron/windowSkeletonMain.ts' },
		external: ['electron', 'electron/main'],
		format: 'esm',
		outdir,
		platform: 'node',
		target: nodeTarget,
		tsconfig: 'build/tsconfig.electron-test.json'
	}),
	...(['launch', 'authenticated', 'candidate'] as const).map((kind) =>
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
writeFileSync(
	`${outdir}/index.html`,
	'<!doctype html><html><body>Proctor window skeleton</body></html>\n',
	'utf8'
);
writeFileSync(
	`${outdir}/launch.html`,
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'; img-src \'self\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./launch.css"><title>Proctor</title></head><body><script type="module" src="./launch.js"></script></body></html>\n',
	'utf8'
);
writeFileSync(
	`${outdir}/package.json`,
	`${JSON.stringify({ name: 'proctor-window-skeleton', private: true, type: 'module', main: 'main.js' }, null, 2)}\n`,
	'utf8'
);
