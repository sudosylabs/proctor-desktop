export interface SecurityUtilityPort {
	readonly postMessage: (message: unknown) => void;
	readonly onMessage: (listener: (message: unknown) => void) => { readonly dispose: () => void };
	readonly onClose: (listener: () => void) => { readonly dispose: () => void };
	readonly start: () => void;
	readonly close: () => void;
}
