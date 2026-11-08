import { exerciseTreeSitterAssets } from './treeSitterAssets.test.js';
import { exerciseTextMateAssets, exerciseTextMateDisposal } from './textMateAssets.test.js';
import { exerciseEditorWorker } from './editorWorker.test.js';
import { exerciseHoverBindingLifetime } from './hoverLifetime.test.js';
import { exerciseRenderedLinesDom } from './renderedLinesDom.test.js';

const runtimeErrors: string[] = [];
window.addEventListener('error', (event) =>
	runtimeErrors.push(String(event.error ?? event.message))
);
window.addEventListener('unhandledrejection', (event) =>
	runtimeErrors.push(
		event.reason instanceof Error
			? (event.reason.stack ?? event.reason.message)
			: String(event.reason)
	)
);

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

void (async () => {
	try {
		await exerciseEditorWorker();
		exerciseHoverBindingLifetime();
		await exerciseRenderedLinesDom();
		await exerciseTreeSitterAssets();
		await exerciseTextMateAssets();
		await exerciseTextMateDisposal();
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		check(runtimeErrors.length === 0, `Unexpected runtime errors: ${runtimeErrors.join('; ')}`);
		document.body.dataset.result = JSON.stringify({
			passed: true,
			hasNode: 'process' in globalThis || 'require' in globalThis
		});
	} catch (error) {
		document.body.dataset.result = JSON.stringify({ passed: false, error: String(error) });
	}
})();
