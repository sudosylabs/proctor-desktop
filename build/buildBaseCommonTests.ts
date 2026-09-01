import { globSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const outputDirectory = '.build/base-common-tests';

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });

await build({
	absWorkingDir: process.cwd(),
	bundle: true,
	entryNames: '[dir]/[name]',
	entryPoints: globSync('test/base/common/**/*.test.ts').sort(),
	format: 'esm',
	logLevel: 'info',
	outbase: 'test/base/common',
	outdir: outputDirectory,
	platform: 'node',
	sourcemap: false,
	tsconfig: 'build/tsconfig.base-common-test.json',
	target: 'node24'
});
