import { acquireEditorStyleScope } from './editorStyleScope.js';
import { getClientArea, type IDimension } from '../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import type { ILayoutOffsetInfo, ILayoutService } from '../../../../platform/layout/browser/layoutService.js';

/** Layout projection for this AuthenticatedWindow; it cannot resolve another window's DOM. */
export class EditorLayoutService extends Disposable implements ILayoutService {
	declare readonly _serviceBrand: undefined;
	protected readonly layoutEmitter = this._register(new Emitter<IDimension>());
	readonly onDidLayoutMainContainer = this.layoutEmitter.event;
	readonly onDidLayoutActiveContainer = this.layoutEmitter.event;
	readonly onDidLayoutContainer = Event.map(this.layoutEmitter.event, dimension => ({ container: this.mainContainer, dimension }));
	// Each authenticated renderer owns exactly one fixed window container.
	readonly onDidAddContainer = Event.None;
	readonly onDidChangeActiveContainer = Event.None;

	constructor(
		readonly mainContainer: HTMLElement,
		private readonly readOffset: () => ILayoutOffsetInfo,
		private readonly focusContent: () => void,
		private readonly stylesReady: Promise<void>
	) {
		super();
		this._register(acquireEditorStyleScope(mainContainer.ownerDocument));
		const observer = new ResizeObserver(() => this.layoutEmitter.fire(this.mainContainerDimension));
		observer.observe(mainContainer);
		this._register(toDisposable(() => observer.disconnect()));
	}

	get mainContainerDimension(): IDimension { return getClientArea(this.mainContainer); }
	get activeContainerDimension(): IDimension { return this.mainContainerDimension; }
	get activeContainer(): HTMLElement { return this.mainContainer; }
	get containers(): Iterable<HTMLElement> { return [this.mainContainer]; }
	get mainContainerOffset(): ILayoutOffsetInfo { return this.readOffset(); }
	get activeContainerOffset(): ILayoutOffsetInfo { return this.readOffset(); }
	getContainer(window: Window): HTMLElement {
		if (window !== this.mainContainer.ownerDocument.defaultView) throw new Error('Editor container belongs to another window.');
		return this.mainContainer;
	}
	whenContainerStylesLoaded(window: Window): Promise<void> {
		this.getContainer(window);
		return this.stylesReady;
	}
	focus(): void { this.focusContent(); }
}
