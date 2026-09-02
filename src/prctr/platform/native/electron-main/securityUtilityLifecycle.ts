export type SecurityUtilityLifecycleState =
	'idle' | 'starting' | 'active' | 'stopping' | 'failed_closed';

export class SecurityUtilityLifecycle {
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
