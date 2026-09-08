/** Internal translation of upstream suppression scopes into explicitly bound Proctor storage. */
export enum StorageScope {
	APPLICATION,
	PROFILE,
	WORKSPACE
}
export enum StorageTarget {
	USER,
	MACHINE
}
export type NotificationStorageScope = 'device' | 'principalComposition' | 'attemptPresentation';
export interface NotificationPreferenceStore {
	read(scope: NotificationStorageScope, key: string): unknown;
	write(scope: NotificationStorageScope, key: string, value: unknown): void;
}
export interface IStorageService {
	getBoolean(key: string, scope: StorageScope, fallback?: boolean): boolean;
	getObject<T>(key: string, scope: StorageScope, fallback: T): T;
	store(key: string, value: unknown, scope: StorageScope, target: StorageTarget): void;
}
/** No messages, error details, credentials, or executable actions enter this store. */
export class NotificationStorage implements IStorageService {
	readonly #session = new Map<string, unknown>();
	constructor(private readonly persistence?: NotificationPreferenceStore) {}
	private read(key: string, scope: StorageScope): unknown {
		try {
			return (
				this.#session.get(`${scope}:${key}`) ??
				this.persistence?.read(this.scope(scope), key)
			);
		} catch {
			return this.#session.get(`${scope}:${key}`);
		}
	}
	getBoolean(key: string, scope: StorageScope, fallback = false): boolean {
		const value = this.read(key, scope);
		return typeof value === 'boolean' ? value : fallback;
	}
	getObject<T>(key: string, scope: StorageScope, fallback: T): T {
		const value = this.read(key, scope);
		// The only structured upstream preference is the bounded source-filter catalog.
		if (!Array.isArray(value)) return fallback;
		return value
			.slice(0, 256)
			.filter(
				(entry: unknown) =>
					typeof entry === 'object' &&
					entry !== null &&
					'id' in entry &&
					typeof entry.id === 'string' &&
					entry.id.length <= 128 &&
					'label' in entry &&
					typeof entry.label === 'string' &&
					entry.label.length <= 256 &&
					'filter' in entry &&
					(entry.filter === 0 || entry.filter === 1)
			) as T;
	}
	store(key: string, value: unknown, scope: StorageScope, _target: StorageTarget): void {
		if (key.length > 256) throw new Error('Notification preference key exceeds its bound');
		if (typeof value === 'string') {
			try {
				value = JSON.parse(value) as unknown;
			} catch {
				return;
			}
		}
		if (typeof value !== 'boolean' && !Array.isArray(value))
			throw new Error('Invalid notification preference');
		this.#session.set(`${scope}:${key}`, value);
		try {
			this.persistence?.write(this.scope(scope), key, value);
		} catch {
			/* Retain current-window preference if persistence is unavailable. */
		}
	}
	private scope(scope: StorageScope): NotificationStorageScope {
		return scope === StorageScope.APPLICATION
			? 'device'
			: scope === StorageScope.PROFILE
				? 'principalComposition'
				: 'attemptPresentation';
	}
}
