/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export type SecurityUtilityLifecycleState =
	'idle' | 'starting' | 'active' | 'stopping' | 'failed_closed';

export const ISecurityUtilityLifecycle = createDecorator<ISecurityUtilityLifecycle>(
	'securityUtilityLifecycle'
);

/** One monotonic utility lifetime. A failed generation can never become active again. */
export interface ISecurityUtilityLifecycle {
	readonly _serviceBrand: undefined;
	readonly state: SecurityUtilityLifecycleState;
	beginLaunch(): number | undefined;
	activate(generation: number): boolean;
	beginStopping(generation: number): boolean;
	completeStop(generation: number): boolean;
	fail(generation: number): boolean;
	isActive(generation: number): boolean;
}

export class SecurityUtilityLifecycle implements ISecurityUtilityLifecycle {
	declare readonly _serviceBrand: undefined;
	#state: SecurityUtilityLifecycleState = 'idle';
	#generation = 0;

	public get state(): SecurityUtilityLifecycleState {
		return this.#state;
	}

	public beginLaunch(): number | undefined {
		if (this.#state !== 'idle') return undefined;
		if (this.#generation >= Number.MAX_SAFE_INTEGER) {
			this.#state = 'failed_closed';
			return undefined;
		}
		this.#generation += 1;
		this.#state = 'starting';
		return this.#generation;
	}

	public activate(generation: number): boolean {
		if (generation !== this.#generation || this.#state !== 'starting') return false;
		this.#state = 'active';
		return true;
	}

	public beginStopping(generation: number): boolean {
		if (generation !== this.#generation || this.#state !== 'active') return false;
		this.#state = 'stopping';
		return true;
	}

	public completeStop(generation: number): boolean {
		if (generation !== this.#generation || this.#state !== 'stopping') return false;
		this.#state = 'idle';
		return true;
	}

	public fail(generation: number): boolean {
		if (generation !== this.#generation) return false;
		if (this.#state !== 'starting' && this.#state !== 'active' && this.#state !== 'stopping') {
			return false;
		}
		this.#state = 'failed_closed';
		return true;
	}

	public isActive(generation: number): boolean {
		return generation === this.#generation && this.#state === 'active';
	}
}
