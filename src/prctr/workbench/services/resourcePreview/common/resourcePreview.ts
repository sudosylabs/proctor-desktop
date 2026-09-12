import type { Event } from '../../../../base/common/event.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import type { CancellationToken } from '../../../../base/common/cancellation.js';

/** A caller-authorized snapshot; the preview never acquires server credentials. */
export interface PreviewDocumentLease extends IDisposable {
	readonly resource: string;
	readonly revision: string;
	readonly mediaType: string;
	readonly bytes: Uint8Array;
}

/** Resolves relative assets using the same authority as the source document. */
export interface PreviewResourceAccess {
	/** Terminal authorization loss. Existing hosts and outstanding reads must be discarded. */
	readonly onDidRevoke?: Event<void>;
	readRelative(
		source: string,
		reference: string,
		token: CancellationToken
	): Promise<PreviewDocumentLease>;
	openLink(source: string, reference: string): Promise<void>;
}

export interface PreviewTextSnapshot {
	readonly resource: string;
	readonly version: number;
	readonly text: string;
}

/** Existing editor models own edits, undo, saves and rename transactions. */
export interface PreviewTextDocument extends IDisposable {
	readonly onDidChange: Event<PreviewTextSnapshot>;
	readonly onDidDispose: Event<void>;
	getSnapshot(): PreviewTextSnapshot;
	revealLine(line: number, focus: boolean): void;
}

export interface PreviewHost extends IDisposable {
	readonly onDidReceiveMessage: Event<unknown>;
	setDocument(document: PreviewHostDocument): void;
	clear(): void;
	postMessage(message: Readonly<Record<string, unknown>>): void;
}

/** Scripts/styles are packaged application assets, never document-controlled. */
export interface PreviewHostDocument {
	readonly kind: 'image' | 'markdown' | 'pdf' | 'text';
	readonly title: string;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly content: string;
}

export interface PreviewPresentationAssets {
	readonly bootstrap: string;
	readonly imageScript: string;
	readonly imageMetadataWorker: string;
	readonly imageStyle: string;
	readonly markdownScript: string;
	readonly markdownStyle: string;
	readonly pdfScript: string;
	readonly pdfStyle: string;
}

export type PreviewState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ready' }
	| { readonly kind: 'error'; readonly reason: 'unsupported' | 'invalid' | 'unavailable' }
	| { readonly kind: 'disposed' };

/** Presentation facts for a caller-owned toolbar/status display. */
export type PreviewDocumentInfo =
	| { readonly kind: 'imageSize'; readonly width: number; readonly height: number }
	| { readonly kind: 'imageScale'; readonly scale: number | 'fit' }
	| { readonly kind: 'pageCount'; readonly count: number }
	| { readonly kind: 'page'; readonly page: number }
	| { readonly kind: 'findMatches'; readonly current: number; readonly total: number };
