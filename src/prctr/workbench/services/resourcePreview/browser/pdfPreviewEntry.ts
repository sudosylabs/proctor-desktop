import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api.js';

declare const PROCTOR_PDF_WORKER_SOURCE: string;
declare const PROCTOR_PDF_BINARY_ASSETS: Readonly<Record<string, string>>;

/** The worker receives bytes and packaged decoder data, never a document URL. */
class PackagedBinaryDataFactory {
	async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
		const directory = (
			{ cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' } as Record<
				string,
				string
			>
		)[kind];
		const encoded =
			directory && /^[\w.-]+$/.test(filename)
				? PROCTOR_PDF_BINARY_ASSETS[`${directory}/${filename}`]
				: undefined;
		if (!encoded) {
			throw new Error('Unpackaged PDF decoder asset');
		}
		return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
	}
}

const api = acquireVsCodeApi();
async function start(): Promise<void> {
	Object.defineProperty(globalThis, 'pdfjsLib', { value: pdfjs });
	const { EventBus, PDFViewer, PDFLinkService, PDFFindController } =
		await import('pdfjs-dist/web/pdf_viewer.mjs');
	const bus = new EventBus();
	class ClosedLinkService extends PDFLinkService {
		override addLinkAttributes(link: HTMLAnchorElement, url: string): void {
			link.href = '#';
			link.rel = 'noreferrer';
			link.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (/^https?:\/\//i.test(url) && url.length <= 8192) {
					api.postMessage({ type: 'openLink', href: url });
				}
			});
		}
		override executeNamedAction(action: string): void {
			if (['NextPage', 'PrevPage', 'FirstPage', 'LastPage'].includes(action)) {
				super.executeNamedAction(action);
			}
		}
	}
	const links = new ClosedLinkService({ eventBus: bus });
	const find = new PDFFindController({ eventBus: bus, linkService: links });
	const container = document.createElement('div');
	container.className = 'pdf-container';
	container.tabIndex = 0;
	const pages = document.createElement('div');
	pages.className = 'pdfViewer';
	container.append(pages);
	document.body.append(container);
	const viewer = new PDFViewer({
		container,
		viewer: pages,
		eventBus: bus,
		linkService: links,
		findController: find,
		annotationMode: pdfjs.AnnotationMode.ENABLE,
		annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
		textLayerMode: 1,
		maxCanvasPixels: 16 * 1024 * 1024,
		maxCanvasDim: 16384
	});
	links.setViewer(viewer);
	const workerUrl = URL.createObjectURL(
		new Blob([PROCTOR_PDF_WORKER_SOURCE], { type: 'text/javascript' })
	);
	const workerPort = new Worker(workerUrl);
	const worker = pdfjs.PDFWorker.create({ port: workerPort });
	let task: PDFDocumentLoadingTask | undefined;
	let generation = 0;
	bus.on('pagesinit', () => {
		viewer.currentScaleValue = 'page-width';
		api.postMessage({ type: 'ready' });
	});
	bus.on('updatefindmatchescount', (data: { matchesCount: unknown }) =>
		api.postMessage({ type: 'findMatches', matches: data.matchesCount })
	);
	bus.on('pagechanging', (data: { pageNumber: number }) =>
		api.postMessage({ type: 'page', page: data.pageNumber })
	);
	window.addEventListener('message', (event) => {
		void handleMessage(event).catch(() => api.postMessage({ type: 'error' }));
	});
	async function handleMessage(event: MessageEvent): Promise<void> {
		if (event.source !== window || !event.data || typeof event.data !== 'object') {
			return;
		}
		const data = event.data;
		if (data.type === 'openPdf') {
			const current = ++generation;
			try {
				if (!(data.bytes instanceof Uint8Array) || data.bytes.length > 128 * 1024 * 1024) {
					throw new Error('Invalid PDF');
				}
				await task?.destroy();
				task = pdfjs.getDocument({
					data: data.bytes,
					worker,
					enableXfa: false,
					useWorkerFetch: false,
					BinaryDataFactory: PackagedBinaryDataFactory,
					cMapUrl: 'packaged:/',
					standardFontDataUrl: 'packaged:/',
					wasmUrl: 'packaged:/',
					useSystemFonts: false,
					disableAutoFetch: true,
					disableStream: true,
					disableRange: true,
					maxImageSize: 16 * 1024 * 1024,
					canvasMaxAreaInBytes: 64 * 1024 * 1024
				});
				task.onPassword = () => {
					void task?.destroy();
					api.postMessage({ type: 'error', reason: 'password-protected' });
				};
				const pdf = await task.promise;
				if (current !== generation) {
					await pdf.loadingTask.destroy();
					return;
				}
				if (pdf.numPages > 2000) {
					await pdf.loadingTask.destroy();
					throw new Error('PDF page limit');
				}
				viewer.setDocument(pdf);
				links.setDocument(pdf);
				find.setDocument(pdf);
				api.postMessage({ type: 'pageCount', count: pdf.numPages });
			} catch {
				if (current === generation) {
					api.postMessage({ type: 'error' });
				}
			}
		} else if (data.type === 'zoomIn') {
			viewer.increaseScale();
		} else if (data.type === 'zoomOut') {
			viewer.decreaseScale();
		} else if (data.type === 'setScale' && data.scale === 'fit') {
			viewer.currentScaleValue = 'page-fit';
		} else if (
			data.type === 'page' &&
			Number.isInteger(data.page) &&
			data.page > 0 &&
			data.page <= viewer.pagesCount
		) {
			viewer.currentPageNumber = data.page;
		} else if (
			data.type === 'find' &&
			typeof data.query === 'string' &&
			data.query.length <= 1024
		) {
			bus.dispatch('find', {
				source: window,
				type: 'again',
				query: data.query,
				phraseSearch: true,
				caseSensitive: false,
				entireWord: false,
				highlightAll: true,
				findPrevious: data.previous === true
			});
		}
	}
	window.addEventListener(
		'pagehide',
		() => {
			++generation;
			void task?.destroy();
			worker.destroy();
			workerPort.terminate();
			URL.revokeObjectURL(workerUrl);
		},
		{ once: true }
	);
}

void start().catch(() => {
	api.postMessage({ type: 'error' });
});
