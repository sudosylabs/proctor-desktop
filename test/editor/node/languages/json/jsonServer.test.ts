import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
	createConnection,
	createProtocolConnection,
	StreamMessageReader,
	StreamMessageWriter,
	type CompletionList,
	type Diagnostic,
	type Hover,
	type InitializeResult,
	type TextEdit,
	type FoldingRange,
	type DocumentSymbol,
	type ColorInformation,
	type SelectionRange
} from 'vscode-languageserver/node';
import {
	startServer,
	type RuntimeEnvironment
} from '../../../../../src/prctr/editor/common/languages/json/jsonServer.js';

const uri = 'prctr-settings://test-principal/settings.json';
const schemaUri = 'prctr-schema://settings/user';
const schema = {
	type: 'object',
	additionalProperties: true,
	properties: {
		'editor.fontSize': {
			type: 'number',
			minimum: 8,
			maximum: 72,
			default: 14,
			description: 'Controls the editor font size.'
		},
		'workbench.colorCustomizations': {
			type: 'object',
			additionalProperties: { type: 'string', format: 'color-hex' }
		}
	}
};

async function createServer() {
	const input = new PassThrough();
	const output = new PassThrough();
	// Supply message transports: raw Node streams install a process-exit watchdog
	// intended for a standalone server process, not an in-process contract test.
	const server = createConnection(
		new StreamMessageReader(input),
		new StreamMessageWriter(output)
	);
	const client = createProtocolConnection(
		new StreamMessageReader(output),
		new StreamMessageWriter(input)
	);
	const schemaRequests: string[] = [];
	client.onRequest('workspace/diagnostic/refresh', () => null);
	client.onRequest('test/drain', () => null);
	client.onRequest('vscode/content', (requested: string) => {
		schemaRequests.push(requested);
		if (requested !== schemaUri) throw new Error('Schema is not packaged.');
		return JSON.stringify(schema);
	});
	const runtime: RuntimeEnvironment = {
		timer: {
			setImmediate(callback, ...arguments_) {
				const handle = setImmediate(callback, ...arguments_);
				return { dispose: () => clearImmediate(handle) };
			},
			setTimeout(callback, milliseconds, ...arguments_) {
				const handle = setTimeout(callback, milliseconds, ...arguments_);
				return { dispose: () => clearTimeout(handle) };
			}
		}
	};
	startServer(server, runtime);
	client.listen();
	const initialized: InitializeResult = await client.sendRequest('initialize', {
		processId: null,
		rootUri: null,
		capabilities: {
			textDocument: {
				completion: { completionItem: { snippetSupport: true } },
				documentSymbol: { hierarchicalDocumentSymbolSupport: true },
				diagnostic: {}
			}
		},
		initializationOptions: { handledSchemaProtocols: [], provideFormatter: true }
	});
	await client.sendNotification('initialized', {});
	await client.sendNotification('workspace/didChangeConfiguration', {
		settings: {
			json: { validate: { enable: true, comments: 'ignore', trailingCommas: 'ignore' } }
		}
	});
	await client.sendNotification('json/schemaAssociations', [
		{ uri: schemaUri, fileMatch: [uri] }
	]);
	let version = 0;
	return {
		client,
		initialized,
		schemaRequests,
		async open(text: string) {
			await client.sendNotification('textDocument/didOpen', {
				textDocument: { uri, languageId: 'jsonc', version: ++version, text }
			});
		},
		async change(text: string) {
			await client.sendNotification('textDocument/didChange', {
				textDocument: { uri, version: ++version },
				contentChanges: [{ text }]
			});
		},
		async diagnostics() {
			return client.sendRequest<Diagnostic[]>('json/validate', uri);
		},
		async dispose() {
			// Drain server-to-client refresh responses before disposing the connection.
			await server.sendRequest('test/drain');
			await client.sendRequest('shutdown');
			client.dispose();
			server.dispose();
			input.destroy();
			output.destroy();
		}
	};
}

void test('JSON server advertises the full packaged JSONC provider contract', async () => {
	const owner = await createServer();
	try {
		const capabilities = owner.initialized.capabilities;
		assert.deepEqual(capabilities.completionProvider?.triggerCharacters, ['"', ':']);
		assert.equal(capabilities.hoverProvider, true);
		assert.equal(capabilities.documentFormattingProvider, true);
		assert.equal(capabilities.documentRangeFormattingProvider, true);
		assert.equal(capabilities.foldingRangeProvider, true);
		assert.equal(capabilities.selectionRangeProvider, true);
		assert.equal(capabilities.documentSymbolProvider, true);
		assert.deepEqual(capabilities.colorProvider, {});
		assert.deepEqual(capabilities.documentLinkProvider, {});
		assert.ok(capabilities.codeActionProvider);
	} finally {
		await owner.dispose();
	}
});

void test('JSONC comments, unknown values, schema bounds and source changes retain real validation', async () => {
	const owner = await createServer();
	try {
		await owner.open('{\n // User comment\n "editor.fontSize": 14, "future.option": true,\n}');
		assert.deepEqual(await owner.diagnostics(), []);
		assert.deepEqual(owner.schemaRequests, [schemaUri]);
		await owner.change('{"editor.fontSize": 2}');
		assert.ok(
			(await owner.diagnostics()).some((diagnostic) =>
				JSON.stringify(diagnostic.message).includes('8')
			)
		);
		await owner.change('{"editor.fontSize": 18}');
		assert.deepEqual(await owner.diagnostics(), []);
		await owner.change('{"editor.fontSize": }');
		assert.ok((await owner.diagnostics()).length > 0);
	} finally {
		await owner.dispose();
	}
});

void test('JSON completion and hover use packaged registry schema descriptions and defaults', async () => {
	const owner = await createServer();
	try {
		await owner.open('{\n  \n}');
		const completion = await owner.client.sendRequest<CompletionList>(
			'textDocument/completion',
			{
				textDocument: { uri },
				position: { line: 1, character: 2 }
			}
		);
		const item = completion.items.find((item) => item.label === 'editor.fontSize');
		assert.ok(item);
		assert.match(JSON.stringify(item), /14/);
		await owner.change('{"editor.fontSize": 14}');
		const hover = await owner.client.sendRequest<Hover>('textDocument/hover', {
			textDocument: { uri },
			position: { line: 0, character: 4 }
		});
		assert.match(JSON.stringify(hover.contents), /Controls the editor font size/);
	} finally {
		await owner.dispose();
	}
});

void test('JSON formatting, symbols, folding, selection and color providers remain available', async () => {
	const owner = await createServer();
	try {
		await owner.open(
			'{\n"workbench.colorCustomizations": {\n"editor.background": "#123456"\n}\n}'
		);
		const textDocument = { uri };
		const formatting = await owner.client.sendRequest<TextEdit[]>('textDocument/formatting', {
			textDocument,
			options: { tabSize: 2, insertSpaces: true }
		});
		assert.ok(formatting.length > 0);
		const symbols = await owner.client.sendRequest<DocumentSymbol[]>(
			'textDocument/documentSymbol',
			{ textDocument }
		);
		assert.equal(symbols[0]?.name, 'workbench.colorCustomizations');
		assert.equal(symbols[0]?.children?.[0]?.name, 'editor.background');
		const folding = await owner.client.sendRequest<FoldingRange[]>(
			'textDocument/foldingRange',
			{ textDocument }
		);
		assert.ok(folding.length > 0);
		const selection = await owner.client.sendRequest<SelectionRange[]>(
			'textDocument/selectionRange',
			{
				textDocument,
				positions: [{ line: 2, character: 25 }]
			}
		);
		assert.ok(selection[0]?.parent);
		const colors = await owner.client.sendRequest<ColorInformation[]>(
			'textDocument/documentColor',
			{ textDocument }
		);
		assert.equal(colors.length, 1);
		assert.equal(colors[0]?.color.alpha, 1);
	} finally {
		await owner.dispose();
	}
});
