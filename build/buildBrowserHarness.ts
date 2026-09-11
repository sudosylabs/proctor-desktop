import { buildEditorWorker } from './lib/editorWorker.ts';
import { buildTextMateWorker } from './lib/textMateWorker.ts';
import { packagedEditorDependencies } from './lib/packagedEditorDependencies.ts';
import { buildJsonWorker } from './lib/jsonWorker.ts';
import { copyFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import {
	chromiumTarget,
	nodeTarget,
	repositoryRoot,
	repositoryPath,
	resetBuildOutput
} from './lib/paths.ts';

const outputDirectory = resetBuildOutput('browser-harness');

await Promise.all([
	buildEditorWorker(outputDirectory),
	buildTextMateWorker(outputDirectory),
	buildJsonWorker(outputDirectory),
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { renderer: 'test/browser/rendererHarness.ts' },
		format: 'esm',
		logLevel: 'info',
		loader: { '.svg': 'file', '.ttf': 'file', '.png': 'file' },
		plugins: [packagedEditorDependencies()],
		outdir: outputDirectory,
		platform: 'browser',
		sourcemap: false,
		target: chromiumTarget,
		tsconfig: 'build/tsconfig.browser.json'
	}),
	build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { main: 'test/electron/browserHarnessMain.ts' },
		external: ['electron', 'electron/main'],
		format: 'esm',
		logLevel: 'info',
		outdir: outputDirectory,
		platform: 'node',
		sourcemap: false,
		target: nodeTarget,
		tsconfig: 'build/tsconfig.electron-main.json'
	})
]);

copyFileSync(repositoryPath('test/browser/rendererHarness.html'), `${outputDirectory}/index.html`);
copyFileSync(
	repositoryPath('test/browser/controlExplorerFrame.html'),
	`${outputDirectory}/controlExplorerFrame.html`
);
writeFileSync(
	`${outputDirectory}/package.json`,
	`${JSON.stringify(
		{
			name: 'proctor-browser-test-harness',
			private: true,
			type: 'module',
			main: 'main.js'
		},
		null,
		2
	)}\n`,
	'utf8'
);
