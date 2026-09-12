/** Private compatibility seam for the packaged VS Code preview scripts. */
export interface WebviewApi<State> {
	getState(): State | undefined;
	setState(state: State | undefined): State | undefined;
	postMessage(message: unknown): void;
}

declare global {
	function acquireVsCodeApi<State = unknown>(): WebviewApi<State>;
}

/** Runs only inside an opaque-origin sandbox, before the copied preview script. */
export function installPreviewApi(): void {
	let state: unknown;
	let acquired = false;
	let channel: MessagePort | undefined;
	const pending: unknown[] = [];
	const api: WebviewApi<unknown> = {
		getState: () => state,
		setState: (next) => {
			state = next;
			return next;
		},
		postMessage: (message) => {
			if (channel) {
				channel.postMessage(message);
			} else if (pending.length < 32) {
				pending.push(message);
			}
		}
	};
	Object.defineProperty(globalThis, 'acquireVsCodeApi', {
		value: () => {
			if (acquired) {
				throw new Error('Preview API already acquired');
			}
			acquired = true;
			return api;
		}
	});
	const connect = (event: MessageEvent): void => {
		if (
			channel ||
			event.source !== window.parent ||
			event.data?.type !== 'proctor-preview-connect' ||
			event.ports.length !== 1
		) {
			return;
		}
		channel = event.ports[0];
		event.stopImmediatePropagation();
		window.removeEventListener('message', connect);
		channel.onmessage = ({ data }) => {
			if (data?.type === 'proctor-preview-theme') {
				if (
					typeof data.css === 'string' &&
					data.css.length <= 256 * 1024 &&
					!/[<>]/.test(data.css) &&
					Array.isArray(data.classes)
				) {
					const style = document.getElementById('proctor-preview-theme');
					if (style) {
						style.textContent = data.css;
					}
					for (const name of [
						'vscode-dark',
						'vscode-light',
						'vscode-high-contrast',
						'vscode-high-contrast-light'
					]) {
						document.body.classList.toggle(name, data.classes.includes(name));
					}
				}
				return;
			}
			window.dispatchEvent(
				new MessageEvent('message', { data, source: window, origin: window.origin })
			);
		};
		channel.start();
		for (const message of pending.splice(0)) {
			channel.postMessage(message);
		}
	};
	window.addEventListener('message', connect);
	window.addEventListener(
		'pagehide',
		() => {
			channel?.close();
			pending.length = 0;
		},
		{ once: true }
	);
}
