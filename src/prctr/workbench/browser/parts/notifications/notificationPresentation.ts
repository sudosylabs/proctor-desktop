import type { Event } from '../../../../base/common/event.js';
import type { INotificationViewItem } from '../../../common/notifications.js';

/** Effect adapters are selected by the window composition. They authorize at execution. */
export interface NotificationEffects {
	readonly openLink?: (href: string) => Promise<void>;
	readonly copyText?: (text: string) => Promise<void>;
	readonly onActionError: () => void;
	readonly canInteract: () => boolean;
	readonly onDidChangeInteraction: Event<void>;
	readonly restoreFocus: () => void;
}
export interface NotificationGeometry {
	readonly width: number;
	readonly height: number;
	readonly top: number;
	readonly bottom: number;
}
export interface NotificationLabels {
	readonly notifications: string;
	readonly empty: string;
	readonly close: string;
	readonly clearAll: string;
	readonly hide: string;
	readonly expand: string;
	readonly collapse: string;
	readonly more: string;
	readonly copy: string;
	readonly read: string;
	readonly previous: string;
	readonly next: string;
	readonly mute: string;
	readonly position: string;
	readonly sources: string;
	readonly bottomRight: string;
	readonly bottomLeft: string;
	readonly topRight: string;
	readonly cancel: string;
	readonly actionFailed: string;
	readonly progress: string;
	source(label: string): string;
	unread(count: number, progress: number): string;
	accessible(item: INotificationViewItem): string;
}
