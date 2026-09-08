import { createLocalization, defineMessage } from '../../../../base/common/localization.js';
import { withSeverityPrefix } from '../../../../platform/notification/common/notification.js';
import type { NotificationLabels } from './notificationPresentation.js';

export const notificationMessages = {
	notifications: defineMessage({
		id: 'workbench.notifications.title',
		defaultMessage: 'Notifications',
		description: 'Notification center name.'
	}),
	empty: defineMessage({
		id: 'workbench.notifications.empty',
		defaultMessage: 'No new notifications',
		description: 'Empty notification center.'
	}),
	close: defineMessage({
		id: 'workbench.notifications.close',
		defaultMessage: 'Clear notification',
		description: 'Dismiss an inactive notification.'
	}),
	clearAll: defineMessage({
		id: 'workbench.notifications.clearall',
		defaultMessage: 'Clear all notifications',
		description: 'Clear notifications without active progress.'
	}),
	hide: defineMessage({
		id: 'workbench.notifications.hide',
		defaultMessage: 'Hide notifications',
		description: 'Hide notification presentation without clearing records.'
	}),
	expand: defineMessage({
		id: 'workbench.notifications.expand',
		defaultMessage: 'Expand notification',
		description: 'Expand message and source.'
	}),
	collapse: defineMessage({
		id: 'workbench.notifications.collapse',
		defaultMessage: 'Collapse notification',
		description: 'Collapse notification details.'
	}),
	more: defineMessage({
		id: 'workbench.notifications.more',
		defaultMessage: 'More actions',
		description: 'Notification secondary actions menu.'
	}),
	copy: defineMessage({
		id: 'workbench.notifications.copy',
		defaultMessage: 'Copy text',
		description: 'Copy safe notification text through the authorized clipboard.'
	}),
	read: defineMessage({
		id: 'workbench.notifications.read',
		defaultMessage: 'Read notification',
		description: 'Open full notification in accessible reading view.'
	}),
	previous: defineMessage({
		id: 'workbench.notifications.previous',
		defaultMessage: 'Previous notification',
		description: 'Read previous notification.'
	}),
	next: defineMessage({
		id: 'workbench.notifications.next',
		defaultMessage: 'Next notification',
		description: 'Read next notification.'
	}),
	mute: defineMessage({
		id: 'workbench.notifications.mute',
		defaultMessage: 'Do Not Disturb',
		description: 'Silence ordinary information and warning toasts.'
	}),
	position: defineMessage({
		id: 'workbench.notifications.position',
		defaultMessage: 'Notification position',
		description: 'Choose notification placement.'
	}),
	sources: defineMessage({
		id: 'workbench.notifications.sources',
		defaultMessage: 'Notification sources',
		description: 'Choose sources for ordinary notifications.'
	}),
	bottomRight: defineMessage({
		id: 'workbench.notifications.bottomright',
		defaultMessage: 'Bottom right',
		description: 'Bottom-right notification placement.'
	}),
	bottomLeft: defineMessage({
		id: 'workbench.notifications.bottomleft',
		defaultMessage: 'Bottom left',
		description: 'Bottom-left notification placement.'
	}),
	topRight: defineMessage({
		id: 'workbench.notifications.topright',
		defaultMessage: 'Top right',
		description: 'Top-right notification placement.'
	}),
	cancel: defineMessage({
		id: 'workbench.notifications.cancel',
		defaultMessage: 'Cancel',
		description: 'Request cancellation of a notification operation.'
	}),
	actionFailed: defineMessage({
		id: 'workbench.notifications.actionfailed',
		defaultMessage: 'The action could not be completed.',
		description: 'Safe failure text; diagnostic details remain privileged.'
	}),
	progress: defineMessage({
		id: 'workbench.notifications.progress',
		defaultMessage: 'In progress',
		description: 'Accessible name for running notification progress.'
	}),
	source: defineMessage({
		id: 'workbench.notifications.source',
		defaultMessage: 'Source: {label}',
		description: 'Notification source.'
	}),
	unread: defineMessage({
		id: 'workbench.notifications.unread',
		defaultMessage: 'Notifications: {count} new, {progress} in progress',
		description: 'Accessible notification indicator and tooltip.'
	})
};
export function createNotificationLabels(locale: string): NotificationLabels {
	const localization = createLocalization({
		requestedLocale: locale,
		messages: Object.values(notificationMessages),
		catalogs: []
	});
	const labels = Object.fromEntries(
		Object.entries(notificationMessages)
			.filter(([key]) => key !== 'source' && key !== 'unread')
			.map(([key, value]) => [key, localization.format(value)])
	);
	return {
		...labels,
		source: (label: string) => localization.format(notificationMessages.source, { label }),
		unread: (count: number, progress: number) =>
			localization.format(notificationMessages.unread, { count, progress }),
		accessible: (item) =>
			withSeverityPrefix(
				`${item.message.raw}${item.source ? '. ' + localization.format(notificationMessages.source, { label: item.source }) : ''}`,
				item.severity
			)
	} as NotificationLabels;
}
