/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port workbench-notifications
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import {
	NotificationChangeType,
	NotificationViewItemContentChangeKind,
	type INotificationViewItem,
	type NotificationsModel
} from '../../../common/notifications.js';
import { NotificationsFilter } from '../../../../platform/notification/common/notification.js';
import type { NotificationService } from '../../../services/notification/common/notificationService.js';
import type { NotificationPreferences } from '../../../services/notification/common/notificationPreferences.js';
import type {
	NotificationEffects,
	NotificationGeometry,
	NotificationLabels
} from './notificationPresentation.js';
import { NotificationMenu } from './notificationMenu.js';
import { NotificationRenderer } from './notificationsViewer.js';
import { NotificationsList } from './notificationsList.js';

export class NotificationsCenter extends Disposable {
	readonly element: HTMLElement;
	readonly #title: HTMLElement;
	readonly #clear: HTMLButtonElement;
	readonly #listHost: HTMLElement;
	#list: NotificationsList | undefined;
	readonly #change = this._register(new Emitter<void>());
	readonly onDidChangeVisibility = this.#change.event;
	#visible = false;
	#geometry: NotificationGeometry = { width: 450, height: 500, top: 0, bottom: 0 };
	constructor(
		host: HTMLElement,
		private readonly model: NotificationsModel,
		private readonly renderer: NotificationRenderer,
		private readonly effects: NotificationEffects,
		private readonly labels: NotificationLabels,
		service: NotificationService,
		preferences: NotificationPreferences,
		menu: NotificationMenu
	) {
		super();
		this.element = host.ownerDocument.createElement('section');
		this.element.className = 'notifications-center';
		this.element.hidden = true;
		this.element.setAttribute('aria-label', labels.notifications);
		host.append(this.element);
		const header = host.ownerDocument.createElement('div');
		header.className = 'notifications-center-header';
		this.#title = host.ownerDocument.createElement('span');
		this.#title.className = 'notifications-center-header-title';
		header.append(this.#title);
		this.element.append(header);
		const tools = this._register(new DisposableStore());
		const toolbar = host.ownerDocument.createElement('div');
		toolbar.className = 'notifications-center-header-toolbar';
		toolbar.setAttribute('aria-label', labels.notifications);
		header.append(toolbar);
		this.#clear = renderer.tool(toolbar, labels.clearAll, 'notification.clearAll', tools, () =>
			this.clearAll()
		);
		const configure = renderer.tool(toolbar, labels.mute, 'notification.muted', tools, () =>
			menu.show(
				configure,
				[
					{
						label: labels.mute,
						checked: service.getFilter() === NotificationsFilter.ERROR,
						run: () =>
							service.setFilter(
								service.getFilter() === NotificationsFilter.ERROR
									? NotificationsFilter.OFF
									: NotificationsFilter.ERROR
							)
					},
					...service
						.getFilters()
						.sort((a, b) => a.label.localeCompare(b.label))
						.slice(0, 10)
						.map((source) => ({
							label: source.label,
							checked: source.filter === NotificationsFilter.OFF,
							run: () =>
								service.setFilter({
									...source,
									filter:
										source.filter === NotificationsFilter.OFF
											? NotificationsFilter.ERROR
											: NotificationsFilter.OFF
								})
						})),
					...(service.getFilters().length > 10
						? [
								{
									label: labels.sources,
									children: service
										.getFilters()
										.sort((a, b) => a.label.localeCompare(b.label))
										.map((source) => ({
											label: source.label,
											checked: source.filter === NotificationsFilter.OFF,
											run: () =>
												service.setFilter({
													...source,
													filter:
														source.filter === NotificationsFilter.OFF
															? NotificationsFilter.ERROR
															: NotificationsFilter.OFF
												})
										}))
								}
							]
						: [])
				],
				labels.mute
			)
		);
		configure.setAttribute('aria-haspopup', 'menu');
		const position = renderer.tool(
			toolbar,
			labels.position,
			'notification.position',
			tools,
			() =>
				menu.show(
					position,
					(
						[
							{ value: 'bottom-right', label: labels.bottomRight },
							{ value: 'bottom-left', label: labels.bottomLeft },
							{ value: 'top-right', label: labels.topRight }
						] as const
					).map((item) => ({
						label: item.label,
						checked: preferences.position === item.value,
						run: () => preferences.setPosition(item.value)
					})),
					labels.position
				)
		);
		position.setAttribute('aria-haspopup', 'menu');
		const hide = renderer.tool(toolbar, labels.hide, 'disclosure.expanded', tools, () =>
			this.hide()
		);
		const updateHide = (): void => {
			hide.style.transform = preferences.position === 'top-right' ? 'rotate(180deg)' : '';
		};
		this._register(preferences.onDidChange(updateHide));
		updateHide();
		this.#listHost = host.ownerDocument.createElement('div');
		this.element.append(this.#listHost);
		this._register(
			model.onDidChangeNotification((event) => {
				if (!this.#visible) return;
				if (
					event.kind === NotificationChangeType.ADD ||
					event.kind === NotificationChangeType.REMOVE
				) {
					this.list.setItems(model.notifications);
					if (model.notifications.length === 0) {
						this.hide();
						return;
					}
				} else
					this.list.update(
						event.item,
						event.kind === NotificationChangeType.EXPAND_COLLAPSE ||
							event.detail === NotificationViewItemContentChangeKind.ACTIONS ||
							event.detail === NotificationViewItemContentChangeKind.SEVERITY ||
							event.activeProgressChanged === true
					);
				event.item.updateVisibility(event.kind !== NotificationChangeType.REMOVE);
				this.updateTitle();
				this.layout(this.#geometry);
			})
		);
		this._register(
			service.onDidChangeFilter(() => {
				if (service.getFilter() === NotificationsFilter.ERROR) this.hide();
			})
		);
	}
	get list(): NotificationsList {
		return (this.#list ??= this._register(
			new NotificationsList(this.#listHost, this.renderer, this.labels)
		));
	}
	get focused(): INotificationViewItem | undefined {
		return this.#list?.focused;
	}
	remeasure(): void {
		this.#list?.remeasure();
	}
	get visible(): boolean {
		return this.#visible;
	}
	show(item?: INotificationViewItem): void {
		if (!this.effects.canInteract()) return;
		this.#visible = true;
		this.element.hidden = false;
		this.element.classList.add('visible');
		this.updateTitle();
		this.list.setItems(this.model.notifications);
		this.layout(this.#geometry);
		this.model.notifications.forEach((value) => value.updateVisibility(true));
		this.list.focus(item);
		this.#change.fire();
	}
	hide(restore = true): void {
		if (!this.#visible) return;
		const focused = this.element.contains(this.element.ownerDocument.activeElement);
		this.#visible = false;
		this.element.hidden = true;
		this.element.classList.remove('visible');
		this.list.setItems([]);
		this.model.notifications.forEach((value) => value.updateVisibility(false));
		this.#change.fire();
		if (restore && focused) this.effects.restoreFocus();
	}
	clearAll(): void {
		this.hide();
		for (const item of [...this.model.notifications]) if (!item.hasActiveProgress) item.close();
	}
	private updateTitle(): void {
		this.#title.textContent = this.model.notifications.length
			? this.labels.notifications
			: this.labels.empty;
		this.#clear.disabled = !this.model.notifications.some((item) => !item.hasActiveProgress);
	}
	layout(geometry: NotificationGeometry): void {
		this.#geometry = geometry;
		this.#list?.layout(
			Math.max(0, Math.min(450, geometry.width - 16)),
			Math.max(0, Math.min(400, geometry.height - geometry.top - geometry.bottom - 60))
		);
	}
	override dispose(): void {
		this.hide(false);
		super.dispose();
		this.element.remove();
	}
}
