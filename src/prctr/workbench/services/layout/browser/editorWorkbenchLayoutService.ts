import { getClientArea, type IDimension } from '../../../../base/browser/dom.js';
import { toDisposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import type { ILayoutOffsetInfo } from '../../../../platform/layout/browser/layoutService.js';
import { EditorLayoutService } from '../../editor/browser/editorLayoutService.js';
import type { IEditorWorkbenchLayoutService } from './editorWorkbenchLayout.js';
import type { IRegisteredWorkbenchPart, PanelAlignment, Parts, Position } from './layoutService.js';
import type { Event } from '../../../../base/common/event.js';

export interface EditorWorkbenchLayoutBindings {
	readonly parts: ReadonlyMap<Parts, HTMLElement>;
	readonly onDidChangePresentation: Event<void>;
	readOffset(): ILayoutOffsetInfo;
	focusContent(): void;
	isRestored(): boolean;
	readPresentation(): {
		readonly floating: boolean;
		readonly compact: boolean;
		readonly uppercaseHeaders: boolean;
	};
	relayout(): void;
	readPositions(): {
		readonly sidebar: Position;
		readonly panel: Position;
		readonly panelAlignment: PanelAlignment;
	};
	setPartHidden(hidden: boolean, part: Parts): void;
}

/** Projects shell geometry into the preserved editor layout calculations. */
export class EditorWorkbenchLayoutService
	extends EditorLayoutService
	implements IEditorWorkbenchLayoutService
{
	private readonly registeredParts = new Map<string, IRegisteredWorkbenchPart>();
	constructor(
		container: HTMLElement,
		private readonly bindings: EditorWorkbenchLayoutBindings,
		stylesReady: Promise<void>
	) {
		super(
			container,
			() => bindings.readOffset(),
			() => bindings.focusContent(),
			stylesReady
		);
	}
	registerPart(part: IRegisteredWorkbenchPart): IDisposable {
		const id = part.getId();
		if (this.registeredParts.has(id)) throw new Error('Editor part is already registered');
		this.registeredParts.set(id, part);
		return toDisposable(() => {
			if (this.registeredParts.get(id) === part) this.registeredParts.delete(id);
		});
	}
	override getContainer(window: Window): HTMLElement;
	override getContainer(window: Window, part: Parts): HTMLElement | undefined;
	override getContainer(window: Window, part?: Parts): HTMLElement | undefined {
		const container = super.getContainer(window);
		return part === undefined
			? container
			: (this.registeredParts.get(part)?.getContainer() ?? this.bindings.parts.get(part));
	}
	isVisible(
		part: Parts,
		window: Window = this.mainContainer.ownerDocument.defaultView!
	): boolean {
		const element = this.getContainer(window, part);
		return !!element && element.isConnected && element.closest('[hidden]') === null;
	}
	setPartHidden(hidden: boolean, part: Parts): void {
		if (!this.bindings.parts.has(part))
			throw new Error('The requested shell part is unavailable');
		this.bindings.setPartHidden(hidden, part);
	}
	getMaximumEditorDimensions(container: HTMLElement): IDimension {
		if (container.ownerDocument !== this.mainContainer.ownerDocument)
			throw new Error('Editor belongs to another window');
		return getClientArea(container);
	}
	isRestored(): boolean {
		return this.bindings.isRestored();
	}
	isFloatingPanelsEnabled(): boolean {
		return this.bindings.readPresentation().floating;
	}
	isModernUICompact(): boolean {
		return this.bindings.readPresentation().compact;
	}
	getSideBarPosition(): Position {
		return this.bindings.readPositions().sidebar;
	}
	getPanelPosition(): Position {
		return this.bindings.readPositions().panel;
	}
	getPanelAlignment(): PanelAlignment {
		return this.bindings.readPositions().panelAlignment;
	}
	get onDidChangePresentation(): Event<void> {
		return this.bindings.onDidChangePresentation;
	}
	useUppercaseViewHeaders(): boolean {
		return this.bindings.readPresentation().uppercaseHeaders;
	}
	layout(): void {
		this.bindings.relayout();
		this.layoutEmitter.fire(this.mainContainerDimension);
	}
	override dispose(): void {
		this.registeredParts.clear();
		super.dispose();
	}
}
