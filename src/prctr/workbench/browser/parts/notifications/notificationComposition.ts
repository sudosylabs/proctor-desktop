import type { Event } from '../../../../base/common/event.js';
import {
	BrowserNotificationPreferenceStore,
	type NotificationPreferenceBinding
} from '../../../services/notification/browser/notificationPreferenceStore.js';
import { WorkbenchNotifications } from './notifications.js';

export function createWindowNotifications(
	document: Document,
	host: HTMLElement,
	indicator: HTMLElement,
	titlebar: HTMLElement,
	status: HTMLElement | undefined,
	binding: NotificationPreferenceBinding,
	canInteract: () => boolean,
	onDidChangeInteraction: Event<void>,
	fallback: () => void
): WorkbenchNotifications {
	let storage: Storage | undefined;
	try {
		storage = document.defaultView?.localStorage;
	} catch {
		/* Nonpersistent contexts retain current-window preferences. */
	}
	const preferences = new BrowserNotificationPreferenceStore(storage, binding);
	let prior: HTMLElement | undefined;
	const listener = (event: FocusEvent): void => {
		const target = event.target;
		if (target instanceof HTMLElement && !host.contains(target) && !indicator.contains(target))
			prior = target;
	};
	document.addEventListener('focusin', listener, true);
	const notifications = new WorkbenchNotifications({
		host,
		indicatorHost: indicator,
		preferences,
		position: preferences.position,
		effects: {
			canInteract,
			onDidChangeInteraction,
			restoreFocus: () => {
				if (!canInteract()) return;
				if (
					prior?.isConnected &&
					!prior.closest('[inert],[hidden]') &&
					prior.getClientRects().length
				)
					prior.focus();
				else fallback();
			}
		},
		geometry: () => ({
			width: host.clientWidth,
			height: host.clientHeight,
			top: titlebar.hidden ? 0 : titlebar.getBoundingClientRect().height,
			bottom: status?.getBoundingClientRect().height ?? 0
		})
	});
	const dispose = notifications.dispose.bind(notifications);
	notifications.dispose = () => {
		document.removeEventListener('focusin', listener, true);
		dispose();
	};
	return notifications;
}
