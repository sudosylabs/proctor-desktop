import './media/notificationActionbar.css';
import './media/notificationButton.css';
import './media/notificationsList.css';
import './media/notificationsCenter.css';
import './media/notificationsToasts.css';
import './media/notificationsActions.css';
import './media/notificationsModern.css';
import './prctr-notification-layer.css';
import './prctr-notifications-feedback.css';
import './prctr-notifications-indicator.css';
import './prctr-notifications-status.css';
import './prctr-notifications-anchor.css';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { NotificationService } from '../../../services/notification/common/notificationService.js';
import {
	NotificationStorage,
	type NotificationPreferenceStore
} from '../../../services/notification/common/notificationStorage.js';
import { NotificationPreferences } from '../../../services/notification/common/notificationPreferences.js';
import { NotificationProgressService } from '../../../services/notification/common/notificationProgress.js';
import type { INotificationViewItem } from '../../../common/notifications.js';
import { NotificationMenu } from './notificationMenu.js';
import { NotificationRenderer } from './notificationsViewer.js';
import { NotificationsCenter } from './notificationsCenter.js';
import { NotificationsToasts } from './notificationsToasts.js';
import { NotificationAccessibleView } from './notificationAccessibleView.js';
import { NotificationsAlerts } from './notificationsAlerts.js';
import { NotificationsStatus } from './notificationsStatus.js';
import { createNotificationLabels } from './notificationMessages.js';
import type { NotificationEffects, NotificationGeometry } from './notificationPresentation.js';
import './notifications.css';

export interface NotificationsOptions {
	readonly host: HTMLElement;
	readonly indicatorHost?: HTMLElement;
	readonly centerEnabled?: boolean;
	readonly effects: Omit<NotificationEffects, 'onActionError'>;
	readonly geometry: () => NotificationGeometry;
	readonly preferences?: NotificationPreferenceStore;
	readonly position?: ConstructorParameters<typeof NotificationPreferences>[0];
}
/** Per-window presentation composition; producers only need the service and progress handles. */
export class WorkbenchNotifications extends Disposable {
	readonly service: NotificationService;
	readonly progress: NotificationProgressService;
	readonly preferences: NotificationPreferences;
	readonly element: HTMLElement;
	readonly center: NotificationsCenter;
	readonly toasts: NotificationsToasts;
	readonly reader: NotificationAccessibleView;
	readonly #menu: NotificationMenu;
	readonly #status: NotificationsStatus | undefined;
	readonly #effects: NotificationEffects;
	constructor(private readonly options: NotificationsOptions) {
		super();
		const labels = createNotificationLabels(
			options.host.ownerDocument.documentElement.lang || 'en'
		);
		this.service = this._register(
			new NotificationService(new NotificationStorage(options.preferences))
		);
		this.progress = this._register(
			new NotificationProgressService(this.service, labels.cancel)
		);
		this.preferences = this._register(new NotificationPreferences(options.position));
		this.#effects = {
			...options.effects,
			onActionError: () => this.service.error(labels.actionFailed)
		};
		this.element = options.host.ownerDocument.createElement('div');
		this.element.className = 'prctr-notifications modern-ui modern-ui-notifications-dialogs';
		options.host.append(this.element);
		this.#menu = this._register(new NotificationMenu(this.element, this.#effects));
		const renderer = this._register(
			new NotificationRenderer(
				this.element,
				this.service,
				this.#effects,
				labels,
				this.#menu,
				(item) => this.read(item)
			)
		);
		this.toasts = this._register(
			new NotificationsToasts(
				this.element,
				this.service.model,
				renderer,
				this.#effects,
				labels,
				this.preferences
			)
		);
		this.center = this._register(
			new NotificationsCenter(
				this.element,
				this.service.model,
				renderer,
				this.#effects,
				labels,
				this.service,
				this.preferences,
				this.#menu
			)
		);
		this.reader = this._register(
			new NotificationAccessibleView(
				this.element,
				this.service.model,
				renderer,
				this.#menu,
				labels,
				this.#effects,
				(item) => this.center.show(item)
			)
		);
		this._register(new NotificationsAlerts(this.element, this.service.model));
		this.#status =
			options.indicatorHost === undefined
				? undefined
				: this._register(
						new NotificationsStatus(
							options.indicatorHost,
							this.service.model,
							this.service,
							labels,
							() => this.toggleCenter()
						)
					);
		this._register(
			this.center.onDidChangeVisibility(() => {
				this.toasts.setBlocked(this.center.visible || !this.#effects.canInteract());
				this.updateStatus();
			})
		);
		this._register(this.toasts.onDidChangeVisibility(() => this.updateStatus()));
		this._register(
			this.#effects.onDidChangeInteraction(() => {
				const allowed = this.#effects.canInteract();
				if (!allowed) {
					this.reader.hide(false);
					this.center.hide(false);
					this.#menu.hide(false);
				}
				this.element.inert = !allowed;
				if (this.#status) this.#status.element.disabled = !allowed;
				this.toasts.setBlocked(!allowed || this.center.visible);
			})
		);
		this._register(
			addDisposableListener(this.element, 'keydown', (event) => {
				if (this.#menu.visible || this.reader.visible) return;
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					if (this.center.visible) this.center.hide();
					else this.toasts.hide();
				} else if (
					!this.center.visible &&
					!(event.target as HTMLElement).closest('button,a')
				) {
					const direction =
						event.key === 'ArrowDown'
							? 'next'
							: event.key === 'ArrowUp'
								? 'previous'
								: event.key === 'Home' || event.key === 'PageUp'
									? 'first'
									: event.key === 'End' || event.key === 'PageDown'
										? 'last'
										: undefined;
					if (direction) {
						event.preventDefault();
						event.stopPropagation();
						this.toasts.navigate(direction);
					}
				}
			})
		);
		const observer = new ResizeObserver(() => this.layout());
		observer.observe(options.host);
		this._register({ dispose: () => observer.disconnect() });
		const presentationObserver = new MutationObserver(() => {
			this.toasts.remeasure();
			this.center.remeasure();
			this.layout();
		});
		presentationObserver.observe(options.host.ownerDocument.documentElement, {
			attributes: true,
			attributeFilter: ['data-prctr-density', 'data-prctr-theme', 'data-prctr-motion', 'dir']
		});
		this._register({ dispose: () => presentationObserver.disconnect() });
		this._register(this.preferences.onDidChange(() => this.layout()));
		this.element.inert = !this.#effects.canInteract();
		if (this.#status) this.#status.element.disabled = !this.#effects.canInteract();
		this.toasts.setBlocked(!this.#effects.canInteract());
		this.layout();
	}
	private updateStatus(): void {
		this.#status?.update(this.center.visible, this.toasts.visible);
	}
	get canInteract(): boolean {
		return this.#effects.canInteract();
	}
	get onDidChangeInteraction() {
		return this.#effects.onDidChangeInteraction;
	}
	start(): void {
		this.toasts.start();
	}
	toggleCenter(): void {
		if (this.center.visible) this.center.hide();
		else this.showCenter();
	}
	showCenter(): void {
		if (this.options.centerEnabled === false) return;
		if (!this.#effects.canInteract()) return;
		this.toasts.hide();
		this.center.show();
	}
	hide(): void {
		this.#menu.hide();
		this.reader.hide(false);
		this.center.hide();
		this.toasts.hide();
	}
	read(
		item: INotificationViewItem | undefined = this.center.focused ??
			this.service.model.notifications[0]
	): void {
		if (item && this.#effects.canInteract()) {
			this.showCenter();
			this.reader.show(item);
		}
	}
	focus(): void {
		if (this.#effects.canInteract()) {
			if (this.center.visible) this.center.list.focus();
			else this.toasts.focus();
		}
	}
	clearAll(): void {
		if (this.#effects.canInteract()) this.center.clearAll();
	}
	private layout(): void {
		const geometry = this.options.geometry();
		this.element.dataset.position = this.preferences.position;
		for (const element of [this.center.element, this.toasts.element]) {
			element.classList.remove('bottom-left', 'bottom-right', 'top-right');
			element.classList.add(this.preferences.position);
		}
		this.element.style.setProperty('--prctr-notifications-top', `${geometry.top + 8}px`);
		this.element.style.setProperty('--prctr-notifications-bottom', `${geometry.bottom + 8}px`);
		this.toasts.layout(geometry);
		this.center.layout(geometry);
	}
	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
