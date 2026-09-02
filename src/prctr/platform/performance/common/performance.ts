import { clearMarks, getMarks, mark, type PerformanceMark } from '../../../base/common/performance.js';

export interface PerformanceBudget {
	readonly id: `prctr.${string}`;
	readonly owner: string;
	readonly startMark: `prctr/${string}`;
	readonly endMark: `prctr/${string}`;
	readonly maximumDurationMs: number;
}

export interface PerformanceMeasurement extends PerformanceBudget {
	readonly startTime: number;
	readonly endTime: number;
	readonly durationMs: number;
	readonly withinBudget: boolean;
}

export interface PerformanceSnapshot {
	readonly marks: readonly PerformanceMark[];
	readonly measurements: readonly PerformanceMeasurement[];
	readonly missingBudgets: readonly PerformanceBudget[];
}

export class PerformanceBudgetRegistry {
	private readonly budgets = new Map<string, PerformanceBudget>();

	register(budget: PerformanceBudget): void {
		if (this.budgets.has(budget.id)) {
			throw new Error(`Performance budget ${budget.id} is already registered`);
		}
		if (!Number.isFinite(budget.maximumDurationMs) || budget.maximumDurationMs <= 0) {
			throw new TypeError(`Performance budget ${budget.id} must have a positive finite duration`);
		}
		this.budgets.set(budget.id, Object.freeze({ ...budget }));
	}

	all(): readonly PerformanceBudget[] {
		return Object.freeze([...this.budgets.values()]);
	}
}

export class PerformanceService {
	constructor(private readonly registry: PerformanceBudgetRegistry) {}

	mark(name: `prctr/${string}`, startTime?: number): void {
		mark(name, startTime === undefined ? undefined : { startTime });
	}

	clear(name?: `prctr/${string}`): void {
		clearMarks(name);
	}

	snapshot(): PerformanceSnapshot {
		const marks = Object.freeze(getMarks().map(entry => Object.freeze({ name: entry.name, startTime: entry.startTime })).sort((left, right) => left.startTime - right.startTime));
		const byName = new Map<string, PerformanceMark>();
		for (const entry of marks) {
			byName.set(entry.name, entry);
		}
		const measurements: PerformanceMeasurement[] = [];
		const missingBudgets: PerformanceBudget[] = [];
		for (const budget of this.registry.all()) {
			const start = byName.get(budget.startMark);
			const end = byName.get(budget.endMark);
			if (start === undefined || end === undefined || end.startTime < start.startTime) {
				missingBudgets.push(budget);
				continue;
			}
			const durationMs = end.startTime - start.startTime;
			measurements.push(Object.freeze({
				...budget,
				startTime: start.startTime,
				endTime: end.startTime,
				durationMs,
				withinBudget: durationMs <= budget.maximumDurationMs
			}));
		}
		return Object.freeze({
			marks,
			measurements: Object.freeze(measurements),
			missingBudgets: Object.freeze(missingBudgets)
		});
	}
}
