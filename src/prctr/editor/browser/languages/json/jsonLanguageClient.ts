import {
	BrowserMessageReader,
	BrowserMessageWriter,
	createProtocolConnection,
	NullLogger,
	type ProtocolConnection,
	type CompletionList,
	type CompletionParams,
	type Hover,
	type HoverParams,
	type DocumentSymbol,
	type TextEdit,
	type DocumentFormattingParams,
	type DocumentRangeFormattingParams,
	type ColorInformation,
	type ColorPresentation,
	type ColorPresentationParams,
	type SelectionRange,
	type SelectionRangeParams,
	type FoldingRange,
	type DocumentLink,
	type Diagnostic,
	type CodeAction,
	type CodeActionParams
} from 'vscode-languageserver/browser';
import type { SortOptions } from 'vscode-json-languageservice';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { raceCancellationError } from '../../../../base/common/async.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import type { ITextModel } from '../../../common/model.js';
import type { IModelContentChangedEvent } from '../../../common/textModelEvents.js';
import type { PackagedJsonSchemas } from '../../../common/languages/json/packagedJsonSchemas.js';
import { findJsonDepthOverflow } from '../../../../base/common/jsonBounds.js';
import {
	isJsonResponseWithinLimits,
	JSON_RESPONSE_LIMITS
} from '../../../common/languages/json/jsonResponseLimits.js';

type WithoutDocument<T> = Omit<T, 'textDocument'>;
interface JsonRequests {
	'textDocument/completion': [WithoutDocument<CompletionParams>, CompletionList | null];
	'textDocument/hover': [WithoutDocument<HoverParams>, Hover | null];
	'textDocument/documentSymbol': [Record<string, never>, DocumentSymbol[]];
	'textDocument/formatting': [WithoutDocument<DocumentFormattingParams>, TextEdit[]];
	'textDocument/rangeFormatting': [WithoutDocument<DocumentRangeFormattingParams>, TextEdit[]];
	'textDocument/documentColor': [Record<string, never>, ColorInformation[]];
	'textDocument/colorPresentation': [
		WithoutDocument<ColorPresentationParams>,
		ColorPresentation[]
	];
	'textDocument/selectionRange': [WithoutDocument<SelectionRangeParams>, SelectionRange[]];
	'textDocument/foldingRange': [Record<string, never>, FoldingRange[]];
	'textDocument/documentLink': [Record<string, never>, DocumentLink[]];
	'textDocument/codeAction': [WithoutDocument<CodeActionParams>, CodeAction[]];
	'json/validate': [Record<string, never>, Diagnostic[]];
	'json/sort': [{ options: SortOptions }, TextEdit[]];
}

export interface JsonWorkerFactory {
	create(): Worker;
}
export interface JsonDocumentLimits {
	readonly maxBytes: number;
	readonly maxDepth: number;
}
export class PackagedJsonWorkerFactory implements JsonWorkerFactory {
	private readonly url: URL;
	constructor(document: Document) {
		this.url = new URL('./jsonWorker.js', document.location.href);
	}
	create(): Worker {
		return new Worker(this.url, { type: 'module', name: 'Settings JSON' });
	}
}

interface Connection {
	readonly protocol: ProtocolConnection;
	readonly lifetime: DisposableStore;
	ready: Promise<void>;
	opened: boolean;
}

/** One versioned model and a closed JSON protocol; this service has no save or filesystem capability. */
export class JsonLanguageClient extends Disposable {
	private current: Connection | undefined;
	private disposed = false;
	private readonly failed = this._register(new Emitter<void>());
	readonly onDidFail = this.failed.event;

	constructor(
		readonly model: ITextModel,
		private readonly schemas: PackagedJsonSchemas,
		private readonly schemaUri: string,
		private readonly workers: JsonWorkerFactory,
		private readonly limits: JsonDocumentLimits,
		private readonly messages?: Readonly<Record<string, string>>
	) {
		super();
		schemas.read(schemaUri);
		this._register(model.onDidChangeContent((event) => this.changed(event)));
		this._register(model.onWillDispose(() => this.dispose()));
	}

	async request<K extends keyof JsonRequests>(
		method: K,
		params: JsonRequests[K][0],
		token = CancellationToken.None
	): Promise<JsonRequests[K][1]> {
		this.assertLive(token);
		const version = this.model.getVersionId();
		const connection = this.current ?? this.connect();
		await raceCancellationError(connection.ready, token);
		this.assertCurrent(connection, version, token);
		const uri = this.model.uri.toString();
		const payload =
			method === 'json/validate'
				? uri
				: method === 'json/sort'
					? { ...params, uri }
					: { ...params, textDocument: { uri } };
		try {
			const result = await connection.protocol.sendRequest<JsonRequests[K][1]>(
				method,
				payload,
				token
			);
			this.assertCurrent(connection, version, token);
			if (!isJsonResponseWithinLimits(method, result))
				throw new Error('Settings JSON language result exceeds the packaged limit.');
			return result;
		} catch (error) {
			if (
				token.isCancellationRequested ||
				this.current !== connection ||
				this.model.isDisposed() ||
				this.model.getVersionId() !== version ||
				(typeof error === 'object' &&
					error !== null &&
					'code' in error &&
					error.code === -32800)
			)
				throw new CancellationError();
			this.failed.fire();
			throw new Error('Settings JSON language request failed.');
		}
	}

	private connect(): Connection {
		const worker = this.workers.create();
		const lifetime = new DisposableStore();
		const protocol = createProtocolConnection(
			new BrowserMessageReader(worker),
			new BrowserMessageWriter(worker),
			NullLogger
		);
		const connection: Connection = {
			protocol,
			lifetime,
			ready: Promise.resolve(),
			opened: false
		};
		this.current = connection;
		lifetime.add(toDisposable(() => worker.terminate()));
		lifetime.add(protocol);
		const fail = (): void => this.invalidate(connection);
		worker.addEventListener('error', fail);
		worker.addEventListener('messageerror', fail);
		lifetime.add(
			toDisposable(() => {
				worker.removeEventListener('error', fail);
				worker.removeEventListener('messageerror', fail);
			})
		);
		lifetime.add(protocol.onError(fail));
		lifetime.add(protocol.onClose(fail));
		lifetime.add(
			protocol.onRequest('vscode/content', (uri: unknown) => this.schemas.read(uri))
		);
		lifetime.add(protocol.onRequest('workspace/diagnostic/refresh', () => null));
		// Worker diagnostics are returned through requests. Source-bearing log notifications never leave this boundary.
		lifetime.add(protocol.onNotification('window/logMessage', () => {}));
		lifetime.add(protocol.onNotification('window/showMessage', fail));
		protocol.listen();
		worker.postMessage({
			type: 'proctor-json-worker-initialize',
			...(this.messages ? { messages: this.messages } : {})
		});
		connection.ready = (async () => {
			const timeout = setTimeout(fail, 10000);
			try {
				await protocol.sendRequest('initialize', {
					processId: null,
					rootUri: null,
					capabilities: {
						textDocument: {
							completion: {
								completionItem: {
									snippetSupport: true,
									insertReplaceSupport: true,
									documentationFormat: ['markdown', 'plaintext']
								}
							},
							hover: { contentFormat: ['markdown', 'plaintext'] },
							documentSymbol: { hierarchicalDocumentSymbolSupport: true },
							diagnostic: {},
							foldingRange: { rangeLimit: JSON_RESPONSE_LIMITS.items + 1 }
						}
					},
					initializationOptions: { handledSchemaProtocols: [], provideFormatter: true }
				});
				if (this.current !== connection || this.disposed) throw new CancellationError();
				await protocol.sendNotification('initialized', {});
				// Ask for one extra result so an over-budget response can be rejected
				// visibly instead of silently accepting the server's truncated result.
				await protocol.sendNotification('workspace/didChangeConfiguration', {
					settings: {
						json: {
							validate: { enable: true },
							format: { enable: true },
							resultLimit: JSON_RESPONSE_LIMITS.items + 1,
							jsonFoldingLimit: JSON_RESPONSE_LIMITS.items + 1,
							jsoncFoldingLimit: JSON_RESPONSE_LIMITS.items + 1,
							jsonColorDecoratorLimit: JSON_RESPONSE_LIMITS.items + 1,
							jsoncColorDecoratorLimit: JSON_RESPONSE_LIMITS.items + 1
						}
					}
				});
				await protocol.sendNotification('json/schemaAssociations', [
					{ uri: this.schemaUri, fileMatch: [this.model.uri.toString()] }
				]);
				const textDocument = {
					uri: this.model.uri.toString(),
					languageId: 'jsonc',
					version: this.model.getVersionId(),
					text: this.model.getValue()
				};
				connection.opened = true;
				await protocol.sendNotification('textDocument/didOpen', { textDocument });
			} catch {
				this.invalidate(connection);
				throw new Error('Settings JSON language service could not start.');
			} finally {
				clearTimeout(timeout);
			}
		})();
		return connection;
	}

	private changed(event: IModelContentChangedEvent): void {
		const connection = this.current;
		if (!this.withinLimits()) {
			if (connection) this.invalidate(connection, false);
			return;
		}
		if (!connection?.opened) return;
		const contentChanges =
			event.isFlush || event.isEolChange
				? [{ text: this.model.getValue() }]
				: event.changes.map((change) => ({
						text: change.text,
						range: {
							start: {
								line: change.range.startLineNumber - 1,
								character: change.range.startColumn - 1
							},
							end: {
								line: change.range.endLineNumber - 1,
								character: change.range.endColumn - 1
							}
						}
					}));
		void connection.protocol
			.sendNotification('textDocument/didChange', {
				textDocument: { uri: this.model.uri.toString(), version: event.versionId },
				contentChanges
			})
			.catch(() => this.invalidate(connection));
	}

	private invalidate(connection: Connection, reportFailure = true): void {
		if (this.current !== connection) return;
		this.current = undefined;
		connection.lifetime.dispose();
		if (!this.disposed && reportFailure) this.failed.fire();
	}
	private assertLive(token: CancellationToken): void {
		if (this.disposed || this.model.isDisposed() || token.isCancellationRequested)
			throw new CancellationError();
		if (!this.withinLimits()) throw new CancellationError();
	}
	private withinLimits(): boolean {
		if (this.model.getValueLength() > this.limits.maxBytes) return false;
		const source = this.model.getValue();
		return (
			new TextEncoder().encode(source).byteLength <= this.limits.maxBytes &&
			findJsonDepthOverflow(source, this.limits.maxDepth) === undefined
		);
	}
	private assertCurrent(connection: Connection, version: number, token: CancellationToken): void {
		this.assertLive(token);
		if (this.current !== connection || this.model.getVersionId() !== version)
			throw new CancellationError();
	}
	override dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.current) this.invalidate(this.current);
		super.dispose();
	}
}
