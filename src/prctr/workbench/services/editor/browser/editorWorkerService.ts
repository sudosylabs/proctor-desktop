import { EditorWorkerService } from '../../../../editor/browser/services/editorWorkerService.js';
import { WebWorkerService } from '../../../../platform/webWorker/browser/webWorkerServiceImpl.js';
import type { WebWorkerDescriptor } from '../../../../platform/webWorker/browser/webWorkerDescriptor.js';
import { ThreadedBackgroundTokenizerFactory } from '../../textMate/browser/backgroundTokenization/threadedBackgroundTokenizerFactory.js';

/** Upstream worker lifecycle with a closed mapping to the packaged editor entrypoint. */
export class PackagedEditorWorkerService extends WebWorkerService {
	private readonly workerUrl: string;
	private readonly textMateWorkerUrl: string;
	constructor(document: Document) {
		super();
		this.workerUrl = new URL('./editorWorker.js', document.location.href).href;
		this.textMateWorkerUrl = new URL('./textMateWorker.js', document.location.href).href;
	}
	override getWorkerUrl(descriptor: WebWorkerDescriptor): string {
		if (descriptor === EditorWorkerService.workerDescriptor) return this.workerUrl;
		if (descriptor === ThreadedBackgroundTokenizerFactory.workerDescriptor) return this.textMateWorkerUrl;
		throw new Error('Worker descriptor is not packaged for this window.');
	}
}
