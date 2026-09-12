import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { sanitizeHtml } from '../../../../base/browser/domSanitize.js';
import type {
	PreviewDocumentLease,
	PreviewHost,
	PreviewResourceAccess,
	PreviewState,
	PreviewTextDocument,
	PreviewTextSnapshot
} from '../common/resourcePreview.js';
import { MarkdownItEngine } from './markdown/src/markdownEngine.js';
import { githubSlugifier } from './markdown/src/slugify.js';
import { previewImageData } from './imageData.js';
import type { PreviewImageValidator } from './imageMetadataService.js';
import { defaultMarkdownConfiguration, type MarkdownEngineConfiguration } from './markdownTypes.js';

/** Version-fenced source/preview coordination. The editor retains all working-copy ownership. */
export class MarkdownPreviewSession extends Disposable {
	private readonly changed = this._register(new Emitter<PreviewState>());
	readonly onDidChangeState = this.changed.event;
	private readonly binding = this._register(new DisposableStore());
	private readonly engine: MarkdownItEngine;
	private document: PreviewTextDocument | undefined;
	private snapshot: PreviewTextSnapshot | undefined;
	private initialized = false;
	private generation = 0;
	private request: CancellationTokenSource | undefined;
	private assets: { lease: PreviewDocumentLease; url: string }[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private ended = false;
	private locked = false;

	constructor(
		private readonly host: PreviewHost,
		private readonly access: PreviewResourceAccess,
		private readonly images: PreviewImageValidator,
		configuration: () => MarkdownEngineConfiguration = () => defaultMarkdownConfiguration
	) {
		super();
		this._register(images);
		this.engine = new MarkdownItEngine(configuration, githubSlugifier);
		if (access.onDidRevoke) {
			this._register(access.onDidRevoke(() => this.dispose()));
		}
		this._register(host.onDidReceiveMessage((message) => this.receive(message)));
	}

	setLocked(locked: boolean): void {
		this.locked = locked;
	}
	get isLocked(): boolean {
		return this.locked;
	}
	/** Explicit binding works for locked previews too; following an active editor does not. */
	bind(document: PreviewTextDocument): void {
		if (this.ended) {
			throw new Error('Preview disposed');
		}
		this.binding.clear();
		if (this.snapshot?.resource !== document.getSnapshot().resource) {
			this.host.clear();
			this.initialized = false;
			this.releaseAssets();
		}
		this.document = document;
		this.binding.add(document.onDidChange((snapshot) => this.update(snapshot)));
		this.binding.add(document.onDidDispose(() => this.dispose()));
		this.update(document.getSnapshot(), true);
	}
	follow(document: PreviewTextDocument): void {
		if (!this.locked) {
			this.bind(document);
		}
	}
	refresh(): void {
		if (this.document) {
			this.engine.cleanCache();
			this.update(this.document.getSnapshot(), true);
		}
	}
	revealSourceLine(line: number, selection = false): void {
		if (Number.isFinite(line) && line >= 0 && this.snapshot) {
			this.host.postMessage({
				type: selection ? 'onDidChangeTextEditorSelection' : 'updateView',
				source: this.snapshot.resource,
				line
			});
		}
	}

	private update(snapshot: PreviewTextSnapshot, immediate = false): void {
		if (this.ended) {
			return;
		}
		++this.generation;
		this.request?.dispose(true);
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
		}
		const generation = this.generation;
		this.snapshot = snapshot;
		this.timer = setTimeout(
			() => {
				this.timer = undefined;
				void this.render(snapshot, generation);
			},
			immediate ? 0 : 50
		);
	}

	private async render(snapshot: PreviewTextSnapshot, generation: number): Promise<void> {
		const request = new CancellationTokenSource();
		this.request = request;
		const assets: { lease: PreviewDocumentLease; url: string }[] = [];
		try {
			this.changed.fire({ kind: 'loading' });
			if (snapshot.text.length > 10 * 1024 * 1024) {
				throw new Error('Document too large');
			}
			const input = {
				uri: URI.parse(snapshot.resource),
				version: snapshot.version,
				getText: () => snapshot.text
			};
			const first = await this.engine.render(input);
			const urls = new Map<string, string>();
			if (first.containingImages.size > 128) {
				throw new Error('Too many images');
			}
			let totalBytes = 0;
			for (const reference of first.containingImages) {
				if (request.token.isCancellationRequested) {
					return;
				}
				if (/^(?:[\w+.-]+:|\/\/)/.test(reference)) {
					continue;
				}
				try {
					const lease = await this.access.readRelative(
						snapshot.resource,
						reference,
						request.token
					);
					if (request.token.isCancellationRequested) {
						lease.dispose();
						return;
					}
					if (
						!lease.mediaType.startsWith('image/') ||
						lease.bytes.byteLength > 20 * 1024 * 1024
					) {
						lease.dispose();
						continue;
					}
					try {
						await this.images.validate(lease.bytes, lease.mediaType, request.token);
						if (
							this.ended ||
							request.token.isCancellationRequested ||
							generation !== this.generation
						) {
							lease.dispose();
							return;
						}
					} catch {
						lease.dispose();
						continue;
					}
					totalBytes += lease.bytes.byteLength;
					if (totalBytes > 64 * 1024 * 1024) {
						lease.dispose();
						break;
					}
					const url = previewImageData(lease.bytes, lease.mediaType);
					assets.push({ lease, url });
					urls.set(reference, url);
				} catch {
					/* An unavailable relative image is shown as unavailable without networking. */
				}
			}
			const rendered = await this.engine.render(input, {
				resolve: (_source, reference) => urls.get(reference)
			});
			if (
				this.ended ||
				generation !== this.generation ||
				request.token.isCancellationRequested
			) {
				return;
			}
			const html = sanitizeHtml(rendered.html, {
				allowedAttributes: {
					augment: [
						'data-line',
						'data-href',
						'data-src',
						'dir',
						'id',
						{
							attributeName: 'src',
							shouldKeep: (_node, data) => [...urls.values()].includes(data.attrValue)
						}
					]
				},
				allowedLinkProtocols: { override: ['http', 'https'] },
				allowRelativeLinkPaths: true,
				allowedMediaProtocols: { override: ['data'] },
				allowRelativeMediaPaths: false
			}).toString();
			const content = `<div class="markdown-body">${html}</div>`;
			if (!this.initialized) {
				this.host.setDocument({
					kind: 'markdown',
					title: snapshot.resource,
					content,
					settings: {
						source: snapshot.resource,
						scrollPreviewWithEditor: true,
						scrollEditorWithPreview: true,
						disableSecurityWarnings: true,
						doubleClickToSwitchToEditor: true,
						webviewResourceRoot: ''
					}
				});
				this.initialized = true;
			} else {
				this.host.postMessage({
					type: 'updateContent',
					source: snapshot.resource,
					content
				});
			}
			this.releaseAssets();
			this.assets = assets.splice(0);
			this.changed.fire({ kind: 'ready' });
		} catch {
			if (!this.ended && generation === this.generation) {
				this.changed.fire({ kind: 'error', reason: 'invalid' });
			}
		} finally {
			for (const { lease, url } of assets) {
				URL.revokeObjectURL(url);
				lease.dispose();
			}
			request.dispose();
			if (this.request === request) {
				this.request = undefined;
			}
		}
	}

	private receive(message: unknown): void {
		if (this.ended || !message || typeof message !== 'object') {
			return;
		}
		const data = message as Record<string, unknown>;
		if (data['source'] !== this.snapshot?.resource) {
			return;
		}
		if (
			(data['type'] === 'revealLine' || data['type'] === 'didClick') &&
			typeof data['line'] === 'number' &&
			Number.isFinite(data['line']) &&
			data['line'] >= 0
		) {
			this.document?.revealLine(data['line'], data['type'] === 'didClick');
		} else if (
			data['type'] === 'openLink' &&
			typeof data['href'] === 'string' &&
			data['href'].length <= 8192 &&
			!/^(?:file|command|javascript|data|vscode|vbscript):/i.test(data['href'])
		) {
			void this.access
				.openLink(this.snapshot!.resource, data['href'])
				.catch(() => this.changed.fire({ kind: 'error', reason: 'unavailable' }));
		}
	}
	private releaseAssets(): void {
		for (const { lease, url } of this.assets) {
			URL.revokeObjectURL(url);
			lease.dispose();
		}
		this.assets = [];
	}
	override dispose(): void {
		if (this.ended) {
			return;
		}
		this.ended = true;
		++this.generation;
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
		}
		this.request?.dispose(true);
		this.releaseAssets();
		this.engine.cleanCache();
		this.host.dispose();
		this.changed.fire({ kind: 'disposed' });
		super.dispose();
	}
}
