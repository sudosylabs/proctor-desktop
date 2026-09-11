import { PackagedEditorWorkerService } from '../../../src/prctr/workbench/services/editor/browser/editorWorkerService.js';
import { EditorWorkerService } from '../../../src/prctr/editor/browser/services/editorWorkerService.js';
import type { EditorWorker } from '../../../src/prctr/editor/common/services/editorWebWorker.js';
import { StringEdit } from '../../../src/prctr/editor/common/core/edits/stringEdit.js';
import { WebWorkerDescriptor } from '../../../src/prctr/platform/webWorker/browser/webWorkerDescriptor.js';

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

export async function exerciseEditorWorker(): Promise<void> {
	const service = new PackagedEditorWorkerService(document);
	let rejected = false;
	try {
		service.getWorkerUrl(new WebWorkerDescriptor({ label: 'editorWorkerService' }));
	} catch {
		rejected = true;
	}
	check(rejected, 'A forged worker descriptor was accepted.');
	for (let iteration = 0; iteration < 3; iteration++) {
		const worker = service.createWorkerClient<EditorWorker>(
			EditorWorkerService.workerDescriptor
		);
		try {
			check((await worker.proxy.$ping()) === 'pong', 'Editor worker startup failed.');
			const uri = `prctr-settings://account-${iteration}/settings.json`;
			await worker.proxy.$acceptNewModel({
				url: uri,
				versionId: 1,
				EOL: '\n',
				lines: ['alpha beta', 'alpha gamma']
			});
			const options = { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 1 };
			const words = await worker.proxy.$computeWordRanges(uri, options, '[a-z]+', 'g');
			check(words['alpha']?.length === 2, 'Editor worker did not mirror the document.');
			await worker.proxy.$acceptModelChanged(uri, {
				versionId: 2,
				eol: '\n',
				isUndoing: false,
				isRedoing: false,
				changes: [
					{
						range: {
							startLineNumber: 1,
							startColumn: 1,
							endLineNumber: 1,
							endColumn: 6
						},
						rangeOffset: 0,
						rangeLength: 5,
						text: 'delta'
					}
				]
			});
			const updated = await worker.proxy.$computeWordRanges(uri, options, '[a-z]+', 'g');
			check(
				updated['delta']?.length === 1 && updated['alpha']?.length === 1,
				'Incremental worker edits were lost.'
			);
			for (const algorithm of [
				'legacy',
				'advanced',
				'advanced-external',
				'advanced-wasm'
			] as const) {
				const edits = await worker.proxy.$computeStringDiff(
					'alpha\nbeta',
					'alpha\ngamma',
					{ maxComputationTimeMs: 1000 },
					algorithm
				);
				check(
					StringEdit.fromJson(edits).apply('alpha\nbeta') === 'alpha\ngamma',
					`${algorithm} worker diff is incorrect.`
				);
			}
			await worker.proxy.$acceptRemovedModel(uri);
			check(
				(await worker.proxy.$computeLinks(uri)) === null,
				'Closed worker model survived removal.'
			);
		} finally {
			worker.dispose();
		}
	}
}
