import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { runNode } from './lib/process.ts';
import { nodeTarget, repositoryRoot, resetBuildOutput } from './lib/paths.ts';

runNode(['build/buildDesktopDevelopment.ts']);
const outdir = resetBuildOutput('desktop-identity-tests');
await build({
	absWorkingDir: repositoryRoot,
	bundle: true,
	entryPoints: { main: 'test/electron/desktopIdentityMain.ts' },
	external: ['electron', 'electron/main'],
	format: 'esm',
	outdir,
	platform: 'node',
	target: nodeTarget,
	tsconfig: 'build/tsconfig.electron-test.json'
});
writeFileSync(
	`${outdir}/package.json`,
	JSON.stringify({
		name: 'proctor-desktop-identity-tests',
		private: true,
		type: 'module',
		main: 'main.js'
	}) + '\n'
);
