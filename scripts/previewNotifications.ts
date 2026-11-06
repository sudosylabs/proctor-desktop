import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import {
	chromiumTarget,
	nodeTarget,
	repositoryRoot,
	resetBuildOutput
} from '../build/lib/paths.ts';
import { electronExecutable } from '../build/lib/electron.ts';
if (process.argv.slice(2).some((argument) => argument !== '--capture'))
	throw new Error('Usage: npm run preview:notifications [-- --capture]');
const outdir = resetBuildOutput('notifications-preview');
await Promise.all([
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { renderer: 'test/browser/notificationsPreview.ts' },
		format: 'esm',
		loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
		outdir,
		platform: 'browser',
		target: chromiumTarget,
		tsconfig: 'build/tsconfig.browser.json'
	}),
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { main: 'test/electron/notificationsPreview.ts' },
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
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="./renderer.css"><title>Proctor notifications</title></head><body><script type="module" src="./renderer.js"></script></body></html>`
);
writeFileSync(`${outdir}/package.json`, JSON.stringify({ type: 'module', main: 'main.js' }));
const child = spawn(electronExecutable(), [`${outdir}/main.js`, ...process.argv.slice(2)], {
	cwd: repositoryRoot,
	stdio: 'inherit'
});
child.once('error', (error) => {
	console.error(error);
	process.exitCode = 1;
});
child.once('exit', (code, signal) => {
	process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1);
});
