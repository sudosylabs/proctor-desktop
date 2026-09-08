import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

export type NotificationPosition = 'bottom-right' | 'bottom-left' | 'top-right';
/** Private compatibility seam for the model's position helper. */
export interface NotificationConfiguration {
	getValue<T>(key: string): T | undefined;
}
export class NotificationPreferences extends Disposable implements NotificationConfiguration {
	readonly #change = this._register(new Emitter<void>());
	readonly onDidChange = this.#change.event;
	#position: NotificationPosition = 'bottom-right';
	constructor(
		private readonly persistence?: {
			read(): unknown;
			write(position: NotificationPosition): void;
		}
	) {
		super();
		const value = persistence?.read();
		if (isPosition(value)) this.#position = value;
	}
	get position(): NotificationPosition {
		return this.#position;
	}
	setPosition(value: NotificationPosition): void {
		if (!isPosition(value)) throw new Error('Invalid notification position');
		if (value === this.#position) return;
		this.#position = value;
		this.persistence?.write(value);
		this.#change.fire();
	}
	getValue<T>(key: string): T | undefined {
		return (key === 'workbench.notifications.position' ? this.#position : undefined) as
			T | undefined;
	}
}
function isPosition(value: unknown): value is NotificationPosition {
	return value === 'bottom-right' || value === 'bottom-left' || value === 'top-right';
}
