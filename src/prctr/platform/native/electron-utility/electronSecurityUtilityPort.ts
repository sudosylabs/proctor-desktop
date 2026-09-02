import type { MessageEvent } from 'electron';
import type { SecurityUtilityPort } from '../common/securityUtilityPort.js';

type UtilityMessagePort = MessageEvent['ports'][number];

export function electronSecurityUtilityPort(port: UtilityMessagePort): SecurityUtilityPort {
	return {
		postMessage: (message) => port.postMessage(message),
		onMessage: (listener) => {
			const handler = (event: MessageEvent): void => listener(event.data);
			port.on('message', handler);
			return { dispose: () => port.off('message', handler) };
		},
		onClose: (listener) => {
			port.on('close', listener);
			return { dispose: () => port.off('close', listener) };
		},
		start: () => port.start(),
		close: () => port.close()
	};
}
