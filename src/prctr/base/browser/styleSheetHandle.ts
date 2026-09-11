import { Emitter } from '../common/event.js';
import { Disposable } from '../common/lifecycle.js';
import { getWindow } from './dom.js';

/** A renderer-owned stylesheet. Text is parsed by CSSOM without allowing inline styles in CSP. */
export class StyleSheetHandle extends Disposable {
	readonly sheet: CSSStyleSheet;
	readonly anchor: Comment;
	private readonly root: Document | ShadowRoot;
	private readonly changed = this._register(new Emitter<string>());
	readonly onDidChangeTextContent = this.changed.event;
	private readonly removed = this._register(new Emitter<void>());
	readonly onDidRemove = this.removed.event;
	private value = '';
	private disposed = false;

	constructor(container: HTMLElement) {
		super();
		const root = container.getRootNode();
		this.root = root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root
			? root as ShadowRoot : container.ownerDocument;
		this.sheet = new (getWindow(container).CSSStyleSheet)({ media: 'screen' });
		// An empty anchor retains DOM ownership and auxiliary-window clone classification.
		this.anchor = container.ownerDocument.createComment('');
		container.appendChild(this.anchor);
		this.root.adoptedStyleSheets = [...this.root.adoptedStyleSheets, this.sheet];
	}

	get textContent(): string { return this.value; }
	set textContent(value: string | null) {
		if (this.disposed) throw new Error('Stylesheet has been disposed.');
		this.value = value ?? '';
		this.sheet.replaceSync(this.value);
		this.changed.fire(this.value);
	}

	remove(): void { this.dispose(); }

	override dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.root.adoptedStyleSheets = this.root.adoptedStyleSheets.filter(sheet => sheet !== this.sheet);
		this.anchor.remove();
		this.removed.fire();
		super.dispose();
	}
}
