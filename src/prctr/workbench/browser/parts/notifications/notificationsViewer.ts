/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port workbench-notifications

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ProgressBar } from '../../../../base/browser/ui/progressbar/progressbar.js';
import type { IListRenderer } from '../../../../base/browser/ui/list/list.js';
import { Action, type IAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import {
	NotificationsFilter,
	Severity
} from '../../../../platform/notification/common/notification.js';
import {
	ChoiceAction,
	NotificationViewItemContentChangeKind,
	type INotificationViewItem
} from '../../../common/notifications.js';
import type { NotificationService } from '../../../services/notification/common/notificationService.js';
import type { NotificationEffects, NotificationLabels } from './notificationPresentation.js';
import { NotificationMenu, type NotificationMenuEntry } from './notificationMenu.js';
import { NotificationHover } from './notificationHover.js';
import './notificationsViewer.css';

interface Template {
	readonly element: HTMLElement;
	readonly lifetime: DisposableStore;
	readonly input: DisposableStore;
	item?: INotificationViewItem;
}
export class NotificationRenderer
	extends Disposable
	implements IListRenderer<INotificationViewItem, Template>
{
	readonly templateId = 'notification';
	readonly #measure: HTMLElement;
	readonly #hover: NotificationHover;
	constructor(
		host: HTMLElement,
		private readonly service: NotificationService,
		private readonly effects: NotificationEffects,
		private readonly labels: NotificationLabels,
		private readonly menu: NotificationMenu,
		private readonly read: (item: INotificationViewItem) => void
	) {
		super();
		this.#hover = this._register(new NotificationHover(host, effects));
		this.#measure = host.ownerDocument.createElement('div');
		this.#measure.className = 'notifications-list-container notification-offset-helper';
		this.#measure.setAttribute('aria-hidden', 'true');
		this.#measure.inert = true;
		host.append(this.#measure);
		this._register({ dispose: () => this.#measure.remove() });
	}
	measure(item: INotificationViewItem, width: number): number {
		this.#measure.style.width = `${Math.max(0, width)}px`;
		const template = this.renderTemplate(this.#measure);
		try {
			this.renderElement(item, 0, template);
			template.element.style.blockSize = 'auto';
			return Math.ceil(template.element.getBoundingClientRect().height);
		} finally {
			this.disposeTemplate(template);
		}
	}
	renderTemplate(container: HTMLElement): Template {
		const lifetime = new DisposableStore();
		const input = lifetime.add(new DisposableStore());
		const element = container.ownerDocument.createElement('div');
		element.className = 'notification-list-item';
		container.append(element);
		return { element, lifetime, input };
	}
	renderElement(item: INotificationViewItem, _index: number, data: Template): void {
		data.input.clear();
		data.item = item;
		const root = data.element;
		root.replaceChildren();
		root.classList.toggle('expanded', item.expanded);
		const main = root.ownerDocument.createElement('div');
		main.className = 'notification-list-item-main-row';
		const icon = data.input.add(
			createSemanticIcon(root.ownerDocument, {
				id:
					item.severity === Severity.Error
						? 'state.error'
						: item.severity === Severity.Warning
							? 'state.warning'
							: 'state.info'
			})
		);
		const iconHost = root.ownerDocument.createElement('span');
		iconHost.className = 'notification-list-item-icon';
		iconHost.dataset.severity = String(item.severity);
		iconHost.append(icon.element);
		const message = root.ownerDocument.createElement('div');
		message.className = 'notification-list-item-message';
		const toolbar = root.ownerDocument.createElement('div');
		toolbar.className = 'notification-list-item-toolbar-container';
		toolbar.role = 'group';
		toolbar.setAttribute('aria-label', this.labels.more);
		main.append(iconHost, message, toolbar);

		const details = root.ownerDocument.createElement('div');
		details.className = 'notification-list-item-details-row';
		if (item.expanded) {
			{
				const source = root.ownerDocument.createElement('span');
				source.className = 'notification-list-item-source';
				source.textContent = item.source ? this.labels.source(item.source) : '';
				data.input.add(this.#hover.attach(source, () => item.source ?? ''));
				details.append(source);
			}
			const buttons = root.ownerDocument.createElement('div');
			buttons.className = 'notification-list-item-buttons-container';
			details.append(buttons);
			for (const [index, action] of (item.actions?.primary ?? []).entries()) {
				const hasDropdown = action instanceof ChoiceAction && action.menu?.length;
				const group = hasDropdown ? root.ownerDocument.createElement('div') : buttons;
				if (hasDropdown) {
					group.className = 'prctr-notification-button-dropdown default-colors';
					buttons.append(group);
				}
				const button = root.ownerDocument.createElement('a');
				button.className =
					'prctr-notification-button prctr-notification-text-button default-colors' +
					(index > 0 ? ' secondary' : '');
				button.role = 'button';
				button.tabIndex = 0;
				button.textContent = action.label;
				button.classList.toggle('disabled', !action.enabled);
				button.setAttribute('aria-disabled', String(!action.enabled));
				group.append(button);
				data.input.add(this.#hover.attach(button, () => action.label));
				const run = (event: Event): void => {
					event.preventDefault();
					event.stopPropagation();
					void this.run(action, item, true);
				};
				data.input.add(addDisposableListener(button, 'click', run));
				data.input.add(
					addDisposableListener(button, 'keydown', (event) => {
						if (event.key === 'Enter' || event.key === ' ') run(event);
					})
				);
				if (action instanceof Action)
					data.input.add(
						action.onDidChange(() => {
							button.textContent = action.label;
							button.classList.toggle('disabled', !action.enabled);
							button.setAttribute('aria-disabled', String(!action.enabled));
						})
					);
				if (action instanceof ChoiceAction && action.menu?.length) {
					const separator = root.ownerDocument.createElement('div');
					separator.className = 'prctr-notification-button-dropdown-separator';
					separator.append(root.ownerDocument.createElement('div'));
					group.append(separator);
					const dropdown = this.tool(
						group,
						this.labels.more,
						'disclosure.expanded',
						data.input,
						() =>
							this.menu.show(
								dropdown,
								this.entries(action.menu ?? [], item, true),
								this.labels.more
							)
					);
					dropdown.className =
						'prctr-notification-button prctr-notification-dropdown-button default-colors' +
						(index > 0 ? ' secondary' : '');
					dropdown.setAttribute('aria-haspopup', 'menu');
				}
			}
			root.append(details);
		}
		root.append(main);
		const progress = data.input.add(
			new ProgressBar(root.parentElement!, {
				ariaLabel: this.labels.progress,
				progressBarBackground: 'var(--prctr-theme-progressBar-background)'
			})
		);
		data.input.add({ dispose: () => progress.getContainer().remove() });
		const renderProgress = (): void => {
			if (!item.hasActiveProgress) {
				progress.stop().hide();
				return;
			}
			const state = item.progress.state;
			if (state.infinite) progress.infinite().show();
			else if (typeof state.total === 'number' || typeof state.worked === 'number') {
				if (typeof state.total === 'number' && !progress.hasTotal())
					progress.total(state.total);
				if (typeof state.worked === 'number') progress.setWorked(state.worked).show();
			} else progress.done().hide();
		};
		const links = new DisposableStore();
		data.input.add(links);
		const renderMessage = (): void => {
			links.clear();
			message.replaceChildren();
			for (const node of item.message.linkedText.nodes) {
				if (typeof node === 'string') {
					message.append(root.ownerDocument.createTextNode(node));
					continue;
				}
				if (!this.effects.openLink) {
					message.append(root.ownerDocument.createTextNode(node.label));
					continue;
				}
				const link = root.ownerDocument.createElement('a');
				link.href = node.href;
				link.textContent = node.label;
				link.title = node.title ?? node.href;
				message.append(link);
				const open = (event: Event): void => {
					event.preventDefault();
					event.stopPropagation();
					if (this.effects.canInteract())
						void this.effects
							.openLink?.(node.href)
							.catch(() => this.effects.onActionError());
				};
				links.add(addDisposableListener(link, 'click', open));
				links.add(addDisposableListener(link, 'auxclick', open));
				links.add(
					addDisposableListener(link, 'keydown', (event) => {
						if (event.key === ' ') open(event);
					})
				);
			}
		};
		renderMessage();
		data.input.add(
			this.#hover.attach(message, () =>
				!item.expanded ? item.message.linkedText.toString() : ''
			)
		);
		// Merely reading the progress accessor makes the model unique; inspect only when already allocated.
		if (item.hasProgress) renderProgress();
		else progress.hide();
		if (item.actions?.secondary?.length) {
			const more = this.tool(toolbar, this.labels.more, 'action.settings', data.input, () => {
				const entries = this.entries(item.actions?.secondary ?? [], item, false);
				if (item.sourceId && item.source)
					entries.unshift({
						label: this.labels.mute,
						checked:
							this.service.getFilter({ id: item.sourceId, label: item.source }) ===
							NotificationsFilter.ERROR,
						run: () => {
							this.service.setFilter({
								id: item.sourceId!,
								label: item.source!,
								filter:
									this.service.getFilter({
										id: item.sourceId!,
										label: item.source!
									}) === NotificationsFilter.ERROR
										? NotificationsFilter.OFF
										: NotificationsFilter.ERROR
							});
						}
					});
				this.menu.show(more, entries, this.labels.more);
			});
			more.setAttribute('aria-haspopup', 'menu');
		}
		if (
			item.canCollapse &&
			(item.expanded || item.source || message.scrollWidth > message.clientWidth)
		)
			this.tool(
				toolbar,
				item.expanded ? this.labels.collapse : this.labels.expand,
				item.expanded ? 'notification.collapse' : 'notification.expand',
				data.input,
				() => item.toggle()
			);
		if (!item.hasActiveProgress)
			this.tool(toolbar, this.labels.close, 'action.close', data.input, () => item.close());
		data.input.add(
			item.onDidChangeContent((event) => {
				if (event.kind === NotificationViewItemContentChangeKind.MESSAGE) renderMessage();
				if (event.kind === NotificationViewItemContentChangeKind.PROGRESS) renderProgress();
			})
		);
		data.input.add(
			addDisposableListener(root, 'mouseup', (event) => {
				if (event.button === 1) {
					event.preventDefault();
					event.stopPropagation();
				}
			})
		);
		data.input.add(
			addDisposableListener(root, 'auxclick', (event) => {
				if (event.button === 1 && !item.hasActiveProgress) {
					event.preventDefault();
					event.stopPropagation();
					item.close();
				}
			})
		);
		data.input.add(
			addDisposableListener(root, 'contextmenu', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.menu.show(
					root,
					[
						...(this.effects.copyText
							? [
									{
										label: this.labels.copy,
										run: () => this.effects.copyText!(item.message.raw)
									}
								]
							: []),
						{ label: this.labels.read, run: () => this.read(item) }
					],
					this.labels.more
				);
			})
		);
	}
	tool(
		host: HTMLElement,
		label: string,
		id: Parameters<typeof createSemanticIcon>[1]['id'],
		store: DisposableStore,
		run: () => void
	): HTMLButtonElement {
		const button = host.ownerDocument.createElement('button');
		button.type = 'button';
		button.className = 'action-label';
		store.add(this.#hover.attach(button, () => label));
		button.setAttribute('aria-label', label);
		const icon = store.add(createSemanticIcon(host.ownerDocument, { id }));
		button.append(icon.element);
		if (host.classList.contains('prctr-notification-button-dropdown')) host.append(button);
		else {
			let actions = host.querySelector<HTMLUListElement>(
				':scope > .prctr-action-bar > .actions-container'
			);
			if (!actions) {
				const bar = host.ownerDocument.createElement('div');
				bar.className = 'prctr-action-bar';
				actions = host.ownerDocument.createElement('ul');
				actions.className = 'actions-container';
				actions.role = 'toolbar';
				actions.setAttribute(
					'aria-label',
					host.getAttribute('aria-label') ?? this.labels.more
				);
				bar.append(actions);
				host.append(bar);
				store.add(
					addDisposableListener(actions, 'keydown', (event) => {
						if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
						const buttons = Array.from(actions!.querySelectorAll('button')).filter(
							(item) => !item.disabled
						);
						const index = buttons.indexOf(
							host.ownerDocument.activeElement as HTMLButtonElement
						);
						const next =
							event.key === 'Home'
								? 0
								: event.key === 'End'
									? buttons.length - 1
									: (index +
											(event.key === 'ArrowLeft' ? -1 : 1) +
											buttons.length) %
										buttons.length;
						event.preventDefault();
						event.stopPropagation();
						buttons[next]?.focus();
					})
				);
			}
			const item = host.ownerDocument.createElement('li');
			item.className = 'action-item';
			item.role = 'presentation';
			item.append(button);
			actions.append(item);
		}
		store.add(
			addDisposableListener(button, 'click', (event) => {
				event.stopPropagation();
				if (this.effects.canInteract()) run();
			})
		);
		return button;
	}
	entries(
		actions: readonly IAction[],
		item: INotificationViewItem,
		primary: boolean
	): NotificationMenuEntry[] {
		return actions.map((action) => ({
			label: action.label,
			enabled: action.enabled,
			...(action instanceof ChoiceAction && action.menu?.length
				? { children: this.entries(action.menu, item, primary) }
				: {}),
			run: () => this.run(action, item, primary)
		}));
	}
	async run(action: IAction, item: INotificationViewItem, primary: boolean): Promise<void> {
		if (!action.enabled || !this.effects.canInteract()) return;
		try {
			const result = action.run(item);
			if (primary && (!(action instanceof ChoiceAction) || !action.keepOpen)) item.close();
			await result;
		} catch {
			this.effects.onActionError();
		}
	}
	disposeTemplate(data: Template): void {
		data.lifetime.dispose();
		data.element.remove();
	}
}
