import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	PreviewHost,
	PreviewHostDocument,
	PreviewPresentationAssets
} from '../common/resourcePreview.js';

function escape(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
	);
}

/** A new opaque document for each resource. No document shares the workbench origin. */
export class SandboxPreviewHost extends Disposable implements PreviewHost {
	private readonly messages = this._register(new Emitter<unknown>());
	readonly onDidReceiveMessage = this.messages.event;
	private frame: HTMLIFrameElement | undefined;
	private port: MessagePort | undefined;
	private queue: Readonly<Record<string, unknown>>[] = [];
	private generation = 0;
	private ended = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly assets: PreviewPresentationAssets
	) {
		super();
		const observer = new MutationObserver(() => {
			if (this.frame) {
				this.postMessage({
					type: 'proctor-preview-theme',
					css: this.theme(this.container.ownerDocument),
					classes: this.themeClasses(this.container.ownerDocument)
				});
			}
		});
		observer.observe(container.ownerDocument.documentElement, {
			attributes: true,
			attributeFilter: [
				'style',
				'class',
				'data-prctr-theme',
				'data-prctr-theme-contrast',
				'data-prctr-motion'
			]
		});
		this._register({ dispose: () => observer.disconnect() });
	}

	setDocument(document: PreviewHostDocument): void {
		if (this.ended) {
			throw new Error('Preview disposed');
		}
		this.clear();
		const generation = ++this.generation;
		const frame = this.container.ownerDocument.createElement('iframe');
		this.frame = frame;
		frame.title = document.title;
		frame.setAttribute('sandbox', 'allow-scripts');
		frame.setAttribute('referrerpolicy', 'no-referrer');
		frame.setAttribute(
			'allow',
			"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; display-capture 'none'"
		);
		frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
		const nonce = crypto.randomUUID().replaceAll('-', '');
		const script =
			document.kind === 'markdown'
				? this.assets.markdownScript
				: document.kind === 'image'
					? this.assets.imageScript
					: document.kind === 'pdf'
						? this.assets.pdfScript
						: '';
		const style =
			document.kind === 'markdown'
				? this.assets.markdownStyle
				: document.kind === 'image'
					? this.assets.imageStyle
					: document.kind === 'pdf'
						? this.assets.pdfStyle
						: '';
		const theme = this.theme(frame.ownerDocument);
		const policy = `default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; worker-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
		const settings = escape(JSON.stringify(document.settings));
		const body =
			document.kind === 'markdown'
				? `<div id="vscode-markdown-preview-data" data-settings="${settings}" data-state="{}" data-strings="{}" data-initial-md-content="${escape(document.content)}"></div>`
				: document.kind === 'image'
					? `<div id="image-preview-settings" data-settings="${settings}"></div><div class="loading-indicator" aria-hidden="true"></div><div class="image-load-error" role="alert">${escape(document.content)}</div>`
					: document.kind === 'text'
						? `<pre>${escape(document.content)}</pre>`
						: '';
		frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="proctor-preview-theme">${theme}</style><style>${style.replaceAll('</style', '<\\/style')}</style></head><body class="container ${document.kind === 'image' ? 'loading' : ''} ${this.themeClasses(frame.ownerDocument).join(' ')}">${body}<script nonce="${nonce}">${this.assets.bootstrap.replaceAll('</script', '<\\/script')}\n${script.replaceAll('</script', '<\\/script')}</script></body></html>`;
		frame.addEventListener(
			'load',
			() => {
				if (this.ended || generation !== this.generation || this.frame !== frame) {
					return;
				}
				this.port?.close();
				const channel = new MessageChannel();
				this.port = channel.port1;
				this.port.onmessage = ({ data }) => {
					if (!this.ended && generation === this.generation) {
						this.messages.fire(data);
					}
				};
				frame.contentWindow?.postMessage({ type: 'proctor-preview-connect' }, '*', [
					channel.port2
				]);
				this.port.start();
				for (const message of this.queue.splice(0)) {
					this.port.postMessage(message);
				}
			},
			{ once: true }
		);
		this.container.append(frame);
	}

	postMessage(message: Readonly<Record<string, unknown>>): void {
		if (this.ended) {
			return;
		}
		if (this.port) {
			this.port.postMessage(message);
		} else if (this.queue.length < 32) {
			this.queue.push(message);
		}
	}

	private themeClasses(document: Document): string[] {
		const root = document.documentElement;
		const dark = document.defaultView!.getComputedStyle(root).colorScheme !== 'light';
		return [
			dark ? 'vscode-dark' : 'vscode-light',
			...(root.dataset.prctrThemeContrast === 'high'
				? ['vscode-high-contrast', ...(dark ? [] : ['vscode-high-contrast-light'])]
				: [])
		];
	}
	private theme(document: Document): string {
		const computed = document.defaultView!.getComputedStyle(this.container);
		const declarations: string[] = [];
		for (const property of Array.from(computed)) {
			if (property.startsWith('--prctr-') && /^--[\w-]+$/.test(property)) {
				const value = computed.getPropertyValue(property);
				if (!/[<>;]/.test(value)) {
					declarations.push(`${property}:${value}`);
				}
			}
		}
		return `:root{${declarations.join(';')};--prctr-theme-editor-font-family:var(--prctr-typography-font-monospace,monospace)}html,body{margin:0;color:var(--prctr-theme-editor-foreground);background:var(--prctr-theme-editor-background);font-family:var(--prctr-typography-font-application,system-ui)}body{overscroll-behavior:contain}`;
	}
	clear(): void {
		++this.generation;
		this.port?.close();
		this.port = undefined;
		this.queue = [];
		this.frame?.remove();
		this.frame = undefined;
	}
	override dispose(): void {
		if (!this.ended) {
			this.ended = true;
			++this.generation;
			this.clear();
			super.dispose();
		}
	}
}
