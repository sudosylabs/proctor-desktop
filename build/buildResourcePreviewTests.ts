import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { buildResourcePreviewAssets } from './buildResourcePreviewAssets.ts';
import { resetBuildOutput } from './lib/paths.ts';
import { resourcePreviewBrowserOptions } from './lib/resourcePreviewBrowser.ts';
const output = resetBuildOutput('resource-preview-tests');
await buildResourcePreviewAssets(`${output}/assets.json`);
await build({
	entryPoints: ['test/browser/resourcePreviewFixture.ts'],
	bundle: true,
	platform: 'browser',
	...resourcePreviewBrowserOptions,
	format: 'esm',
	outfile: `${output}/renderer.js`,
	target: 'es2024'
});
await build({
	entryPoints: ['test/electron/resourcePreviewMain.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	external: ['electron'],
	outfile: `${output}/main.js`,
	target: 'node24'
});
await writeFile(
	`${output}/package.json`,
	JSON.stringify({ name: 'proctor-resource-preview-test', type: 'module', main: 'main.js' })
);
await writeFile(
	`${output}/index.html`,
	'<!doctype html><html><body><script type="module" src="renderer.js"></script></body></html>'
);
