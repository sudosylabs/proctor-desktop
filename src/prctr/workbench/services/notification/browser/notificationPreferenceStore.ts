import type {
	NotificationPreferenceStore,
	NotificationStorageScope
} from '../common/notificationStorage.js';
import type { NotificationPosition } from '../common/notificationPreferences.js';

export interface NotificationPreferenceBinding {
	readonly principalId?: string;
	readonly institutionOrigin?: string;
	readonly attemptId?: string;
}
/** Versioned, non-sensitive presentation only. Each key is bound to the current principal/Attempt. */
export class BrowserNotificationPreferenceStore implements NotificationPreferenceStore {
	constructor(
		private readonly storage: Storage | undefined,
		private readonly binding: NotificationPreferenceBinding
	) {}
	private key(scope: NotificationStorageScope, key: string): string | undefined {
		if (scope === 'principalComposition' && !this.binding.principalId) return undefined;
		if (scope === 'attemptPresentation' && !this.binding.attemptId) return undefined;
		return JSON.stringify([
			'prctr.notifications',
			1,
			scope,
			scope === 'device' ? '' : this.binding.institutionOrigin,
			scope === 'device' ? '' : this.binding.principalId,
			scope === 'attemptPresentation' ? this.binding.attemptId : '',
			key
		]);
	}
	read(scope: NotificationStorageScope, key: string): unknown {
		const bound = this.key(scope, key);
		if (!bound) return undefined;
		try {
			const value = this.storage?.getItem(bound);
			return value ? (JSON.parse(value) as unknown) : undefined;
		} catch {
			return undefined;
		}
	}
	write(scope: NotificationStorageScope, key: string, value: unknown): void {
		const bound = this.key(scope, key);
		if (bound)
			try {
				this.storage?.setItem(bound, JSON.stringify(value));
			} catch {
				/* Current window retains its validated value. */
			}
	}
	readonly position = {
		read: (): unknown => this.read('device', 'position'),
		write: (position: NotificationPosition): void => this.write('device', 'position', position)
	};
}
