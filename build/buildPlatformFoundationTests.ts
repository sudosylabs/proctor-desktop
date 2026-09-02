import { globSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const outputDirectory = '.build/platform-foundation-tests';

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });

await build({
	absWorkingDir: process.cwd(),
	bundle: true,
	entryNames: '[dir]/[name]',
	entryPoints: [
		...globSync('test/platform/**/*.test.ts'),
		...globSync('test/workbench/services/commands/common/**/*.test.ts'),
		...globSync('test/workbench/services/actions/common/**/*.test.ts'),
		...globSync('test/workbench/services/keybinding/common/**/*.test.ts')
		,...globSync('test/workbench/common/**/*.test.ts')
		,...globSync('test/workbench/contrib/attemptWorkspace/common/**/*.test.ts')
		,...globSync('test/workbench/contrib/integratedBrowser/common/**/*.test.ts')
		,...globSync('test/workbench/contrib/terminal/common/**/*.test.ts')
		,...globSync('test/workbench/services/examSecurity/**/*.test.ts')
	].sort(),
	format: 'esm',
	logLevel: 'info',
	outbase: 'test',
	outdir: outputDirectory,
	platform: 'node',
	sourcemap: false,
	tsconfig: 'build/tsconfig.platform-foundation-test.json',
	target: 'node24'
});
