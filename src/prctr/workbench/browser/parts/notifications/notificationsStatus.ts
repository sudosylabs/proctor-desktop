/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port workbench-notifications
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import { NotificationsFilter } from '../../../../platform/notification/common/notification.js';
import {
	NotificationChangeType,
	StatusMessageChangeType,
	type IStatusMessageViewItem,
	type NotificationsModel
} from '../../../common/notifications.js';
import type { NotificationService } from '../../../services/notification/common/notificationService.js';
import type { NotificationLabels } from './notificationPresentation.js';

export class NotificationsStatus extends Disposable {
	readonly element: HTMLButtonElement;
	readonly status: HTMLElement;
	readonly #icon = this._register(new MutableDisposable());
	readonly #statusOwner = this._register(new MutableDisposable());
	#unread = 0;
	#center = false;
	#toasts = false;
	#current: IStatusMessageViewItem | undefined;
	constructor(
		host: HTMLElement,
		private readonly model: NotificationsModel,
		private readonly service: NotificationService,
		private readonly labels: NotificationLabels,
		toggle: () => void
	) {
		super();
		this.element = host.ownerDocument.createElement('button');
		this.element.type = 'button';
		this.element.className = 'prctr-notifications-indicator';
		this.status = host.ownerDocument.createElement('span');
		this.status.className = 'prctr-notifications-status';
		host.append(this.status, this.element);
		this._register(addDisposableListener(this.element, 'click', toggle));
		this._register(
			model.onDidChangeNotification((event) => {
				if (!this.#center) {
					if (event.kind === NotificationChangeType.ADD) this.#unread++;
					else if (event.kind === NotificationChangeType.REMOVE)
						this.#unread = Math.max(0, this.#unread - 1);
				}
				this.render();
			})
		);
		this._register(service.onDidChangeFilter(() => this.render()));
		this._register(
			model.onDidChangeStatusMessage((event) => {
				if (event.kind === StatusMessageChangeType.ADD) this.showStatus(event.item);
				else if (event.item === this.#current) {
					this.#statusOwner.clear();
					this.#current = undefined;
					this.render();
				}
			})
		);
		if (model.statusMessage) this.showStatus(model.statusMessage);
		this.render();
	}
	update(center: boolean, toasts: boolean): void {
		this.#center = center;
		this.#toasts = toasts;
		if (center) this.#unread = 0;
		this.render();
	}
	private render(): void {
		const progress = this.model.notifications.filter((item) => item.hasActiveProgress).length;
		const muted = this.service.getFilter() === NotificationsFilter.ERROR;
		const label = this.labels.unread(this.#unread, progress);
		const icon = createSemanticIcon(this.element.ownerDocument, {
			id: muted
				? 'notification.muted'
				: this.#unread || progress
					? 'notification.unread'
					: 'notification.bell'
		});
		this.#icon.value = icon;
		this.element.replaceChildren(icon.element);
		this.element.title = muted ? this.labels.mute : label;
		this.element.setAttribute('aria-label', label);
		this.element.setAttribute('aria-expanded', String(this.#center));
		if (!this.#current)
			this.status.textContent =
				!this.#center && !this.#toasts && progress
					? (this.model.notifications
							.find((item) => item.hasActiveProgress)
							?.message.linkedText.toString() ?? '')
					: '';
	}
	private showStatus(item: IStatusMessageViewItem): void {
		this.#statusOwner.clear();
		this.#current = item;
		const window = this.element.ownerDocument.defaultView!;
		let hide: number | undefined;
		const show = window.setTimeout(() => {
			this.status.textContent = item.message;
		}, item.options?.showAfter ?? 0);
		if ((item.options?.hideAfter ?? -1) > 0)
			hide = window.setTimeout(() => {
				this.#current = undefined;
				this.#statusOwner.clear();
				this.render();
			}, item.options!.hideAfter);
		this.#statusOwner.value = {
			dispose: () => {
				window.clearTimeout(show);
				if (hide !== undefined) window.clearTimeout(hide);
				this.status.textContent = '';
			}
		};
	}
	override dispose(): void {
		super.dispose();
		this.element.remove();
		this.status.remove();
	}
}
