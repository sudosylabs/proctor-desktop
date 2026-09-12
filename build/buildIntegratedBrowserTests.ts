import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { resetBuildOutput } from './lib/paths.ts';

const output = resetBuildOutput('integrated-browser-tests');
await build({
	entryPoints: ['test/electron/integratedBrowserMain.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	external: ['electron'],
	outfile: `${output}/main.js`,
	target: 'node24'
});
await writeFile(
	`${output}/package.json`,
	JSON.stringify({
		name: 'proctor-integrated-browser-test',
		type: 'module',
		main: 'main.js'
	})
);
