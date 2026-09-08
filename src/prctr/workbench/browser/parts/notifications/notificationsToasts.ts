/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port workbench-notifications
import { addDisposableListener, isEditableElement } from '../../../../base/browser/dom.js';
import { IntervalCounter } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import {
	NotificationPriority,
	NotificationsFilter,
	Severity
} from '../../../../platform/notification/common/notification.js';
import {
	NotificationChangeType,
	NotificationViewItemContentChangeKind,
	type INotificationViewItem,
	type NotificationsModel
} from '../../../common/notifications.js';
import type { NotificationPreferences } from '../../../services/notification/common/notificationPreferences.js';
import type {
	NotificationEffects,
	NotificationGeometry,
	NotificationLabels
} from './notificationPresentation.js';
import { NotificationRenderer } from './notificationsViewer.js';
import { NotificationsList } from './notificationsList.js';
import { PendingNotificationToasts } from './pendingNotificationToasts.js';

interface Toast {
	readonly item: INotificationViewItem;
	readonly element: HTMLElement;
	readonly list: NotificationsList;
	readonly store: DisposableStore;
	hovered: boolean;
}
export class NotificationsToasts extends Disposable {
	readonly element: HTMLElement;
	readonly #toasts = new Map<INotificationViewItem, Toast>();
	readonly #change = this._register(new Emitter<void>());
	readonly onDidChangeVisibility = this.#change.event;
	readonly #counter = new IntervalCounter(800);
	readonly #pending: PendingNotificationToasts<INotificationViewItem>;
	#blocked = false;
	#ready = false;
	#disposed = false;
	#geometry: NotificationGeometry = { width: 450, height: 500, top: 0, bottom: 0 };
	constructor(
		host: HTMLElement,
		private readonly model: NotificationsModel,
		private readonly renderer: NotificationRenderer,
		private readonly effects: NotificationEffects,
		private readonly labels: NotificationLabels,
		private readonly preferences: NotificationPreferences
	) {
		super();
		this.element = host.ownerDocument.createElement('div');
		this.element.className = 'notifications-toasts visible';
		host.append(this.element);
		const window = host.ownerDocument.defaultView!;
		this.#pending = this._register(
			new PendingNotificationToasts(
				(item) =>
					!this.#disposed && !this.#blocked && this.model.notifications.includes(item),
				(a, b) => a.equals(b),
				(callback) => {
					const id = window.requestAnimationFrame(callback);
					return { dispose: () => window.cancelAnimationFrame(id) };
				}
			)
		);
		this._register(
			model.onDidChangeNotification((event) => {
				if (!this.#ready) return;
				if (event.kind === NotificationChangeType.ADD) this.add(event.item);
				else if (event.kind === NotificationChangeType.REMOVE) {
					this.#pending.remove(event.item);
					this.remove(event.item);
				} else {
					const toast = this.#toasts.get(event.item);
					if (toast) {
						toast.list.update(
							event.item,
							event.kind === NotificationChangeType.EXPAND_COLLAPSE ||
								event.detail === NotificationViewItemContentChangeKind.ACTIONS ||
								event.detail === NotificationViewItemContentChangeKind.SEVERITY ||
								event.activeProgressChanged === true
						);
						this.layout(this.#geometry);
					}
				}
			})
		);
		this._register(
			model.onDidChangeFilter((filter) => {
				for (const item of this.#toasts.keys()) {
					if (
						filter.global === NotificationsFilter.ERROR ||
						(item.severity !== Severity.Error &&
							item.priority !== NotificationPriority.URGENT &&
							item.sourceId &&
							filter.sources?.get(item.sourceId) === NotificationsFilter.ERROR)
					)
						this.remove(item);
				}
				if (filter.global === NotificationsFilter.ERROR) this.#pending.clear();
			})
		);
		this._register(preferences.onDidChange(() => this.layout(this.#geometry)));
	}
	start(): void {
		if (this.#ready || this.#disposed) return;
		this.#ready = true;
		for (const item of [...this.model.notifications].reverse()) this.add(item);
	}
	get visible(): boolean {
		return [...this.#toasts.values()].some((toast) => !toast.element.hidden);
	}
	private add(item: INotificationViewItem): void {
		if (
			this.#blocked ||
			!this.effects.canInteract() ||
			item.priority === NotificationPriority.SILENT
		)
			return;
		const active = this.element.ownerDocument.activeElement;
		if (
			item.priority === NotificationPriority.OPTIONAL &&
			active instanceof HTMLElement &&
			isEditableElement(active)
		) {
			const rect = active.getBoundingClientRect(),
				bounds = this.element.parentElement!.getBoundingClientRect();
			const x = rect.left - bounds.left,
				y = rect.top - bounds.top;
			if (
				this.preferences.position === 'bottom-left'
					? x < bounds.width / 2 && y > bounds.height / 2
					: x > bounds.width / 2 &&
						(this.preferences.position === 'top-right'
							? y < bounds.height / 2
							: y > bounds.height / 2)
			)
				return;
		}
		if (this.#pending.tryReplace(item)) return;
		if (this.#counter.increment() > 3) return;
		this.#pending.add(item, (current, store) => this.render(current, store));
	}
	private render(item: INotificationViewItem, store: DisposableStore): void {
		const element = this.element.ownerDocument.createElement('div');
		element.className = 'notification-toast-container';
		this.element.prepend(element);
		const surface = element.ownerDocument.createElement('div');
		surface.className = 'notification-toast notification-fade-in';
		element.append(surface);
		const list = store.add(new NotificationsList(surface, this.renderer, this.labels));
		const toast: Toast = { item, element, list, store, hovered: false };
		this.#toasts.set(item, toast);
		list.layout(
			Math.min(450, this.#geometry.width - 16),
			this.#geometry.height - this.#geometry.top - this.#geometry.bottom - 24
		);
		list.setItems([item]);
		store.add(addDisposableListener(element, 'mouseenter', () => (toast.hovered = true)));
		store.add(addDisposableListener(element, 'mouseleave', () => (toast.hovered = false)));
		store.add({ dispose: () => element.remove() });
		this.layout(this.#geometry);
		this.arm(toast);
	}
	private arm(toast: Toast): void {
		const window = this.element.ownerDocument.defaultView!;
		const delay =
			toast.item.severity === Severity.Error
				? 15000
				: toast.item.severity === Severity.Warning
					? 12000
					: 10000;
		let timer: number | undefined;
		const schedule = (): void => {
			if (timer !== undefined) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				timer = undefined;
				if (!this.element.ownerDocument.hasFocus()) return;
				if (toast.item.sticky || toast.list.hasFocus || toast.hovered) schedule();
				else this.remove(toast.item);
			}, delay);
		};
		toast.store.add(
			addDisposableListener(window, 'focus', () => {
				if (timer === undefined) schedule();
			})
		);
		toast.store.add({
			dispose: () => {
				if (timer !== undefined) window.clearTimeout(timer);
			}
		});
		schedule();
	}
	private remove(item: INotificationViewItem): void {
		const toast = this.#toasts.get(item);
		if (!toast) return;
		const hadFocus = toast.list.hasFocus;
		const ordered = [...this.#toasts.values()].filter((value) => !value.element.hidden);
		const index = ordered.indexOf(toast);
		this.#toasts.delete(item);
		toast.store.dispose();
		item.updateVisibility(false);
		this.layout(this.#geometry);
		if (hadFocus) {
			const next = ordered[index + 1] ?? ordered[index - 1];
			if (next && this.#toasts.has(next.item) && !next.element.hidden) next.list.focus();
			else this.effects.restoreFocus();
		}
	}
	hide(): void {
		this.#pending.clear();
		for (const item of [...this.#toasts.keys()]) this.remove(item);
	}
	setBlocked(blocked: boolean): void {
		this.#blocked = blocked;
		if (blocked) this.hide();
	}
	focus(): void {
		[...this.#toasts.values()]
			.reverse()
			.find((toast) => !toast.element.hidden)
			?.list.focus();
	}
	navigate(direction: 'next' | 'previous' | 'first' | 'last'): void {
		const visible = [...this.#toasts.values()]
			.reverse()
			.filter((toast) => !toast.element.hidden);
		let index = visible.findIndex((toast) => toast.list.hasFocus);
		index =
			direction === 'first'
				? 0
				: direction === 'last'
					? visible.length - 1
					: Math.max(
							0,
							Math.min(visible.length - 1, index + (direction === 'next' ? 1 : -1))
						);
		visible[index]?.list.focus();
	}
	layout(geometry: NotificationGeometry): void {
		this.#geometry = geometry;
		const width = Math.max(0, Math.min(450, geometry.width - 16));
		const available = Math.max(0, geometry.height - geometry.top - geometry.bottom - 24);
		let singleLeft = available;
		let multipleLeft = Math.round(available * 0.618);
		let hiddenFocus = false;
		let count = 0;
		for (const toast of [...this.#toasts.values()].reverse()) {
			toast.list.layout(width, Math.max(0, available - 8));
			const height = toast.list.height + 8;
			singleLeft -= height;
			multipleLeft -= height;
			const visible = count < 3 && (count === 0 ? singleLeft >= 0 : multipleLeft >= 0);
			hiddenFocus ||= !visible && toast.list.hasFocus;
			toast.element.hidden = !visible;
			if (visible) {
				count++;
			}
			toast.item.updateVisibility(visible);
		}
		if (hiddenFocus && this.effects.canInteract()) {
			if (this.visible) this.focus();
			else this.effects.restoreFocus();
		}
		this.#change.fire();
	}
	remeasure(): void {
		for (const toast of this.#toasts.values()) toast.list.remeasure();
		this.layout(this.#geometry);
	}
	override dispose(): void {
		this.#disposed = true;
		this.hide();
		super.dispose();
		this.element.remove();
	}
}
