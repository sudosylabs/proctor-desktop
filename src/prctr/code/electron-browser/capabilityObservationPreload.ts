import { ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IDisposable } from '../../base/common/lifecycle.js';

let sequence = 0;
/** Constructed only for literal, capability-specific channels by the owning preload. */
export function createCapabilityObserver<I, R>(
	channel: string,
	validateIntent: (value: unknown) => I,
	validateResponse: (value: unknown) => R,
	failure: R
): (intent: I, listener: (response: R) => void) => IDisposable {
	return (intent, listener) => {
		const request = validateIntent(intent);
		const id = ++sequence;
		let disposed = false;
		const changed = (_event: IpcRendererEvent, raw: unknown) => {
			if (disposed || !raw || typeof raw !== 'object') return;
			const value = raw as Record<string, unknown>;
			if (value.id !== id) return;
			let response: R;
			try {
				response = validateResponse(value.response);
			} catch {
				// An answer this window cannot trust still ends the wait, as a failure.
				response = failure;
			}
			listener(response);
		};
		ipcRenderer.on(`${channel}:change`, changed);
		void ipcRenderer.invoke(channel, { kind: 'start', id, intent: request }).catch(() => {
			if (!disposed) listener(failure);
		});
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				ipcRenderer.removeListener(`${channel}:change`, changed);
				void ipcRenderer.invoke(channel, { kind: 'stop', id }).catch(() => {});
			}
		};
	};
}
