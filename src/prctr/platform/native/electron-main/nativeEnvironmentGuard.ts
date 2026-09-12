/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** Events that invalidate an uninterrupted native observation lifetime. */
export const NATIVE_ENVIRONMENT_INTERRUPTION_EVENTS = [
	'suspend',
	'resume',
	'lock-screen',
	'unlock-screen',
	'user-did-become-active',
	'user-did-resign-active'
] as const;

export type NativeEnvironmentInterruption = (typeof NATIVE_ENVIRONMENT_INTERRUPTION_EVENTS)[number];

export interface NativeEnvironmentEventSource {
	on(event: NativeEnvironmentInterruption, listener: () => void): unknown;
	off(event: NativeEnvironmentInterruption, listener: () => void): unknown;
}

/**
 * A source lifetime cannot survive sleep or an OS interactive-session boundary
 * merely because its next heartbeat arrives. Main fences it synchronously and
 * the admission owner must start fresh checks. Events never declare misconduct.
 */
export class NativeEnvironmentGuard {
	readonly #source: NativeEnvironmentEventSource;
	readonly #listeners = new Map<NativeEnvironmentInterruption, () => void>();
	#disposed = false;
	#interrupted = false;

	public constructor(
		source: NativeEnvironmentEventSource,
		onInterrupted: (event: NativeEnvironmentInterruption) => void
	) {
		this.#source = source;
		try {
			for (const event of NATIVE_ENVIRONMENT_INTERRUPTION_EVENTS) {
				const listener = (): void => {
					if (this.#disposed || this.#interrupted) return;
					this.#interrupted = true;
					// Fence before callbacks; reentrant events cannot resurrect or repeat this lifetime.
					try {
						onInterrupted(event);
					} finally {
						this.dispose();
					}
				};
				this.#listeners.set(event, listener);
				source.on(event, listener);
			}
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	public dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const [event, listener] of this.#listeners) this.#source.off(event, listener);
		this.#listeners.clear();
	}
}
