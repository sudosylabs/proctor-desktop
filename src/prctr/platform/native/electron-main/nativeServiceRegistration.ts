/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

/** Fixed main-process setup capability. Registration is not native-source readiness. */
const SERVICE = Object.freeze({
	type: 'daemonService',
	serviceName: 'com.proctor.native.plist'
} as const);

export type NativeServiceRegistrationState =
	'not-registered' | 'enabled' | 'requires-approval' | 'not-found';

export type NativeServiceRegistrationStatus =
	| { readonly state: NativeServiceRegistrationState }
	| {
			readonly state: 'unavailable';
			readonly reason:
				| 'unsupported_platform'
				| 'development_build'
				| 'application_not_ready'
				| 'inspection_failed';
	  };

/** Structural subset of Electron App. No arbitrary service, path or arguments. */
export interface NativeServiceRegistrationApp {
	readonly isPackaged: boolean;
	readonly isReady: () => boolean;
	readonly getLoginItemSettings: (options: typeof SERVICE) => { readonly status?: unknown };
	readonly setLoginItemSettings: (
		settings: typeof SERVICE & { readonly openAtLogin: boolean }
	) => void;
}

export type NativeServiceRegistrationErrorCode =
	'setup_blocked' | 'registration_unavailable' | 'registration_failed' | 'unregistration_failed';

export class NativeServiceRegistrationError extends Error {
	public readonly code: NativeServiceRegistrationErrorCode;
	public constructor(code: NativeServiceRegistrationErrorCode) {
		super(`native service registration failed: ${code}`);
		this.name = 'NativeServiceRegistrationError';
		this.code = code;
	}
}

export interface NativeServiceRegistrationOptions {
	readonly app: NativeServiceRegistrationApp;
	readonly platform: string;
	/** Darwin 22 is macOS 13, the first SMAppService daemon target. */
	readonly darwinMajor: number;
	/** Trusted main owner includes active Participation, Candidate and preflight. */
	readonly isSetupBlocked: () => boolean;
}

export const INativeServiceRegistration = createDecorator<INativeServiceRegistration>(
	'nativeServiceRegistration'
);

/** Main-owned setup service. Registration never grants source or admission readiness. */
export interface INativeServiceRegistration {
	readonly _serviceBrand: undefined;
	inspect(): NativeServiceRegistrationStatus;
	registerDuringSetup(): NativeServiceRegistrationStatus;
	unregisterDuringSetup(): NativeServiceRegistrationStatus;
}

export class NativeServiceRegistration implements INativeServiceRegistration {
	declare readonly _serviceBrand: undefined;
	readonly #options: NativeServiceRegistrationOptions;
	#changing = false;

	public constructor(options: NativeServiceRegistrationOptions) {
		this.#options = options;
	}

	/** Read on demand. Enabled means registered; it says nothing about ES/FDA or admission. */
	public inspect(): NativeServiceRegistrationStatus {
		const { app, platform, darwinMajor } = this.#options;
		if (platform !== 'darwin' || !Number.isInteger(darwinMajor) || darwinMajor < 22) {
			return Object.freeze({ state: 'unavailable', reason: 'unsupported_platform' });
		}
		if (!app.isPackaged)
			return Object.freeze({ state: 'unavailable', reason: 'development_build' });
		if (!app.isReady())
			return Object.freeze({ state: 'unavailable', reason: 'application_not_ready' });
		try {
			const { status } = app.getLoginItemSettings(SERVICE);
			switch (status) {
				case 'not-registered':
				case 'enabled':
				case 'requires-approval':
				case 'not-found':
					return Object.freeze({ state: status });
				default:
					return Object.freeze({ state: 'unavailable', reason: 'inspection_failed' });
			}
		} catch {
			return Object.freeze({ state: 'unavailable', reason: 'inspection_failed' });
		}
	}

	/** Explicit setup action only; never called from construction, inspection or source open. */
	public registerDuringSetup(): NativeServiceRegistrationStatus {
		return this.#change(true);
	}

	/** Unregistration is not proof that an existing privileged worker terminated. */
	public unregisterDuringSetup(): NativeServiceRegistrationStatus {
		return this.#change(false);
	}

	#change(register: boolean): NativeServiceRegistrationStatus {
		this.#assertSetupAllowed();
		this.#changing = true;
		try {
			const before = this.inspect();
			if (before.state === 'unavailable' || before.state === 'not-found') {
				throw new NativeServiceRegistrationError('registration_unavailable');
			}
			if (before.state === (register ? 'enabled' : 'not-registered')) return before;
			// Readiness/status queries may re-enter application code. Recheck the
			// privileged owner immediately before the synchronous OS mutation.
			if (this.#options.isSetupBlocked())
				throw new NativeServiceRegistrationError('setup_blocked');
			try {
				this.#options.app.setLoginItemSettings({ ...SERVICE, openAtLogin: register });
			} catch {
				throw new NativeServiceRegistrationError(
					register ? 'registration_failed' : 'unregistration_failed'
				);
			}
			return this.inspect();
		} finally {
			this.#changing = false;
		}
	}

	#assertSetupAllowed(): void {
		if (this.#changing || this.#options.isSetupBlocked()) {
			throw new NativeServiceRegistrationError('setup_blocked');
		}
	}
}
