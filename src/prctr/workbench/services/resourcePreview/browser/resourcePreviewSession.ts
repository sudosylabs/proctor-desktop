import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	PreviewDocumentLease,
	PreviewDocumentInfo,
	PreviewHost,
	PreviewResourceAccess,
	PreviewState
} from '../common/resourcePreview.js';
import { previewImageData } from './imageData.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import type { PreviewImageValidator } from './imageMetadataService.js';

/** Reusable read-only binary/text document session; owns the supplied lease. */
export class ResourcePreviewSession extends Disposable {
	private readonly changed = this._register(new Emitter<PreviewState>());
	readonly onDidChangeState = this.changed.event;
	private readonly information = this._register(new Emitter<PreviewDocumentInfo>());
	readonly onDidChangeDocumentInfo = this.information.event;
	private lease: PreviewDocumentLease | undefined;
	private url: string | undefined;
	private ended = false;
	private generation = 0;
	private validation: CancellationTokenSource | undefined;
	constructor(
		private readonly host: PreviewHost,
		access: PreviewResourceAccess,
		private readonly images: PreviewImageValidator
	) {
		super();
		this._register(images);
		if (access.onDidRevoke) {
			this._register(access.onDidRevoke(() => this.dispose()));
		}
		this._register(
			host.onDidReceiveMessage((message) => {
				if (this.ended || !message || typeof message !== 'object') {
					return;
				}
				const data = message as Record<string, unknown>;
				this.receiveInformation(data);
				if (data['type'] === 'size' || data['type'] === 'ready') {
					this.changed.fire({ kind: 'ready' });
				}
				if (data['type'] === 'error') {
					this.changed.fire({ kind: 'error', reason: 'invalid' });
				}
				if (
					data['type'] === 'openLink' &&
					this.lease &&
					typeof data['href'] === 'string' &&
					/^https?:\/\//i.test(data['href']) &&
					data['href'].length <= 8192
				) {
					void access
						.openLink(this.lease.resource, data['href'])
						.catch(() => this.changed.fire({ kind: 'error', reason: 'unavailable' }));
				}
			})
		);
	}
	private receiveInformation(data: Record<string, unknown>): void {
		const integer = (value: unknown, maximum: number): value is number =>
			typeof value === 'number' &&
			Number.isSafeInteger(value) &&
			value >= 0 &&
			value <= maximum;
		if (data['type'] === 'size' && typeof data['value'] === 'string') {
			const match = /^(\d{1,5})x(\d{1,5})$/.exec(data['value']);
			if (match) {
				this.information.fire({
					kind: 'imageSize',
					width: Number(match[1]),
					height: Number(match[2])
				});
			}
		} else if (
			data['type'] === 'zoom' &&
			(data['value'] === 'fit' ||
				(typeof data['value'] === 'number' && data['value'] >= 0.1 && data['value'] <= 20))
		) {
			this.information.fire({ kind: 'imageScale', scale: data['value'] });
		} else if (data['type'] === 'pageCount' && integer(data['count'], 2000)) {
			this.information.fire({ kind: 'pageCount', count: data['count'] });
		} else if (data['type'] === 'page' && integer(data['page'], 2000)) {
			this.information.fire({ kind: 'page', page: data['page'] });
		} else if (
			data['type'] === 'findMatches' &&
			data['matches'] &&
			typeof data['matches'] === 'object'
		) {
			const matches = data['matches'] as Record<string, unknown>;
			if (integer(matches['current'], 1000000) && integer(matches['total'], 1000000)) {
				this.information.fire({
					kind: 'findMatches',
					current: matches['current'],
					total: matches['total']
				});
			}
		}
	}
	async open(lease: PreviewDocumentLease, title: string): Promise<void> {
		if (this.ended) {
			lease.dispose();
			throw new Error('Preview disposed');
		}
		this.release();
		this.host.clear();
		this.lease = lease;
		const generation = ++this.generation;
		const validation = (this.validation = new CancellationTokenSource());
		this.changed.fire({ kind: 'loading' });
		try {
			if (lease.mediaType.startsWith('image/')) {
				await this.images.validate(lease.bytes, lease.mediaType, validation.token);
				if (
					this.ended ||
					generation !== this.generation ||
					validation.token.isCancellationRequested
				)
					return;
				this.url = previewImageData(lease.bytes, lease.mediaType);
				this.host.setDocument({
					kind: 'image',
					title,
					settings: { src: this.url, isGitLfs: false },
					content: title
				});
				this.host.postMessage({ type: 'setActive', value: true });
			} else if (lease.mediaType === 'application/pdf') {
				if (
					lease.bytes.length < 5 ||
					lease.bytes.length > 128 * 1024 * 1024 ||
					new TextDecoder().decode(lease.bytes.subarray(0, 5)) !== '%PDF-'
				) {
					throw new Error('Invalid PDF');
				}
				this.host.setDocument({ kind: 'pdf', title, settings: {}, content: '' });
				this.host.postMessage({
					type: 'openPdf',
					bytes: new Uint8Array(lease.bytes),
					generation: this.generation
				});
			} else if (['text/plain', 'text/csv', 'application/json'].includes(lease.mediaType)) {
				if (lease.bytes.length > 10 * 1024 * 1024) {
					throw new Error('Text too large');
				}
				const content = new TextDecoder('utf-8', { fatal: true }).decode(lease.bytes);
				this.host.setDocument({ kind: 'text', title, settings: {}, content });
				this.changed.fire({ kind: 'ready' });
			} else {
				this.release();
				this.changed.fire({ kind: 'error', reason: 'unsupported' });
			}
		} catch {
			if (this.ended || generation !== this.generation) return;
			this.release();
			this.changed.fire({ kind: 'error', reason: 'invalid' });
		}
	}
	zoom(direction: 'in' | 'out' | 'fit'): void {
		this.host.postMessage(
			direction === 'fit'
				? { type: 'setScale', scale: 'fit' }
				: { type: direction === 'in' ? 'zoomIn' : 'zoomOut' }
		);
	}
	find(query: string, previous = false): void {
		if (query.length <= 1024) {
			this.host.postMessage({ type: 'find', query, previous });
		}
	}
	goToPage(page: number): void {
		if (Number.isSafeInteger(page) && page > 0) {
			this.host.postMessage({ type: 'page', page });
		}
	}
	private release(): void {
		this.validation?.dispose(true);
		this.validation = undefined;
		if (this.url) {
			URL.revokeObjectURL(this.url);
			this.url = undefined;
		}
		this.lease?.dispose();
		this.lease = undefined;
	}
	override dispose(): void {
		if (!this.ended) {
			this.ended = true;
			this.release();
			this.host.dispose();
			this.changed.fire({ kind: 'disposed' });
			super.dispose();
		}
	}
}
