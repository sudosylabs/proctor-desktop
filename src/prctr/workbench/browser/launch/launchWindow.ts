/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../base/browser/dom.js';
import { createElementFactory } from '../../../base/browser/documentElements.js';
import { DomScrollableElement } from '../../../base/browser/ui/scrollbar/scrollableElement.js';
import { createLocalization, type LocalizationContext } from '../../../base/common/localization.js';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../base/common/scrollable.js';
import type { LaunchIdentityClient } from '../../../platform/identity/common/launchIdentity.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationService } from '../../../platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../../platform/instantiation/common/serviceCollection.js';
import { BrowserThemeService } from '../../../platform/theme/browser/themeService.js';
import { ProductWindowChrome } from '../../../platform/windows/browser/productWindowChrome.js';
import type { ProductWindowChromeClient } from '../../../platform/windows/common/windowChrome.js';
import type { LaunchWindowDescriptor } from '../../../platform/windows/common/windowProtocol.js';
import { allLaunchMessages, launchMessages } from './launchMessages.js';
import {
	formatLaunchText,
	presentLaunch,
	type LaunchActionKind,
	type LaunchViewModel
} from './launchPresentation.js';
import { prepareWorkbenchDocument } from '../documentLayout.js';
import { createStartupSurface } from '../startupSurface.js';
import { LaunchActions } from './launchActions.js';
import { LaunchHeader } from './launchHeader.js';
import { ILaunchIdentityService, LaunchIdentityService } from './launchIdentityService.js';
import { LaunchNotice } from './launchNotice.js';
import { LaunchStatus } from './launchStatus.js';
import { ReadinessChecklist } from './readinessChecklist.js';
import { ServerField } from './serverField.js';
import { ServerSummary } from './serverSummary.js';
import './launchWindow.css';

export interface LaunchRendererClient {
	bootstrap(): Promise<LaunchWindowDescriptor>;
	readonly windowChrome: ProductWindowChromeClient;
	readonly identity: LaunchIdentityClient;
	exit(): Promise<void>;
}

export interface LaunchWindowResult {
	readonly element: HTMLElement;
	readonly disposables: DisposableStore;
}

/**
 * The signed-out window: choose a server, see Proctor check it, and start browser
 * sign-in. Every visible state is derived from the identity projection through
 * `presentLaunch`; this class only owns the DOM, focus and announcements.
 */
export class LaunchWindow extends Disposable {
	readonly element: HTMLElement;
	/** Host for the product window chrome; the window controls draw over it. */
	readonly titlebar: HTMLElement;

	private readonly development: HTMLElement;
	private readonly announcer: HTMLElement;
	private readonly scrollable: DomScrollableElement;
	private readonly header: LaunchHeader;
	private readonly notice: LaunchNotice;
	private readonly field: ServerField;
	private readonly server: ServerSummary;
	private readonly checklist: ReadinessChecklist;
	private readonly status: LaunchStatus;
	private readonly actions: LaunchActions;

	private model: LaunchViewModel | undefined;
	private actionFailed = false;
	private lastAnnouncement = '';

	constructor(
		document: Document,
		private readonly localization: LocalizationContext,
		@ILaunchIdentityService private readonly identity: ILaunchIdentityService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		const $ = createElementFactory(document);
		this.titlebar = $('header.prctr-launch-window__titlebar', {
			attrs: { 'aria-hidden': 'true' }
		});
		this.development = $('p.prctr-launch-window__development', {
			hidden: true,
			textContent: this.localization.format(launchMessages.development)
		});
		this.announcer = $('div.prctr-launch-window__announcer', {
			role: 'status',
			attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' }
		});
		const content = $('main.prctr-launch-window__content', {
			attrs: { 'aria-labelledby': 'prctr-launch-title' }
		});
		const page = $('div.prctr-launch-window__page', {}, content);
		this.scrollable = this._register(
			new DomScrollableElement(page, {
				className: 'prctr-launch-window__scrollable',
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Auto,
				useShadows: false
			})
		);

		this.header = this._register(
			instantiationService.createInstance(LaunchHeader, content, localization)
		);
		this.notice = this._register(
			instantiationService.createInstance(LaunchNotice, content, localization)
		);
		this.field = this._register(
			instantiationService.createInstance(ServerField, content, localization)
		);
		this.server = this._register(
			instantiationService.createInstance(ServerSummary, content, localization)
		);
		this.checklist = this._register(
			instantiationService.createInstance(ReadinessChecklist, content, localization)
		);
		this.status = this._register(
			instantiationService.createInstance(LaunchStatus, content, localization)
		);

		this.element = $(
			'div.prctr-launch-window',
			{},
			this.titlebar,
			this.development,
			this.scrollable.getDomNode()
		);
		this.actions = this._register(
			instantiationService.createInstance(LaunchActions, this.element, localization)
		);
		this.element.append(this.announcer);

		this.registerListeners(page, content);
		this.render();
	}

	/** Puts focus where the candidate's next step is. */
	focusInitial(): void {
		if (this.model?.stage === 'input') {
			this.field.focus();
			return;
		}
		this.actions.focusFirstAvailable();
	}

	private registerListeners(page: HTMLElement, content: HTMLElement): void {
		this._register(
			this.identity.onDidChange(() => {
				this.actionFailed = false;
				this.render();
			})
		);
		this._register(
			this.identity.onDidChangeBusy(() => {
				this.render();
			})
		);
		this._register(
			this.identity.onDidFailAction(() => {
				this.actionFailed = true;
				this.render();
			})
		);
		this._register(
			this.field.onDidSubmit((address) => {
				this.identity.selectServer(address);
			})
		);
		this._register(
			this.server.onDidRequestChange(() => {
				this.identity.changeServer();
			})
		);
		this._register(
			this.status.onDidRequestReopen(() => {
				this.identity.reopenBrowser();
			})
		);
		this._register(
			this.actions.onDidRequest((kind) => {
				this.runAction(kind);
			})
		);

		// Zoom, wrapping and state changes all alter the scroll range.
		const view = page.ownerDocument.defaultView;
		if (view !== null) {
			const resizeObserver = new view.ResizeObserver(() => this.scrollable.scanDomNode());
			resizeObserver.observe(page);
			resizeObserver.observe(content);
			this._register(toDisposable(() => resizeObserver.disconnect()));
		}
		// Focus navigation can scroll the page without going through the scrollable element.
		this._register(
			addDisposableListener(page, 'scroll', () => {
				this.scrollable.scanDomNode();
			})
		);
		// Zoomed text between controls is reachable by keyboard, not only by Tab.
		this._register(
			addDisposableListener(page, 'keydown', (event: KeyboardEvent) => {
				this.scrollByKey(event, page);
			})
		);
	}

	private scrollByKey(event: KeyboardEvent, page: HTMLElement): void {
		if (
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.target === this.field.input
		) {
			return;
		}
		const scrollTop = scrollTopForKey(event.key, page);
		if (scrollTop === undefined) {
			return;
		}
		this.scrollable.setScrollPosition({ scrollTop });
		event.preventDefault();
	}

	private runAction(kind: LaunchActionKind): void {
		switch (kind) {
			case 'continue':
				this.field.submit();
				return;
			case 'signIn':
				this.identity.signIn();
				return;
			case 'retry':
				this.identity.retry();
				return;
			case 'cancel':
				this.identity.cancel();
				return;
		}
	}

	private render(): void {
		const projection = this.identity.projection;
		if (projection === undefined) {
			return;
		}
		const previousStage = this.model?.stage;
		const model = presentLaunch(projection);
		this.model = model;

		this.element.dataset.state = projection.state;
		this.development.hidden = !model.development;
		this.header.render(projection.build);
		this.notice.render(model.notice);
		this.field.render(model.stage === 'input', model.fieldInvalid);
		this.server.render(model.server);
		this.checklist.render(model.checklistTitle, model.steps);
		this.status.render(model.status, this.actionFailed);
		this.actions.render(model.secondary, model.primary, this.identity.isBusy);

		this.announce(model);
		this.restoreFocus(previousStage);
		this.scrollable.scanDomNode();
	}

	/** Announces the notice, field error or status once, and never repeats an unchanged message. */
	private announce(model: LaunchViewModel): void {
		const parts: string[] = [];
		if (model.notice !== undefined) {
			parts.push(this.localization.format(model.notice.text));
		}
		if (model.fieldInvalid) {
			parts.push(this.localization.format(launchMessages.invalidServer));
		}
		if (model.status !== undefined) {
			parts.push(formatLaunchText(this.localization, model.status.head));
			if (model.status.body !== undefined) {
				parts.push(formatLaunchText(this.localization, model.status.body));
			}
		}
		if (this.actionFailed) {
			parts.push(this.localization.format(launchMessages.actionFailed));
		}
		const announcement = parts.join(' ');
		if (announcement !== this.lastAnnouncement) {
			this.lastAnnouncement = announcement;
			this.announcer.textContent = announcement;
		}
	}

	/** Keeps focus on something that still exists and is usable after a state change. */
	private restoreFocus(previousStage: LaunchViewModel['stage'] | undefined): void {
		if (!this.element.isConnected || this.model === undefined) {
			return;
		}
		if (this.model.stage === 'input' && previousStage !== 'input') {
			this.field.focus();
			return;
		}
		const focused = this.element.ownerDocument.activeElement;
		const lost =
			focused === null ||
			focused === this.element.ownerDocument.body ||
			!isVisibleAndEnabled(focused);
		if (!lost) {
			return;
		}
		if (this.actions.focusFirstAvailable()) {
			return;
		}
		const change = this.server.changeButton;
		if (isVisibleAndEnabled(change)) {
			change.focus();
		}
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}

/** Arrow keys move by one row of text; page keys by one viewport. */
const ARROW_SCROLL_STEP = 40;

function scrollTopForKey(key: string, page: HTMLElement): number | undefined {
	switch (key) {
		case 'PageDown':
			return page.scrollTop + page.clientHeight;
		case 'PageUp':
			return page.scrollTop - page.clientHeight;
		case 'Home':
			return 0;
		case 'End':
			return page.scrollHeight;
		case 'ArrowDown':
			return page.scrollTop + ARROW_SCROLL_STEP;
		case 'ArrowUp':
			return page.scrollTop - ARROW_SCROLL_STEP;
		default:
			return undefined;
	}
}

function isVisibleAndEnabled(element: Element): boolean {
	if (element instanceof HTMLButtonElement && element.disabled) {
		return false;
	}
	return element.closest('[hidden]') === null && element.isConnected;
}

/** Composes the LaunchWindow for its renderer entry point, or shows a recovery surface. */
export async function bootstrapLaunchWindow(
	document: Document,
	client: LaunchRendererClient
): Promise<LaunchWindowResult> {
	const disposables = new DisposableStore();
	// The theme outlives a failed start, so the recovery surface is still themed.
	const presentation = new DisposableStore();
	const localization = createLocalization({
		requestedLocale: document.documentElement.lang || 'en',
		messages: allLaunchMessages,
		catalogs: []
	});
	let themeService: BrowserThemeService | undefined;
	const ensureTheme = (): BrowserThemeService => {
		themeService ??= presentation.add(
			new BrowserThemeService(
				document,
				'dark',
				{ density: 'default', motion: 'full', transparency: 'full' },
				{ followSystemColorScheme: true }
			)
		);
		return themeService;
	};
	try {
		prepareWorkbenchDocument(document);
		document.documentElement.lang = localization.locale;
		document.documentElement.dir = localization.direction;
		const theme = ensureTheme();
		const descriptor = await client.bootstrap();
		if (descriptor.kind !== 'launch') {
			throw new Error('Launch renderer received a non-launch descriptor');
		}

		const identity = disposables.add(new LaunchIdentityService(client.identity));
		const services = new ServiceCollection([ILaunchIdentityService, identity]);
		const instantiationService = disposables.add(new InstantiationService(services, true));
		await identity.initialize();
		const launchWindow = disposables.add(
			instantiationService.createInstance(LaunchWindow, document, localization)
		);
		disposables.add(
			await ProductWindowChrome.create(launchWindow.titlebar, client.windowChrome, theme)
		);

		disposables.add(presentation);
		document.body.replaceChildren(launchWindow.element);
		launchWindow.focusInitial();
		return Object.freeze({ element: launchWindow.element, disposables });
	} catch (error) {
		disposables.dispose();
		ensureTheme();
		document.body.replaceChildren(
			createStartupSurface(
				document,
				'launchRecovery',
				localization.format(launchMessages.recovery)
			)
		);
		throw error;
	}
}
