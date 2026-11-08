/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ToastHost } from '../../../../base/browser/ui/toast/toastHost.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { MenuControl } from '../../../../base/browser/ui/menu/menuControl.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import type { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type { LocalizationContext } from '../../../../base/common/localization.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import type { WorkbenchOverlayHost } from '../../../browser/overlayHost.js';
import type { WorkbenchPane } from '../../../browser/workbenchPane.js';
import type { ResolvedWorkbenchItem } from '../../../common/workbenchItem.js';
import type { AccountPage } from '../../authenticated/common/authenticatedNavigationModel.js';
import { accountMessages, type AccountMessage } from './accountMessages.js';
import {
	AccountPageServices,
	type AccountPageView,
	type AccountWindowHooks
} from './accountPageServices.js';
import { ProfilePage } from './profilePage.js';
import { SecurityPage } from './securityPage.js';
import { SessionsPage } from './sessionsPage.js';
import { HistoryPage } from './historyPage.js';
import { SettingsPage } from './settingsPage.js';
import type { IUserSettingsService } from '../../../services/settings/common/settingsRendererClient.js';
import type { IAccountService } from '../../../services/account/common/account.js';
import { TokensPage } from './tokensPage.js';
import './accountPage.css';

export interface AccountModel extends ResolvedWorkbenchItem {
	readonly page: AccountPage;
}

export interface AccountPaneOptions {
	readonly client: IAccountService;
	readonly localization: LocalizationContext;
	readonly binding: AuthenticatedWindowDescriptor;
	readonly overlays: WorkbenchOverlayHost;
	readonly hooks: AccountWindowHooks;
	readonly settings: IUserSettingsService;
	readonly now?: () => number;
}

const pageTitles: Readonly<Record<AccountPage, AccountMessage>> = Object.freeze({
	profile: 'profileTitle',
	security: 'securityTitle',
	sessions: 'sessionsTitle',
	tokens: 'tokensTitle',
	history: 'historyTitle',
	settings: 'settingsTitle'
});

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
	private readonly services: AccountPageServices;
	private readonly menu: MenuControl;
	private readonly toasts: ToastHost;
	private readonly settings: IUserSettingsService;
	private readonly page = this._register(new MutableDisposable<AccountPageView>());
	private visible = false;

	constructor(document: Document, options: AccountPaneOptions) {
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
				canInteract: () => !options.overlays.visible,
				onDidChangeInteraction: Event.map(
					options.overlays.onDidChangeVisibility,
					() => undefined
				),
				restoreFocus: () => this.focus(),
				onActionError: () => undefined
			})
		);
		this.settings = options.settings;
		this.toasts = this._register(
			new ToastHost(this.element, {
				dismissLabel: options.localization.format(accountMessages.dismiss),
				dismissIcon: proctorIconFactory('action.close', 14)
			})
		);
		this.services = new AccountPageServices(
			document,
			options.client,
			options.localization,
			options.binding,
			options.overlays,
			this.menu,
			this.toasts,
			options.hooks,
			() => this.focus(),
			options.now
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
		this.heading.textContent = this.services.text(pageTitles[page]);
		this.description.textContent = this.pageDescription(page);
		this.page.value = this.createPage(page);
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

	private pageDescription(page: AccountPage): string {
		if (page === 'profile')
			return this.services.institutionText('profileDescription', 'profileDescriptionGeneric');
		if (page === 'security') return this.services.text('securityDescription');
		if (page === 'sessions') return this.services.text('sessionsDescription');
		if (page === 'history') return this.services.text('historyDescription');
		if (page === 'settings') return this.services.text('settingsDescription');
		return this.services.text('tokensDescription');
	}

	private createPage(page: AccountPage): AccountPageView {
		if (page === 'profile') return new ProfilePage(this.body, this.services);
		if (page === 'security')
			return new SecurityPage(this.body, this.headerActions, this.services);
		if (page === 'sessions') return new SessionsPage(this.body, this.services);
		if (page === 'history') return new HistoryPage(this.body, this.services);
		if (page === 'settings')
			return new SettingsPage(this.body, this.headerActions, this.services, this.settings);
		return new TokensPage(this.body, this.headerActions, this.services);
	}
}
