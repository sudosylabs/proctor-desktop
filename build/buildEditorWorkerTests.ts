import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { packagedEditorDependencies } from './lib/packagedEditorDependencies.ts';
import { buildEditorWorker } from './lib/editorWorker.ts';
import { buildTextMateWorker } from './lib/textMateWorker.ts';
import { chromiumTarget, nodeTarget, repositoryRoot, resetBuildOutput } from './lib/paths.ts';

const outdir = resetBuildOutput('editor-worker-tests');
await Promise.all([
	buildEditorWorker(outdir),
	buildTextMateWorker(outdir),
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { renderer: 'test/browser/editor/editorWorkers.test.ts' },
		format: 'esm',
		outdir,
		platform: 'browser',
		loader: {
			'.ttf': 'file',
			'.woff': 'file',
			'.woff2': 'file',
			'.svg': 'file',
			'.png': 'file'
		},
		plugins: [packagedEditorDependencies()],
		target: chromiumTarget,
		tsconfig: 'build/tsconfig.browser.json'
	}),
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { main: 'test/electron/editorWorkerMain.ts' },
		external: ['electron'],
		format: 'esm',
		outdir,
		platform: 'node',
		target: nodeTarget,
		tsconfig: 'build/tsconfig.electron-main.json'
	})
]);
writeFileSync(
	`${outdir}/index.html`,
	`<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; frame-src 'self'; style-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'">
<link rel="stylesheet" href="./renderer.css"></head><body><script type="module" src="./renderer.js"></script></body></html>`
);
writeFileSync(
	`${outdir}/package.json`,
	JSON.stringify({ private: true, type: 'module', main: 'main.js' })
);

// Test-only reference parser: no scripts, workers, connections or external content.
writeFileSync(
	`${outdir}/render-reference.html`,
	`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src-elem 'none'; style-src-attr 'unsafe-inline'; base-uri 'none'"></head><body></body></html>`
);
