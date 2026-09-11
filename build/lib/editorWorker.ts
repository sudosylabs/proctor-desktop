import { packagedEditorDependencies } from './packagedEditorDependencies.ts';
import { build } from 'esbuild';
import { chromiumTarget, repositoryRoot } from './paths.ts';

/** Package the original editor worker and the exact admitted diff WASM artifact. */
export async function buildEditorWorker(outdir: string): Promise<void> {
	await build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: { editorWorker: 'src/prctr/editor/browser/worker/editorWebWorkerMain.ts' },
		format: 'esm',
		outdir,
		platform: 'browser',
		plugins: [packagedEditorDependencies()],
		target: chromiumTarget,
		tsconfig: 'build/tsconfig.editor-worker.json'
	});
}
