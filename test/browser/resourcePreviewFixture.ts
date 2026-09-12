import { ImageMetadataService } from '../../src/prctr/workbench/services/resourcePreview/browser/imageMetadataService.js';
import { Emitter, Event } from '../../src/prctr/base/common/event.js';
import { SandboxPreviewHost } from '../../src/prctr/workbench/services/resourcePreview/browser/sandboxPreviewHost.js';
import { ResourcePreviewSession } from '../../src/prctr/workbench/services/resourcePreview/browser/resourcePreviewSession.js';
import { MarkdownPreviewSession } from '../../src/prctr/workbench/services/resourcePreview/browser/markdownPreviewSession.js';
import { MarkdownLanguageService } from '../../src/prctr/workbench/services/resourcePreview/browser/markdownLanguageService.js';
import type {
	PreviewPresentationAssets,
	PreviewDocumentLease,
	PreviewTextSnapshot
} from '../../src/prctr/workbench/services/resourcePreview/common/resourcePreview.js';

let current: { dispose(): void } | undefined;
let binary: ResourcePreviewSession | undefined;
const changes = new Emitter<PreviewTextSnapshot>();
const disposed = new Emitter<void>();
const revoked = new Emitter<void>();
let resolvePending: ((lease: PreviewDocumentLease) => void) | undefined;
let text =
	'# Preview\n\nA **document**.\n\n<script>parent.document.body.dataset.compromised="true"</script>\n![blocked](https://example.invalid/image.png)';
let version = 1;
const resource = 'prctr-workspace://attempt/readme.md';
const snapshot = (): PreviewTextSnapshot => ({ resource, version, text });
const access = {
	onDidRevoke: revoked.event,
	readRelative: async (_source: string, reference: string): Promise<PreviewDocumentLease> => {
		if (reference === 'pending.png') {
			document.body.dataset.pending = 'true';
			return new Promise((resolve) => {
				resolvePending = resolve;
			});
		}
		throw new Error('No authorized image');
	},
	openLink: async (_source: string, href: string) => {
		document.body.dataset.link = href;
	}
};
Object.assign(window, {
	resolveMarkdownFragment: async (fragment: string) => {
		const service = new MarkdownLanguageService({
			roots: ['prctr-workspace://attempt/'],
			onDidChangeDocument: changes.event,
			onDidCreateDocument: changes.event,
			onDidDeleteDocument: Event.None,
			allMarkdownDocuments: async () => [snapshot()],
			hasMarkdownDocument: (uri) => uri === resource,
			readMarkdownDocument: async (uri) => (uri === resource ? snapshot() : undefined),
			stat: async (uri) => (uri === resource ? { isDirectory: false } : undefined),
			readDirectory: async () => []
		});
		try {
			return await service.resolveLink(resource, fragment);
		} finally {
			service.dispose();
		}
	},
	mountPreview: (
		kind: string,
		assets: PreviewPresentationAssets,
		bytes?: number[],
		mediaType?: string
	) => {
		current?.dispose();
		binary = undefined;
		document.body.replaceChildren();
		document.body.style.cssText = 'height:100vh;margin:0';
		document.body.dataset.state = 'loading';
		const host = new SandboxPreviewHost(document.body, assets);
		if (kind === 'markdown') {
			const session = new MarkdownPreviewSession(
				host,
				access,
				new ImageMetadataService(assets.imageMetadataWorker)
			);
			current = session;
			session.onDidChangeState((state) => {
				document.body.dataset.state = state.kind;
			});
			session.bind({
				onDidChange: changes.event,
				onDidDispose: disposed.event,
				getSnapshot: snapshot,
				revealLine: (line) => {
					document.body.dataset.line = String(line);
				},
				dispose: () => {}
			});
		} else {
			const session = new ResourcePreviewSession(
				host,
				access,
				new ImageMetadataService(assets.imageMetadataWorker)
			);
			binary = session;
			current = session;
			session.onDidChangeDocumentInfo((information) => {
				if (information.kind === 'imageScale') {
					document.body.dataset.scale = String(information.scale);
				}
				if (information.kind === 'pageCount') {
					document.body.dataset.pageCount = String(information.count);
				}
				if (information.kind === 'findMatches') {
					document.body.dataset.matches = String(information.total);
				}
			});
			session.onDidChangeState((state) => {
				document.body.dataset.state = state.kind;
			});
			void session.open(
				{
					resource,
					revision: '1',
					mediaType: mediaType ?? (kind === 'image' ? 'image/png' : 'application/pdf'),
					bytes: new Uint8Array(bytes!),
					dispose: () => {
						document.body.dataset.released = 'true';
					}
				},
				'Preview'
			);
		}
	},
	updatePreview: (next: string) => {
		text = next;
		++version;
		changes.fire(snapshot());
	},
	replacePreviewImage: (bytes: number[]) => {
		if (!binary) throw new Error('No binary preview');
		document.body.dataset.replacementReleased = 'false';
		return binary.open(
			{
				resource,
				revision: '2',
				mediaType: 'image/png',
				bytes: new Uint8Array(bytes),
				dispose: () => {
					document.body.dataset.replacementReleased = 'true';
				}
			},
			'Replacement'
		);
	},
	disposePreview: () => current?.dispose(),
	revokePreview: () => revoked.fire(),
	zoomPreview: (direction: 'in' | 'out' | 'fit') => binary?.zoom(direction),
	findPreview: (query: string) => binary?.find(query),
	releasePendingPreviewResource: (bytes: number[]) => {
		resolvePending?.({
			resource: 'prctr-workspace://attempt/pending.png',
			revision: '1',
			mediaType: 'image/png',
			bytes: new Uint8Array(bytes),
			dispose: () => {
				document.body.dataset.pendingReleased = 'true';
			}
		});
		resolvePending = undefined;
	}
});
