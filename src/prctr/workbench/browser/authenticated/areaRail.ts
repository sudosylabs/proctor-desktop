/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../base/common/event.js';
import { Disposable, MutableDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import type { LocalizationContext } from '../../../base/common/localization.js';
import {
	createProctorIcon,
	type ProctorIconControl
} from '../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../platform/theme/common/proctorIcons.js';
import {
	productDestinations,
	type AuthenticatedDestination,
	type ProductDestination
} from '../../services/authenticatedNavigation/common/authenticatedNavigationModel.js';
import { authenticatedMessages as m, type AuthenticatedMessage } from './authenticatedMessages.js';
import { RovingFocus } from './rovingFocus.js';
import './media/areaRail.css';

const areaPresentation: Readonly<
	Record<
		ProductDestination,
		{ readonly icon: ProctorIconId; readonly label: AuthenticatedMessage }
	>
> = Object.freeze({
	activity: { icon: 'area.activity', label: 'activityArea' },
	management: { icon: 'area.exams', label: 'managementArea' },
	administration: { icon: 'area.administration', label: 'administrationArea' }
});

/**
 * Something about the person or the connection the window wants them to know, shown in the rail
 * just above the account: a fact, such as having no current affiliation, or a problem reaching
 * the server, which can offer to try again.
 */
export interface RailNotice {
	readonly tone: 'info' | 'problem';
	readonly title: string;
	readonly detail?: string;
	readonly retry?: { readonly label: string; run(): void };
}

/** Only the server's normalized WebP rendition is shown as the account photo. */
const PHOTO_PATTERN = /^data:image\/webp;base64,/u;

let noteSequence = 0;

/**
 * The slim rail on the window material: one entry per available product area and
 * the account photo, which opens Account. One tab stop; arrow keys move between entries.
 */
export class AreaRail extends Disposable {
	readonly element: HTMLElement;

	private readonly selectEmitter = this._register(new Emitter<AuthenticatedDestination>());
	readonly onDidSelect: Event<AuthenticatedDestination> = this.selectEmitter.event;

	private readonly areas = new Map<ProductDestination, HTMLButtonElement>();
	private readonly icons = new Map<ProductDestination, ProctorIconControl>();
	private readonly account: HTMLButtonElement;
	private readonly notice: HTMLButtonElement;
	private readonly noticeIcon: ProctorIconControl;
	private readonly note: HTMLElement;
	private readonly noteIcon: ProctorIconControl;
	private readonly noteTitle: HTMLElement;
	private readonly noteDetail: HTMLElement;
	private readonly noteRetry: HTMLButtonElement;
	private current: RailNotice | undefined;
	private readonly avatar: HTMLElement;
	private readonly initials: string;
	private readonly roving: RovingFocus;
	private readonly noticeHover: (target: HTMLElement, label: string) => IDisposable;
	private readonly noticeHoverStore = this._register(new MutableDisposable());

	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext,
		accountName: string,
		hover: (target: HTMLElement, label: string) => IDisposable
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		const list = $('div.prctr-area-rail__areas');
		for (const destination of productDestinations) {
			const presentation = areaPresentation[destination];
			const icon = this._register(
				createProctorIcon(document, { id: presentation.icon, size: 20 })
			);
			this.icons.set(destination, icon);
			const button = $(
				'button.prctr-area-rail__area',
				{ type: 'button', data: { destination } },
				icon.element,
				$('span.prctr-area-rail__label', {
					textContent: this.text(presentation.label)
				})
			);
			button.hidden = true;
			list.append(button);
			this.areas.set(destination, button);
		}
		this.initials = initialsOf(accountName);
		this.avatar = $('span.prctr-area-rail__avatar', {
			attrs: { 'aria-hidden': 'true' },
			textContent: this.initials
		});
		const accountLabel = this.localization.format(m.accountButton, { name: accountName });
		this.account = $(
			'button.prctr-area-rail__account',
			{
				type: 'button',
				data: { destination: 'account' },
				attrs: { 'aria-label': accountLabel }
			},
			this.avatar
		);
		this.noticeIcon = this._register(
			createProctorIcon(document, { id: 'status.info', size: 20 })
		);
		this.notice = $(
			'button.prctr-area-rail__notice',
			{
				type: 'button',
				hidden: true,
				attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }
			},
			this.noticeIcon.element
		);
		this.noteIcon = this._register(
			createProctorIcon(document, { id: 'status.info', size: 18 })
		);
		this.noteTitle = $('strong.prctr-area-rail__note-title', {
			id: `prctr-area-rail-note-${++noteSequence}`
		});
		this.noteDetail = $('p.prctr-area-rail__note-detail');
		this.noteRetry = $('button.prctr-area-rail__note-retry', { type: 'button' });
		this.note = $(
			'div.prctr-area-rail__note',
			{
				hidden: true,
				tabIndex: -1,
				attrs: { role: 'dialog', 'aria-labelledby': this.noteTitle.id }
			},
			$(
				'span.prctr-area-rail__note-icon',
				{ attrs: { 'aria-hidden': 'true' } },
				this.noteIcon.element
			),
			$('div.prctr-area-rail__note-text', {}, this.noteTitle, this.noteDetail, this.noteRetry)
		);
		this.element = $('div.prctr-area-rail', {}, list, this.notice, this.account, this.note);
		host.append(this.element);
		this._register(hover(this.account, accountLabel));
		this.noticeHover = hover;
		this.roving = this._register(new RovingFocus(this.element));
		this.registerListeners();
	}

	private text(key: AuthenticatedMessage): string {
		return this.localization.format(m[key]);
	}

	private registerListeners(): void {
		for (const [destination, button] of this.areas) {
			this._register(
				addDisposableListener(button, 'click', () => {
					this.selectEmitter.fire(destination);
				})
			);
		}
		this._register(
			addDisposableListener(this.account, 'click', () => {
				this.selectEmitter.fire('account');
			})
		);
		this._register(
			addDisposableListener(this.notice, 'click', () =>
				this.setNoteOpen(this.note.hidden === true)
			)
		);
		this._register(
			addDisposableListener(this.noteRetry, 'click', () => {
				const retry = this.current?.retry;
				this.setNoteOpen(false);
				retry?.run();
			})
		);
		this._register(
			addDisposableListener(this.element.ownerDocument, 'keydown', (event) => {
				if (event.key !== 'Escape' || this.note.hidden) return;
				event.stopPropagation();
				this.setNoteOpen(false);
				this.notice.focus();
			})
		);
		this._register(
			addDisposableListener(this.element.ownerDocument, 'pointerdown', (event) => {
				const target = event.target;
				if (this.note.hidden || !(target instanceof Node)) return;
				if (this.note.contains(target) || this.notice.contains(target)) return;
				this.setNoteOpen(false);
			})
		);
	}

	/** Shows, changes or removes the notice above the account; an open note follows it. */
	setNotice(notice: RailNotice | undefined): void {
		this.current = notice;
		this.notice.hidden = notice === undefined;
		if (notice === undefined) {
			this.setNoteOpen(false);
			this.noticeHoverStore.clear();
			return;
		}
		const icon = notice.tone === 'problem' ? 'status.offline' : 'status.info';
		this.noticeIcon.setState({ id: icon, size: 20 });
		this.noteIcon.setState({ id: icon, size: 18 });
		this.notice.dataset.tone = notice.tone;
		this.note.dataset.tone = notice.tone;
		this.notice.setAttribute('aria-label', notice.title);
		this.noticeHoverStore.value = this.noticeHover(this.notice, notice.title);
		this.noteTitle.textContent = notice.title;
		this.noteDetail.textContent = notice.detail ?? '';
		this.noteDetail.hidden = notice.detail === undefined || notice.detail === '';
		this.noteRetry.textContent = notice.retry?.label ?? '';
		this.noteRetry.hidden = notice.retry === undefined;
	}

	private setNoteOpen(open: boolean): void {
		if (open === !this.note.hidden) return;
		this.note.hidden = !open;
		this.notice.setAttribute('aria-expanded', String(open));
		if (!open) return;
		// The note opens beside the rail, its foot level with the notice's.
		const rail = this.element.getBoundingClientRect();
		const button = this.notice.getBoundingClientRect();
		const view = this.element.ownerDocument.defaultView;
		const height = view?.innerHeight ?? button.bottom;
		this.note.style.insetInlineStart = `${rail.right + 8}px`;
		this.note.style.insetBlockEnd = `${Math.max(8, height - button.bottom)}px`;
		if (!this.noteRetry.hidden) this.noteRetry.focus();
		else this.note.focus();
	}

	render(destinations: readonly ProductDestination[], current: AuthenticatedDestination): void {
		for (const [destination, button] of this.areas) {
			button.hidden = !destinations.includes(destination);
			setCurrent(button, destination === current);
			// The current area is drawn in the fill weight.
			this.icons.get(destination)?.setState({
				id: areaPresentation[destination].icon,
				size: 20,
				filled: destination === current
			});
		}
		setCurrent(this.account, current === 'account');
		this.roving.update(this.currentButton(current));
	}

	setPhoto(dataUrl: string): void {
		if (this._store.isDisposed || !PHOTO_PATTERN.test(dataUrl)) return;
		const $ = createElementFactory(this.element.ownerDocument);
		const image = $('img', { alt: '', src: dataUrl, draggable: false });
		this.avatar.replaceChildren(image);
		this.avatar.dataset.photo = 'true';
	}

	private currentButton(current: AuthenticatedDestination): HTMLButtonElement {
		return current === 'account' ? this.account : (this.areas.get(current) ?? this.account);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}

function setCurrent(button: HTMLButtonElement, current: boolean): void {
	if (current) button.setAttribute('aria-current', 'page');
	else button.removeAttribute('aria-current');
}

function initialsOf(name: string): string {
	return name
		.split(/\s+/u)
		.filter((part) => part.length > 0)
		.slice(0, 2)
		.map((part) => [...part][0] ?? '')
		.join('')
		.toUpperCase();
}
