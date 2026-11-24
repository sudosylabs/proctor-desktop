import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { developmentLaunch } from '../build/lib/electron.ts';
import { packagedEditorDependencies } from '../build/lib/packagedEditorDependencies.ts';
import {
	chromiumTarget,
	nodeTarget,
	repositoryRoot,
	resetBuildOutput
} from '../build/lib/paths.ts';

/*
 * Renders AuthenticatedWindow pages from the real window code with the design boards' data, so
 * a page can be compared with its board without a server or a sign-in.
 * Usage: npm run preview:pages -- <output folder> <name>=<area>/<page>,<light|dark> ...
 */
const [output, ...shots] = process.argv.slice(2);
if (output === undefined || shots.length === 0)
	throw new Error(
		'Usage: npm run preview:pages -- <output folder> <name>=<area>/<page>,<theme> ...'
	);
const outdir = resetBuildOutput('page-preview');
await Promise.all([
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { renderer: 'test/browser/pagePreview/pagePreview.ts' },
		format: 'esm',
		loader: {
			'.svg': 'file',
			'.ttf': 'file',
			'.woff': 'file',
			'.woff2': 'file',
			'.png': 'file'
		},
		plugins: [packagedEditorDependencies()],
		outdir,
		platform: 'browser',
		target: chromiumTarget,
		tsconfig: 'build/tsconfig.browser.json'
	}),
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { main: 'test/electron/pagePreviewMain.ts' },
		external: ['electron'],
		format: 'esm',
		outdir,
		platform: 'node',
		target: nodeTarget,
		tsconfig: 'build/tsconfig.electron-test.json'
	})
]);
writeFileSync(
	`${outdir}/index.html`,
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="./renderer.css"><title>Proctor</title></head><body><script type="module" src="./renderer.js"></script></body></html>`
);
writeFileSync(`${outdir}/package.json`, JSON.stringify({ type: 'module', main: 'main.js' }));
const folder = resolve(output);
mkdirSync(folder, { recursive: true });
// One Electron run per page, so no page inherits another's state.
for (const shot of shots) {
	const launch = developmentLaunch([`${outdir}/main.js`, folder, shot]);
	const result = spawnSync(launch.command, launch.args, {
		cwd: repositoryRoot,
		// The boards give times in UTC.
		env: { ...process.env, TZ: 'UTC' },
		stdio: 'inherit'
	});
	if (result.status !== 0) process.exitCode = result.status ?? 1;
}
