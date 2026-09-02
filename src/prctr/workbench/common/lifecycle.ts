/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { lifecyclePhaseOrdinal, type WorkbenchContributionDescriptor, type WorkbenchLifecyclePhase } from './composition.js';

export const WORKBENCH_LIFECYCLE_SERVICE = 'prctr.workbench.service.lifecycle';

export interface WorkbenchContribution extends WorkbenchContributionDescriptor {
	activate(): void | Promise<void>;
}

export interface ContributionActivationResult {
	readonly id: string;
	readonly state: 'activated' | 'failed' | 'skipped';
	readonly error?: unknown;
}

export class WorkbenchLifecycleService extends Disposable {
	readonly #phaseEmitter = this._register(new Emitter<WorkbenchLifecyclePhase>());
	readonly onDidAdvancePhase: Event<WorkbenchLifecyclePhase> = this.#phaseEmitter.event;
	#phase: WorkbenchLifecyclePhase | undefined;
	get phase(): WorkbenchLifecyclePhase | undefined { return this.#phase; }
	advance(phase: WorkbenchLifecyclePhase): void {
		if (this.#phase !== undefined && lifecyclePhaseOrdinal(phase) <= lifecyclePhaseOrdinal(this.#phase)) throw new Error(`Lifecycle cannot move from ${this.#phase} to ${phase}`);
		this.#phase = phase; this.#phaseEmitter.fire(phase);
	}
}

export class WorkbenchContributionActivator {
	readonly #contributions: ReadonlyMap<string, WorkbenchContribution>;
	readonly #results = new Map<string, ContributionActivationResult>();
	readonly #earlyBlockerAllowlist: ReadonlySet<string>;
	constructor(contributions: readonly WorkbenchContribution[], earlyBlockerAllowlist: ReadonlySet<string>) {
		this.#earlyBlockerAllowlist = earlyBlockerAllowlist;
		this.#contributions = new Map(contributions.map(value => [value.id, value]));
		if (this.#contributions.size !== contributions.length) throw new Error('Contribution implementations must have unique ids');
		for (const contribution of contributions) {
			if (contribution.blocksPhase && !this.#earlyBlockerAllowlist.has(contribution.id)) throw new Error(`Contribution ${contribution.id} is not allowed to block an early phase`);
			for (const dependency of contribution.dependencies ?? []) if (!this.#contributions.has(dependency)) throw new Error(`Contribution implementation ${contribution.id} depends on missing ${dependency}`);
		}
	}
	get results(): readonly ContributionActivationResult[] { return Object.freeze([...this.#results.values()]); }
	async activateThrough(phase: WorkbenchLifecyclePhase): Promise<readonly ContributionActivationResult[]> {
		for (const contribution of this.#contributions.values()) {
			if (lifecyclePhaseOrdinal(contribution.phase) <= lifecyclePhaseOrdinal(phase)) await this.#activate(contribution.id, new Set());
		}
		return this.results;
	}
	async #activate(id: string, visiting: Set<string>): Promise<ContributionActivationResult> {
		const prior = this.#results.get(id); if (prior !== undefined) return prior;
		if (visiting.has(id)) throw new Error(`Contribution activation dependency cycle includes ${id}`);
		const contribution = this.#contributions.get(id); if (contribution === undefined) throw new Error(`Unknown contribution ${id}`);
		visiting.add(id);
		for (const dependency of contribution.dependencies ?? []) {
			const result = await this.#activate(dependency, visiting);
			if (result.state !== 'activated') {
				const skipped = Object.freeze({ id, state: 'skipped' as const, error: new Error(`Dependency ${dependency} did not activate`) });
				this.#results.set(id, skipped); visiting.delete(id); return skipped;
			}
		}
		try {
			await contribution.activate();
			const result = Object.freeze({ id, state: 'activated' as const }); this.#results.set(id, result); visiting.delete(id); return result;
		} catch (error) {
			const result = Object.freeze({ id, state: 'failed' as const, error }); this.#results.set(id, result); visiting.delete(id); return result;
		}
	}
}
