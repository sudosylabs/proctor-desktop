import { build } from 'esbuild';
import { packagedEditorDependencies } from './packagedEditorDependencies.ts';
import { chromiumTarget, repositoryRoot } from './paths.ts';

export async function buildTextMateWorker(outdir: string): Promise<void> {
	await build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { textMateWorker: 'src/prctr/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.ts' },
		format: 'esm', outdir, platform: 'browser', plugins: [packagedEditorDependencies()],
		target: chromiumTarget, tsconfig: 'build/tsconfig.editor-worker.json'
	});
}
