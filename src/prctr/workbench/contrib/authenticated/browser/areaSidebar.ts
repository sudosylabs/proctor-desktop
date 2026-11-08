/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import type { LocalizationContext } from '../../../../base/common/localization.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import {
	createProctorIcon,
	type ProctorIconControl
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import type { AuthenticatedDestination } from '../common/authenticatedNavigationModel.js';
import { authenticatedMessages as m, type AuthenticatedMessage } from './authenticatedMessages.js';
import { RovingFocus } from './rovingFocus.js';
import './areaSidebar.css';

/** One sidebar entry: a page of the area, or an action such as opening Settings. */
export interface SidebarEntry {
	readonly id: string;
	readonly label: AuthenticatedMessage;
	/** Every entry has an icon; the current page shows its fill weight. */
	readonly icon: ProctorIconId;
	readonly opensDialog?: boolean;
}

export interface SidebarArea {
	readonly destination: AuthenticatedDestination;
	readonly title: AuthenticatedMessage;
	readonly entries: readonly SidebarEntry[];
}

export interface SidebarSelection {
	readonly destination: AuthenticatedDestination;
	readonly entry: string;
}

interface EntryView {
	readonly button: HTMLButtonElement;
	readonly icon: ProctorIconControl;
	readonly id: ProctorIconId;
	readonly badge: HTMLElement;
}

interface AreaView {
	readonly group: HTMLElement;
	readonly entries: ReadonlyMap<string, EntryView>;
}

/**
 * The contextual sidebar for the current area: its title, its pages, any server
 * access notice, and, in Account, Sign out. The frame decides what is current.
 */
export class AreaSidebar extends Disposable {
	readonly element: HTMLElement;

	private readonly selectEmitter = this._register(new Emitter<SidebarSelection>());
	readonly onDidSelect: Event<SidebarSelection> = this.selectEmitter.event;
	private readonly hideEmitter = this._register(new Emitter<void>());
	readonly onDidRequestHide: Event<void> = this.hideEmitter.event;
	private readonly signOutEmitter = this._register(new Emitter<void>());
	readonly onDidRequestSignOut: Event<void> = this.signOutEmitter.event;

	private readonly title: HTMLHeadingElement;
	private readonly hide: HTMLButtonElement;
	private readonly pages: HTMLElement;
	private readonly scroll: DomScrollableElement;
	private readonly status: HTMLElement;
	private readonly statusText: HTMLElement;
	private readonly statusRetry: HTMLButtonElement;
	private readonly footer: HTMLElement;
	private readonly signOut: HTMLButtonElement;
	private readonly signOutFeedback: HTMLElement;
	private readonly areas = new Map<AuthenticatedDestination, AreaView>();
	private readonly areaTitles = new Map<AuthenticatedDestination, AuthenticatedMessage>();
	private readonly roving: RovingFocus;
	private retry: (() => void) | undefined;

	constructor(
		private readonly host: HTMLElement,
		private readonly localization: LocalizationContext,
		areas: readonly SidebarArea[],
		hover: (target: HTMLElement, label: string) => IDisposable
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.title = $('h2.prctr-area-sidebar__title', { id: `${host.id}-title` });
		this.hide = $('button.prctr-area-sidebar__hide', {
			type: 'button',
			attrs: {
				'aria-label': this.text('hideSidebar'),
				'aria-controls': host.id,
				'aria-expanded': 'true'
			}
		});
		this.hide.append(
			this._register(createProctorIcon(document, { id: 'action.toggleSidebar', size: 18 }))
				.element
		);
		this._register(hover(this.hide, this.text('hideSidebar')));
		const header = $('div.prctr-area-sidebar__header', {}, this.title, this.hide);
		this.pages = $('div.prctr-area-sidebar__pages');
		for (const area of areas) this.createArea(area);
		this.scroll = this._register(
			new DomScrollableElement(this.pages, {
				className: 'prctr-area-sidebar__scroll',
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Auto,
				verticalScrollbarSize: 8,
				useShadows: false
			})
		);
		this.statusText = $('p.prctr-area-sidebar__status-text', { attrs: { role: 'status' } });
		this.statusRetry = $('button.prctr-area-sidebar__entry', {
			type: 'button',
			textContent: this.text('retry')
		});
		this.status = $('div.prctr-area-sidebar__status', {}, this.statusText, this.statusRetry);
		this.status.hidden = true;
		this.signOut = $('button.prctr-area-sidebar__entry', {
			type: 'button',
			data: { action: 'signOut' }
		});
		this.signOut.append(
			this._register(createProctorIcon(document, { id: 'action.signOut', size: 18 })).element,
			$('span.prctr-area-sidebar__label', { textContent: this.text('signOut') })
		);
		this.signOutFeedback = $('p.prctr-area-sidebar__feedback', {
			attrs: { role: 'status', 'aria-live': 'polite' }
		});
		this.footer = $('div.prctr-area-sidebar__footer', {}, this.signOut, this.signOutFeedback);
		this.footer.hidden = true;
		this.element = $(
			'div.prctr-area-sidebar',
			{},
			header,
			this.scroll.getDomNode(),
			this.status,
			this.footer
		);
		host.setAttribute('aria-labelledby', this.title.id);
		host.append(this.element);
		this.roving = this._register(new RovingFocus(this.pages));
		const observer = new ResizeObserver(() => this.scroll.scanDomNode());
		observer.observe(this.pages);
		this._register({ dispose: () => observer.disconnect() });
		this.registerListeners();
	}

	private text(key: AuthenticatedMessage): string {
		return this.localization.format(m[key]);
	}

	private createArea(area: SidebarArea): void {
		const $ = createElementFactory(this.pages.ownerDocument);
		const entries = new Map<string, EntryView>();
		const group = $('div.prctr-area-sidebar__group', {
			data: { destination: area.destination }
		});
		for (const entry of area.entries) {
			const icon = this._register(
				createProctorIcon(this.pages.ownerDocument, { id: entry.icon, size: 18 })
			);
			const badge = $('span.prctr-area-sidebar__badge', { hidden: true });
			const button = $(
				'button.prctr-area-sidebar__entry',
				{ type: 'button', data: { entry: entry.id } },
				icon.element,
				$('span.prctr-area-sidebar__label', { textContent: this.text(entry.label) }),
				badge
			);
			if (entry.opensDialog) button.setAttribute('aria-haspopup', 'dialog');
			group.append(button);
			entries.set(entry.id, { button, icon, id: entry.icon, badge });
			this._register(
				addDisposableListener(button, 'click', () => {
					this.selectEmitter.fire({ destination: area.destination, entry: entry.id });
				})
			);
		}
		group.hidden = true;
		this.pages.append(group);
		this.areas.set(area.destination, { group, entries });
		this.areaTitles.set(area.destination, area.title);
	}

	private registerListeners(): void {
		this._register(
			addDisposableListener(this.hide, 'click', () => {
				this.hideEmitter.fire();
			})
		);
		this._register(
			addDisposableListener(this.signOut, 'click', () => {
				this.signOutEmitter.fire();
			})
		);
		this._register(
			addDisposableListener(this.statusRetry, 'click', () => {
				this.retry?.();
			})
		);
	}

	/** Show the current area, marking `entry` as its current page. */
	render(destination: AuthenticatedDestination, entry: string): void {
		const title = this.areaTitles.get(destination);
		this.title.textContent = title === undefined ? '' : this.text(title);
		let current: HTMLButtonElement | undefined;
		for (const [area, view] of this.areas) {
			view.group.hidden = area !== destination;
			for (const [id, { button, icon, id: iconId }] of view.entries) {
				const selected = area === destination && id === entry;
				icon.setState({ id: iconId, size: 18, filled: selected });
				if (selected) {
					button.setAttribute('aria-current', 'page');
					current = button;
				} else button.removeAttribute('aria-current');
			}
		}
		this.footer.hidden = destination !== 'account';
		this.roving.update(current);
		this.scroll.scanDomNode();
	}

	/** Show a short count after an entry's label, such as how many sessions it lists. */
	setBadge(destination: AuthenticatedDestination, entry: string, text: string | undefined): void {
		const badge = this.areas.get(destination)?.entries.get(entry)?.badge;
		if (badge === undefined) return;
		badge.textContent = text ?? '';
		badge.hidden = text === undefined;
	}

	setExpanded(expanded: boolean): void {
		this.hide.setAttribute('aria-expanded', String(expanded));
	}

	setStatus(message: string, retry?: () => void): void {
		this.retry = retry;
		this.statusText.textContent = message;
		this.statusRetry.hidden = retry === undefined;
		this.status.hidden = message.length === 0;
	}

	setSigningOut(signingOut: boolean, failure?: string): void {
		this.signOut.disabled = signingOut;
		this.signOutFeedback.textContent = failure ?? '';
	}

	focus(): void {
		this.roving.focus();
	}

	override dispose(): void {
		super.dispose();
		this.host.removeAttribute('aria-labelledby');
		this.element.remove();
	}
}
