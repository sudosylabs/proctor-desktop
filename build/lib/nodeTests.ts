import { nodeEsmRuntime } from './nodeEsmRuntime.ts';
import { build } from 'esbuild';
import { nodeTarget, repositoryRoot, resetBuildOutput, selectFiles } from './paths.ts';
import { testSuites } from './testSuites.ts';

export async function buildNodeTests(
	suite: 'base' | 'platform' | 'editor' | 'native-agent',
	outputName: string,
	tsconfig: string,
	external: string[] = []
): Promise<void> {
	await build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		external,
		entryNames: '[dir]/[name]',
		entryPoints: selectFiles(testSuites[suite].patterns),
		format: 'esm',
		...nodeEsmRuntime,
		logLevel: 'info',
		outbase: 'test',
		outdir: resetBuildOutput(outputName),
		platform: 'node',
		loader: { '.css': 'text' },
		sourcemap: false,
		target: nodeTarget,
		tsconfig
	});
}
