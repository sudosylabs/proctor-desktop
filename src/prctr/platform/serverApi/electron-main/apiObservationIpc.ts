import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import type { ApiSubscription } from '../common/apiObservation.js';

/**
 * Private helper for separately authorized capability channels; never accepts an API operation/URL.
 * Every publication is authorized again against the frame that started the observation, so a
 * later lookup of the invoking event can never silently drop an answer. An answer that cannot be
 * delivered as data becomes `failure`, so the renderer always learns how its observation ended.
 */
export class ApiObservationIpc<I, R> {
	private readonly subscriptions = new Map<number, ApiSubscription>();
	private disposed = false;
	constructor(
		private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		private readonly channel: string,
		validateIntent: (value: unknown) => I,
		validateResponse: (value: unknown) => R,
		authorize: (event: IpcMainInvokeEvent) => void,
		observe: (intent: I, listener: (response: R) => void) => ApiSubscription,
		failure?: R
	) {
		ipc.handle(channel, (event, raw: unknown, ...extra: unknown[]) => {
			// The frame that started the observation; `event.senderFrame` is a lookup, not a handle.
			const frame = event.senderFrame;
			const origin = { sender: event.sender, senderFrame: frame } as IpcMainInvokeEvent;
			authorize(origin);
			if (
				this.disposed ||
				extra.length ||
				!raw ||
				typeof raw !== 'object' ||
				Array.isArray(raw)
			)
				throw new TypeError('Invalid observation');
			const value = raw as Record<string, unknown>;
			if (
				!Number.isSafeInteger(value.id) ||
				Number(value.id) < 1 ||
				Object.keys(value).some((key) => !['id', 'kind', 'intent'].includes(key))
			)
				throw new TypeError('Invalid observation');
			if (value.kind !== 'start' && value.kind !== 'stop')
				throw new TypeError('Invalid observation');
			if (value.kind === 'stop' && 'intent' in value)
				throw new TypeError('Invalid observation');
			const intent = value.kind === 'start' ? validateIntent(value.intent) : undefined;
			const id = Number(value.id);
			this.subscriptions.get(id)?.dispose();
			this.subscriptions.delete(id);
			if (value.kind === 'stop') return;
			if (value.kind !== 'start' || this.subscriptions.size >= 64)
				throw new TypeError('Invalid observation');
			let active = true;
			const end = (): void => {
				active = false;
				this.subscriptions.get(id)?.dispose();
				this.subscriptions.delete(id);
			};
			const subscription = observe(intent as I, (response) => {
				if (this.disposed || !active) return;
				try {
					authorize(origin);
				} catch {
					end();
					return;
				}
				let payload: R;
				try {
					payload = validateResponse(response);
				} catch {
					if (failure === undefined) {
						end();
						return;
					}
					payload = failure;
				}
				try {
					frame?.send(`${channel}:change`, { id, response: payload });
				} catch {
					end();
				}
			});
			if (active && !this.disposed)
				this.subscriptions.set(id, {
					dispose: () => {
						active = false;
						subscription.dispose();
					}
				});
			else subscription.dispose();
		});
	}
	dispose(): void {
		this.disposed = true;
		for (const subscription of this.subscriptions.values()) subscription.dispose();
		this.subscriptions.clear();
		this.ipc.removeHandler(this.channel);
	}
}
