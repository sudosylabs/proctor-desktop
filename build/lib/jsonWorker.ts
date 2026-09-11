import { build } from 'esbuild';
import { chromiumTarget, repositoryRoot } from './paths.ts';

/** Shared by package assembly and the sandboxed worker integration harness. */
export async function buildJsonWorker(outdir: string): Promise<void> {
	await build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: {
			jsonWorker: 'src/prctr/editor/browser/languages/json/worker/jsonServerWorkerMain.ts'
		},
		format: 'esm',
		outdir,
		platform: 'browser',
		target: chromiumTarget,
		tsconfig: 'build/tsconfig.editor-worker.json',
		logLevel: 'info'
	});
}
