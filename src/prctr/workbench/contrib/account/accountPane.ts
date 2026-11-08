/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../base/browser/dom.js';
import { MenuControl } from '../../../base/browser/ui/menu/menuControl.js';
import { DomScrollableElement } from '../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ToastHost } from '../../../base/browser/ui/toast/toastHost.js';
import type { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../base/common/scrollable.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../platform/instantiation/common/serviceCollection.js';
import { proctorIconFactory } from '../../../platform/theme/browser/proctorIcon.js';
import type { WorkbenchPane } from '../../browser/workbenchPane.js';
import { IWorkbenchOverlayService } from '../../browser/workbenchServices.js';
import type { ResolvedWorkbenchItem } from '../../common/workbenchItem.js';
import type { AccountPage } from '../../services/authenticatedNavigation/common/authenticatedNavigationModel.js';
import { IAccountFormatService } from './accountFormat.js';
import { accountPageRegistry, type AccountPageView } from './accountPages.js';
import { AccountPaneContext, IAccountPaneContext } from './accountPaneContext.js';
import './media/accountPane.css';

export interface AccountModel extends ResolvedWorkbenchItem {
	readonly page: AccountPage;
}

/**
 * The Account pages' pane in the content area: the page heading and description,
 * the page's own actions, and one scrolling page body. Each assignment builds the
 * page afresh; page state lives only for the window session and is never restored.
 */
export class AccountPane extends Disposable implements WorkbenchPane {
	readonly element: HTMLElement;

	private readonly viewport: HTMLElement;
	private readonly scroll: DomScrollableElement;
	private readonly heading: HTMLHeadingElement;
	private readonly description: HTMLElement;
	private readonly headerActions: HTMLElement;
	private readonly body: HTMLElement;
	private readonly menu: MenuControl;
	/** Creates the pane's pages with its row menu, toasts and focus in scope. */
	private readonly scopedInstantiationService: IInstantiationService;
	private readonly page = this._register(new MutableDisposable<AccountPageView>());
	private visible = false;

	constructor(
		document: Document,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkbenchOverlayService overlays: IWorkbenchOverlayService,
		@IAccountFormatService private readonly format: IAccountFormatService
	) {
		super();
		const $ = createElementFactory(document);
		this.heading = $('h1.prctr-account__title', { tabIndex: -1 });
		this.description = $('p.prctr-account__description');
		this.headerActions = $('div.prctr-account__header-actions');
		this.body = $('div.prctr-account__body');
		const header = $(
			'header.prctr-account__header',
			{},
			$('div.prctr-account__heading', {}, this.heading, this.description),
			this.headerActions
		);
		this.viewport = $(
			'div.prctr-account__viewport',
			{ tabIndex: -1 },
			$('div.prctr-account__content', {}, header, this.body)
		);
		this.scroll = this._register(
			new DomScrollableElement(this.viewport, {
				className: 'prctr-account__scroll',
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Auto,
				verticalScrollbarSize: 8,
				useShadows: false
			})
		);
		this.element = $('section.prctr-account', {}, this.scroll.getDomNode());
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
		const context = new AccountPaneContext(
			document,
			overlays,
			this.menu,
			toasts,
			format.text('retry'),
			() => this.focus()
		);
		this.scopedInstantiationService = this._register(
			instantiationService.createChild(new ServiceCollection([IAccountPaneContext, context]))
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

	setItem(model: ResolvedWorkbenchItem, token: CancellationToken): void {
		this.clear();
		if (token.isCancellationRequested) return;
		const page = (model as AccountModel).page;
		this.element.dataset.page = page;
		this.heading.id = `prctr-account-${page}-title`;
		this.element.setAttribute('aria-labelledby', this.heading.id);
		const descriptor = accountPageRegistry[page];
		this.heading.textContent = this.format.text(descriptor.title);
		this.description.textContent = descriptor.description(this.format);
		this.page.value = descriptor.create(
			this.scopedInstantiationService,
			this.body,
			this.headerActions
		);
		this.page.value.setVisible(this.visible);
		this.scroll.setScrollPosition({ scrollTop: 0 });
	}

	clear(): void {
		this.menu.hide(false);
		this.page.clear();
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

	getViewState(): undefined {
		return undefined;
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		this.clear();
		super.dispose();
		this.element.remove();
	}
}
