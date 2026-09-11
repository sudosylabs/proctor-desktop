/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port workbench-notifications
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	NotificationChangeType,
	type INotificationViewItem,
	type NotificationsModel
} from '../../../common/notifications.js';
import { withSeverityPrefix } from '../../../../platform/notification/common/notification.js';
import type { NotificationEffects, NotificationLabels } from './notificationPresentation.js';
import { NotificationRenderer } from './notificationsViewer.js';
import { NotificationMenu } from './notificationMenu.js';

export class NotificationAccessibleView extends Disposable {
	readonly element: HTMLElement;
	readonly #text: HTMLTextAreaElement;
	readonly #actions: HTMLElement;
	readonly #controls = this._register(new DisposableStore());
	#item: INotificationViewItem | undefined;
	#index = 0;
	constructor(
		host: HTMLElement,
		private readonly model: NotificationsModel,
		private readonly renderer: NotificationRenderer,
		private readonly menu: NotificationMenu,
		private readonly labels: NotificationLabels,
		private readonly effects: NotificationEffects,
		private readonly restore: (item: INotificationViewItem | undefined) => void
	) {
		super();
		this.element = host.ownerDocument.createElement('section');
		this.element.className = 'prctr-notifications__reader';
		this.element.hidden = true;
		this.element.role = 'dialog';
		this.element.setAttribute('aria-label', labels.read);
		this.#text = host.ownerDocument.createElement('textarea');
		this.#text.className = 'prctr-notifications__reading-text';
		this.#text.readOnly = true;
		this.#text.setAttribute('aria-label', labels.notifications);
		this.#actions = host.ownerDocument.createElement('div');
		this.#actions.className = 'prctr-notifications__reading-actions';
		this.element.append(this.#text, this.#actions);
		host.append(this.element);
		this._register(
			model.onDidChangeNotification((event) => {
				if (!this.#item) return;
				if (event.kind === NotificationChangeType.REMOVE && event.item === this.#item) {
					const next =
						model.notifications[Math.min(this.#index, model.notifications.length - 1)];
					if (next) this.show(next);
					else this.hide();
				} else if (event.item === this.#item) this.render();
			})
		);
		this._register(
			addDisposableListener(this.element, 'keydown', (event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					this.hide();
				} else if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
					event.preventDefault();
					this.move(event.key === 'ArrowDown' ? 1 : -1);
				}
			})
		);
	}
	get visible(): boolean {
		return this.#item !== undefined;
	}
	show(item: INotificationViewItem): void {
		if (!this.effects.canInteract() || !this.model.notifications.includes(item)) return;
		this.#item = item;
		this.#index = this.model.notifications.indexOf(item);
		this.element.hidden = false;
		this.render();
		this.#text.focus();
		this.#text.setSelectionRange(0, 0);
	}
	private render(): void {
		const item = this.#item;
		if (!item) return;
		this.#index = this.model.notifications.indexOf(item);
		const text = withSeverityPrefix(
			String(item.message.original) +
				(item.source ? '\n' + this.labels.source(item.source) : ''),
			item.severity
		);
		if (this.#text.value !== text) this.#text.value = text;
		const focusedIndex = Array.from(this.#actions.children).indexOf(
			this.element.ownerDocument.activeElement as Element
		);
		this.#controls.clear();
		this.#actions.replaceChildren();
		const add = (label: string, run: () => void, disabled = false): HTMLButtonElement => {
			const button = this.#controls.add(
				new ButtonControl(this.#actions, { label, variant: 'secondary', disabled })
			);
			this.#controls.add(
				button.onDidRequest(() => {
					if (this.effects.canInteract()) run();
				})
			);
			return button.element;
		};
		add(this.labels.previous, () => this.move(-1), this.#index <= 0);
		add(
			this.labels.next,
			() => this.move(1),
			this.#index >= this.model.notifications.length - 1
		);
		const actions = [...(item.actions?.primary ?? []), ...(item.actions?.secondary ?? [])];
		if (actions.length) {
			const button = add(this.labels.more, () =>
				this.menu.show(
					button,
					[
						...this.renderer.entries(item.actions?.primary ?? [], item, true),
						...this.renderer.entries(item.actions?.secondary ?? [], item, false)
					],
					this.labels.more
				)
			);
			button.setAttribute('aria-haspopup', 'menu');
		}
		add(this.labels.close, () => item.close(), item.hasActiveProgress);
		add(this.labels.hide, () => this.hide());
		if (focusedIndex >= 0)
			(this.#actions.children[focusedIndex] as HTMLElement | undefined)?.focus();
	}
	private move(delta: number): void {
		const item = this.model.notifications[this.#index + delta];
		if (item) this.show(item);
	}
	hide(restore = true): void {
		const item = this.#item;
		this.#item = undefined;
		this.element.hidden = true;
		this.#controls.clear();
		if (restore) this.restore(item);
	}
	override dispose(): void {
		this.hide(false);
		super.dispose();
		this.element.remove();
	}
}
