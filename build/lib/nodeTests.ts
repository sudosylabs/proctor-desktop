import { build } from 'esbuild';
import { nodeTarget, repositoryRoot, resetBuildOutput, selectFiles } from './paths.ts';
import { testSuites } from './testSuites.ts';

export async function buildNodeTests(
	suite: 'base' | 'platform' | 'editor' | 'security-utility',
	outputName: string,
	tsconfig: string
): Promise<void> {
	await build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryNames: '[dir]/[name]',
		entryPoints: selectFiles(testSuites[suite].patterns),
		format: 'esm',
		logLevel: 'info',
		outbase: 'test',
		outdir: resetBuildOutput(outputName),
		platform: 'node',
		sourcemap: false,
		target: nodeTarget,
		tsconfig
	});
}
