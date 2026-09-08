import { addDisposableListener } from '../../../../base/browser/dom.js';
import {
	Disposable,
	DisposableStore,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import type { NotificationEffects } from './notificationPresentation.js';
import { layoutNotificationPopup } from './notificationPopupLayout.js';
import './notificationHover.css';

/** Plain-text notification hovers stay readable under pointer, focus, zoom and strict CSP. */
export class NotificationHover extends Disposable {
	readonly #active = this._register(new DisposableStore());
	#sequence = 0;
	constructor(
		private readonly host: HTMLElement,
		private readonly effects: NotificationEffects
	) {
		super();
		this._register(
			effects.onDidChangeInteraction(() => {
				if (!effects.canInteract()) this.#active.clear();
			})
		);
	}
	attach(target: HTMLElement, text: () => string): IDisposable {
		const owner = new DisposableStore();
		const window = target.ownerDocument.defaultView!;
		let timer: number | undefined;
		let tip: HTMLElement | undefined;
		let dismissed = false;
		const cancel = (): void => {
			if (timer !== undefined) {
				window.clearTimeout(timer);
				timer = undefined;
			}
		};
		const hide = (): void => {
			cancel();
			if (tip) this.#active.clear();
		};
		const scheduleHide = (): void => {
			cancel();
			timer = window.setTimeout(() => {
				timer = undefined;
				hide();
			}, 150);
		};
		const show = (): void => {
			cancel();
			if (dismissed || !target.isConnected || !this.effects.canInteract() || !text()) return;
			this.#active.clear();
			const active = new DisposableStore();
			this.#active.add(active);
			tip = target.ownerDocument.createElement('div');
			const current = tip;
			current.className = 'prctr-notification-hover';
			current.role = 'tooltip';
			current.id = `prctr-notification-hover-${++this.#sequence}`;
			current.textContent = text();
			this.host.append(current);
			const previous = target.getAttribute('aria-describedby');
			target.setAttribute(
				'aria-describedby',
				[previous, current.id].filter(Boolean).join(' ')
			);
			const surface =
				target.closest<HTMLElement>('.notification-toast, .notifications-center') ?? target;
			const place = (): void => {
				current.style.maxWidth = `${Math.max(0, Math.min(450, this.host.clientWidth - 16))}px`;
				layoutNotificationPopup(this.host, current, target, true, surface);
			};
			place();
			active.add(addDisposableListener(current, 'pointerenter', cancel));
			active.add(addDisposableListener(current, 'pointerleave', scheduleHide));
			active.add(
				addDisposableListener(
					target.ownerDocument,
					'keydown',
					(event) => {
						if (event.key === 'Escape') {
							dismissed = true;
							event.preventDefault();
							event.stopImmediatePropagation();
							hide();
						}
					},
					true
				)
			);
			active.add(addDisposableListener(target.ownerDocument, 'pointerdown', hide, true));
			active.add(addDisposableListener(target.ownerDocument, 'scroll', hide, true));
			const observer = new ResizeObserver(place);
			observer.observe(this.host);
			observer.observe(surface);
			observer.observe(target);
			observer.observe(current);
			active.add({ dispose: () => observer.disconnect() });
			active.add({
				dispose: () => {
					current.remove();
					if (previous) target.setAttribute('aria-describedby', previous);
					else target.removeAttribute('aria-describedby');
					if (tip === current) tip = undefined;
				}
			});
		};
		const schedule = (): void => {
			cancel();
			if (!dismissed) timer = window.setTimeout(show, 300);
		};
		owner.add(
			addDisposableListener(target, 'pointerenter', () => {
				dismissed = false;
				schedule();
			})
		);
		owner.add(
			addDisposableListener(target, 'pointerleave', () => {
				dismissed = false;
				scheduleHide();
			})
		);
		owner.add(addDisposableListener(target, 'focusin', schedule));
		owner.add(
			addDisposableListener(target, 'focusout', () => {
				dismissed = false;
				hide();
			})
		);
		owner.add({ dispose: hide });
		return owner;
	}
}
