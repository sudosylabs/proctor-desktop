/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../base/common/event.js';
import { Disposable, type IDisposable } from '../../../base/common/lifecycle.js';
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

/** Only the server's normalized WebP rendition is shown as the account photo. */
const PHOTO_PATTERN = /^data:image\/webp;base64,/u;

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
	private readonly avatar: HTMLElement;
	private readonly initials: string;
	private readonly roving: RovingFocus;

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
		this.element = $('div.prctr-area-rail', {}, list, this.account);
		host.append(this.element);
		this._register(hover(this.account, accountLabel));
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
