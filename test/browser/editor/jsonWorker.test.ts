import { exerciseSettingsProduction } from './settingsProduction.test.js';
import { exerciseSettingsWindowServices } from './settingsWindowServices.test.js';
import { exerciseTreeSitterAssets } from './treeSitterAssets.test.js';
import { exerciseTextMateAssets, exerciseTextMateDisposal } from './textMateAssets.test.js';
import { exerciseEditorWorker } from './editorWorker.test.js';
import {
	BrowserMessageReader,
	BrowserMessageWriter,
	createProtocolConnection,
	CancellationTokenSource,
	type CompletionList,
	type Diagnostic,
	type CodeAction
} from 'vscode-languageserver/browser';
import { PackagedJsonSchemas } from '../../../src/prctr/editor/common/languages/json/packagedJsonSchemas.js';

const runtimeErrors: string[] = [];
window.addEventListener('error', event => runtimeErrors.push(String(event.error ?? event.message)));
window.addEventListener('unhandledrejection', event => runtimeErrors.push(event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason)));

const schemaUri = 'prctr-schema://settings/worker-test';
const schemas = new PackagedJsonSchemas(
	new Map([
		[
			schemaUri,
			JSON.stringify({
				type: 'object',
				properties: { 'editor.fontSize': { type: 'number', minimum: 8, default: 14 } }
			})
		]
	])
);

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function exerciseWorker(iteration: number): Promise<void> {
	const worker = new Worker(new URL('./jsonWorker.js', window.location.href), { type: 'module' });
	const connection = createProtocolConnection(
		new BrowserMessageReader(worker),
		new BrowserMessageWriter(worker)
	);
	let deniedSchemas = 0;
	let releaseSchema: (() => void) | undefined;
	let schemaRequested: (() => void) | undefined;
	const slowSchemaRequested = new Promise<void>((resolve) => {
		schemaRequested = resolve;
	});
	connection.onRequest('workspace/diagnostic/refresh', () => null);
	connection.onRequest('vscode/content', (uri: unknown) => {
		if (uri === `${schemaUri}/slow`) {
			return new Promise<string>((resolve) => {
				releaseSchema = () => resolve(schemas.read(schemaUri));
				schemaRequested?.();
			});
		}
		try {
			return schemas.read(uri);
		} catch (error) {
			deniedSchemas++;
			throw error;
		}
	});
	connection.listen();
	// Send initialization and LSP work back-to-back to exercise the original startup queue.
	worker.postMessage({
		type: 'proctor-json-worker-initialize',
		messages: { 'Sort JSON': 'Trier JSON' }
	});
	try {
		await connection.sendRequest('initialize', {
			processId: null,
			rootUri: null,
			capabilities: {
				textDocument: {
					completion: { completionItem: { snippetSupport: true } },
					diagnostic: {}
				}
			},
			initializationOptions: { handledSchemaProtocols: [], provideFormatter: true }
		});
		await connection.sendNotification('initialized', {});
		const uri = `prctr-settings://principal-${iteration}/settings.json`;
		await connection.sendNotification('json/schemaAssociations', [
			{ uri: schemaUri, fileMatch: [uri] }
		]);
		await connection.sendNotification('textDocument/didOpen', {
			textDocument: { uri, languageId: 'jsonc', version: 1, text: '{\n  \n}' }
		});
		const completion = await connection.sendRequest<CompletionList>('textDocument/completion', {
			textDocument: { uri },
			position: { line: 1, character: 2 }
		});
		check(
			completion.items.some((item) => item.label === 'editor.fontSize'),
			'Worker lost queued schema/completion messages.'
		);
		await connection.sendNotification('textDocument/didChange', {
			textDocument: { uri, version: 2 },
			contentChanges: [
				{
					range: { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } },
					text: '"editor.fontSize": 2'
				}
			]
		});
		const diagnostics = await connection.sendRequest<Diagnostic[]>('json/validate', uri);
		check(
			diagnostics.length === 1,
			'Incremental worker mirror did not validate the edited value.'
		);
		const actions = await connection.sendRequest<CodeAction[]>('textDocument/codeAction', {
			textDocument: { uri },
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
			context: { diagnostics: [] }
		});
		check(
			actions[0]?.command?.title === 'Trier JSON',
			'Packaged worker localization was not applied.'
		);
		const cancellation = new CancellationTokenSource();
		await connection.sendNotification('json/schemaAssociations', [
			{ uri: `${schemaUri}/slow`, fileMatch: [uri] }
		]);
		const pending = connection.sendRequest(
			'textDocument/completion',
			{
				textDocument: { uri },
				position: { line: 1, character: 2 }
			},
			cancellation.token
		);
		await slowSchemaRequested;
		cancellation.cancel();
		// A later request crosses the same FIFO transport after cancellation.
		await connection.sendRequest('json/languageStatus', uri);
		releaseSchema?.();
		let cancelled = false;
		try {
			await pending;
		} catch (error) {
			cancelled =
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				error.code === -32800;
		} finally {
			cancellation.dispose();
		}
		check(cancelled, 'Cancelled completion returned a live result.');
		await connection.sendNotification('textDocument/didChange', {
			textDocument: { uri, version: 3 },
			contentChanges: [{ text: '{"$schema":"https://schemas.invalid/test.json"}' }]
		});
		await connection.sendRequest('json/validate', uri);
		check(deniedSchemas > 0, 'Unpackaged schema request was not rejected.');
		await connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
		const closed = await connection.sendRequest<Diagnostic[]>('json/validate', uri);
		check(closed.length === 0, 'Closed worker document remained active.');
		await connection.sendRequest('shutdown');
	} finally {
		connection.dispose();
		worker.terminate();
	}
}

void (async () => {
	try {
		for (let iteration = 0; iteration < 3; iteration++) await exerciseWorker(iteration);
		await exerciseEditorWorker();
		await exerciseTreeSitterAssets();
		await exerciseTextMateAssets();
		await exerciseTextMateDisposal();
		await exerciseSettingsWindowServices();
		await exerciseSettingsProduction();
		await new Promise<void>(resolve => setTimeout(resolve, 50));
		check(runtimeErrors.length === 0, `Unexpected runtime errors: ${runtimeErrors.join('; ')}`);
		document.body.dataset.result = JSON.stringify({
			passed: true,
			cycles: 3,
			hasNode: 'process' in globalThis || 'require' in globalThis
		});
	} catch (error) {
		document.body.dataset.result = JSON.stringify({ passed: false, error: String(error) });
	}
})();
