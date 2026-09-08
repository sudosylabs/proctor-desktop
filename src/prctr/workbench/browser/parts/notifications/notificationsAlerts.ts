/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port workbench-notifications
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import {
	NotificationPriority,
	withSeverityPrefix
} from '../../../../platform/notification/common/notification.js';
import {
	NotificationChangeType,
	NotificationViewItemContentChangeKind,
	type INotificationViewItem,
	type NotificationsModel
} from '../../../common/notifications.js';

/** Per-window announcement ownership; notification content is never sent to generic diagnostics. */
export class NotificationsAlerts extends Disposable {
	readonly #element: HTMLElement;
	readonly #items = new Map<INotificationViewItem, DisposableStore>();
	constructor(host: HTMLElement, model: NotificationsModel) {
		super();
		this.#element = host.ownerDocument.createElement('div');
		this.#element.className = 'prctr-notifications__announcements';
		this.#element.role = 'alert';
		this.#element.setAttribute('aria-atomic', 'true');
		host.append(this.#element);
		for (const item of model.notifications) this.add(item);
		this._register(
			model.onDidChangeNotification((event) => {
				if (event.kind === NotificationChangeType.ADD) this.add(event.item);
				else if (event.kind === NotificationChangeType.REMOVE) {
					this.#items.get(event.item)?.dispose();
					this.#items.delete(event.item);
				}
			})
		);
	}
	private add(item: INotificationViewItem): void {
		if (item.priority === NotificationPriority.SILENT) return;
		const store = new DisposableStore();
		this.#items.set(item, store);
		const announce = (): void => {
			this.#element.replaceChildren(
				this.#element.ownerDocument.createTextNode(
					withSeverityPrefix(item.message.linkedText.toString(), item.severity)
				)
			);
		};
		announce();
		store.add(
			item.onDidChangeContent((event) => {
				if (event.kind === NotificationViewItemContentChangeKind.MESSAGE) announce();
			})
		);
	}
	override dispose(): void {
		for (const item of this.#items.values()) item.dispose();
		this.#items.clear();
		super.dispose();
		this.#element.remove();
	}
}
