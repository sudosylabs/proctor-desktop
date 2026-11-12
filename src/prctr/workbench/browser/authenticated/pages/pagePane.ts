/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createStatusBadge } from '../../../../base/browser/ui/badge/statusBadge.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { MenuControl } from '../../../../base/browser/ui/menu/menuControl.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ToastHost } from '../../../../base/browser/ui/toast/toastHost.js';
import { Event } from '../../../../base/common/event.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import { IWorkbenchOverlayService } from '../../workbenchServices.js';
import { IPageFormatService } from './pageFormat.js';
import { IPagePaneContext, PagePaneContext, type PageHeading } from './pagePaneContext.js';
import './media/pagePane.css';

/** One page in the content area. Its pane shows it and says when it is visible. */
export interface PageView extends IDisposable {
	setVisible(visible: boolean): void;
}

/** What a pane shows: one page's heading, description and content. */
export interface PageContent {
	/** Names the page in the DOM, as in `data-page`, and in its heading's id. */
	readonly id: string;
	readonly title: string;
	readonly description: string;
	/** Tables and wide lists use the wider column; reading pages keep the narrow one. */
	readonly width?: 'narrow' | 'wide';
	/** Builds the page into the pane's body and header actions with the pane's services. */
	create(
		instantiationService: IInstantiationService,
		body: HTMLElement,
		headerActions: HTMLElement
	): PageView;
}

export interface PagePaneOptions {
	/** The area's own root class, which scopes its page styles. */
	readonly className: string;
	/** How the area's failure reasons read in sections and dialogs. */
	describeFailure(reason: string): string;
}

/**
 * The pane that shows one area's pages in the content area: the page heading and
 * description, the page's own actions, and one scrolling page body, with the row
 * menu, toasts and focus every page shares. Each page is built afresh; page state
 * lives only for the window session and is never restored.
 */
export class PagePane extends Disposable {
	readonly element: HTMLElement;

	private readonly viewport: HTMLElement;
	private readonly scroll: DomScrollableElement;
	private readonly heading: HTMLHeadingElement;
	private readonly description: HTMLElement;
	private readonly headerActions: HTMLElement;
	private readonly body: HTMLElement;
	private readonly trail: HTMLElement;
	private readonly initials: HTMLElement;
	private readonly status: HTMLElement;
	private readonly trailStore = this._register(new DisposableStore());
	private readonly menu: MenuControl;
	/** Creates the pane's pages with its row menu, toasts and focus in scope. */
	private readonly scopedInstantiationService: IInstantiationService;
	private readonly page = this._register(new MutableDisposable<PageView>());
	private visible = false;

	constructor(
		document: Document,
		options: PagePaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkbenchOverlayService overlays: IWorkbenchOverlayService,
		@IPageFormatService format: IPageFormatService
	) {
		super();
		const $ = createElementFactory(document);
		this.heading = $('h1.prctr-page-pane__title', { tabIndex: -1 });
		this.description = $('p.prctr-page-pane__description');
		this.headerActions = $('div.prctr-page-pane__header-actions');
		this.body = $('div.prctr-page-pane__body');
		this.trail = $('nav.prctr-page-pane__trail', {
			hidden: true,
			attrs: { 'aria-label': format.text('pageTrail') }
		});
		this.initials = $('span.prctr-page-pane__initials', {
			hidden: true,
			attrs: { 'aria-hidden': 'true' }
		});
		this.status = $('span.prctr-page-pane__status', { hidden: true });
		const header = $(
			'header.prctr-page-pane__header',
			{},
			this.initials,
			$(
				'div.prctr-page-pane__heading',
				{},
				$('div.prctr-page-pane__title-row', {}, this.heading, this.status),
				this.description
			),
			this.headerActions
		);
		this.viewport = $(
			'div.prctr-page-pane__viewport',
			{ tabIndex: -1 },
			$('div.prctr-page-pane__content', {}, this.trail, header, this.body)
		);
		this.scroll = this._register(
			new DomScrollableElement(this.viewport, {
				className: 'prctr-page-pane__scroll',
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Auto,
				verticalScrollbarSize: 8,
				useShadows: false
			})
		);
		this.element = $('section.prctr-page-pane', {}, this.scroll.getDomNode());
		this.element.classList.add(options.className);
		this.menu = this._register(
			new MenuControl(this.element, {
				canInteract: () => !overlays.visible,
				onDidChangeInteraction: Event.map(overlays.onDidChangeVisibility, () => undefined),
				restoreFocus: () => this.focus(),
				onActionError: () => undefined
			})
		);
		const toasts = this._register(
			new ToastHost(this.element, {
				dismissLabel: format.text('dismiss'),
				dismissIcon: proctorIconFactory('action.close', 14)
			})
		);
		const context = new PagePaneContext(
			document,
			overlays,
			this.menu,
			toasts,
			format.text('retry'),
			format.text('undo'),
			format.text('closeDialog'),
			() => this.focus(),
			(reason) => options.describeFailure(reason),
			(heading) => this.setHeading(heading)
		);
		this.scopedInstantiationService = this._register(
			instantiationService.createChild(new ServiceCollection([IPagePaneContext, context]))
		);
		this.registerListeners();
	}

	private registerListeners(): void {
		const observer = new ResizeObserver(() => this.scroll.scanDomNode());
		observer.observe(this.viewport);
		observer.observe(this.body);
		this._register({ dispose: () => observer.disconnect() });
		this._register(
			addDisposableListener(this.viewport, 'scroll', () => {
				this.scroll.scanDomNode();
				// A menu stays beside its row; scrolling closes it rather than leaving it behind.
				if (this.menu.visible) this.menu.hide(false);
			})
		);
		this._register(
			addDisposableListener(this.viewport, 'keydown', (event) => this.onKeyDown(event))
		);
	}

	/** Page keys scroll the page when focus is not in a control. */
	private onKeyDown(event: KeyboardEvent): void {
		if (
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey
		)
			return;
		if (
			event.target instanceof HTMLElement &&
			event.target.closest('input,textarea,select,button,[role="img"]')
		)
			return;
		const positions: Record<string, number> = {
			PageDown: this.viewport.scrollTop + this.viewport.clientHeight,
			PageUp: this.viewport.scrollTop - this.viewport.clientHeight,
			Home: 0,
			End: this.viewport.scrollHeight
		};
		const position = positions[event.key];
		if (position === undefined) return;
		event.preventDefault();
		this.scroll.setScrollPosition({ scrollTop: position });
	}

	/** Builds a page afresh in place of the one shown. */
	show(content: PageContent): void {
		this.clear();
		this.element.dataset.page = content.id;
		this.element.dataset.width = content.width ?? 'narrow';
		this.heading.id = `prctr-page-${content.id}-title`;
		this.element.setAttribute('aria-labelledby', this.heading.id);
		this.setHeading({ title: content.title, description: content.description });
		this.page.value = content.create(
			this.scopedInstantiationService,
			this.body,
			this.headerActions
		);
		this.page.value.setVisible(this.visible);
		this.scroll.setScrollPosition({ scrollTop: 0 });
	}

	/** Renames the shown page, such as when a record's page learns the record's name. */
	setHeading(heading: PageHeading): void {
		this.heading.textContent = heading.title;
		this.description.textContent = heading.description;
		this.description.hidden = heading.description.length === 0;
		if (heading.photo !== undefined && /^data:image\/webp;base64,/u.test(heading.photo)) {
			const image = createElementFactory(this.initials.ownerDocument)('img', {
				alt: '',
				src: heading.photo,
				draggable: false
			});
			this.initials.replaceChildren(image);
		} else this.initials.textContent = heading.initials ?? '';
		this.initials.hidden = heading.initials === undefined && heading.photo === undefined;
		const status = heading.status;
		this.status.replaceChildren(
			...(status === undefined
				? []
				: [
						createStatusBadge(this.status.ownerDocument, {
							text: status.text,
							tone: status.tone
						})
					])
		);
		this.status.hidden = status === undefined;
		this.renderTrail(heading.trail ?? []);
	}

	private renderTrail(trail: NonNullable<PageHeading['trail']>): void {
		this.trailStore.clear();
		const $ = createElementFactory(this.trail.ownerDocument);
		this.trail.replaceChildren();
		this.trail.hidden = trail.length === 0;
		for (const step of trail) {
			const link = $('button.prctr-page-pane__trail-step', {
				type: 'button',
				textContent: step.label
			});
			this.trailStore.add(addDisposableListener(link, 'click', () => step.open()));
			const separator = this.trailStore.add(
				createProctorIcon(this.trail.ownerDocument, { id: 'action.forward', size: 12 })
			);
			separator.element.setAttribute('aria-hidden', 'true');
			this.trail.append(link, separator.element);
		}
		if (trail.length > 0)
			this.trail.append(
				$('span.prctr-page-pane__trail-current', {
					textContent: this.heading.textContent ?? '',
					attrs: { 'aria-current': 'page' }
				})
			);
	}

	clear(): void {
		this.menu.hide(false);
		this.page.clear();
		this.trailStore.clear();
		this.body.replaceChildren();
		this.headerActions.replaceChildren();
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		this.element.hidden = !visible;
		this.page.value?.setVisible(visible);
		if (!visible) this.menu.hide(false);
	}

	layout(): void {
		this.scroll.scanDomNode();
	}

	focus(): void {
		this.heading.focus();
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		this.clear();
		super.dispose();
		this.element.remove();
	}
}
