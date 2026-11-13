/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	Fact,
	Gap,
	Policy,
	Reset,
	RuleStatus
} from '../../../../platform/native/common/nativeAgentProtocol.generated.js';
import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';

export type NativeRecord = components['schemas']['NativeRecord'];

/**
 * The agent's monotonic clock in wall time. The agent stamps facts with monotonic milliseconds;
 * every heartbeat pairs one monotonic reading with the wall time it arrived, and the latest pair
 * converts later readings. Before the first heartbeat a reading is taken as arriving now.
 */
export class AgentClock {
	private offset: number | undefined;

	public constructor(private readonly now: () => number = Date.now) {}

	public heartbeat(monotonicMs: number): void {
		this.offset = this.now() - monotonicMs;
	}

	public wall(monotonicMs: number): number {
		return this.offset === undefined ? this.now() : monotonicMs + this.offset;
	}
}

function iso(ms: number): string {
	return new Date(ms).toISOString();
}

type FactBody = components['schemas']['NativeCapabilityFact']['state'];

/**
 * A fact's state or summary. The server's schema leaves both free-form here and checks them
 * against the registry's fact schemas, so only their object shape is checked on this side.
 */
function object(value: unknown): FactBody {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('a native fact state or summary is not an object');
	return value as FactBody;
}

const GAP_REASON = { source_loss: 'source_loss', flow_control: 'overflow' } as const;

/**
 * Turns the agent's notifications into the server's native delivery records for one
 * Participation. Rule statuses are sent only for participation rules, only once participation is
 * confirmed, and only when a rule's status or the containment it causes changes.
 */
export class NativeRecordMapper {
	private readonly participationRules: ReadonlySet<string>;
	private readonly sent = new Map<string, string>();
	private confirmed = false;

	public constructor(
		policy: Policy,
		private readonly clock: AgentClock,
		private readonly now: () => number = Date.now
	) {
		this.participationRules = new Set(
			policy.rules.filter((rule) => rule.phase !== 'readiness').map((rule) => rule.rule_id)
		);
	}

	public fact(fact: Fact): NativeRecord {
		return {
			kind: 'capability_fact',
			observed_at: iso(this.clock.wall(fact.captured_at_ms)),
			capability: fact.capability,
			source_instance_id: fact.source_instance_id,
			sequence: fact.sequence,
			permission: fact.envelope.permission,
			health: fact.envelope.health,
			certainty: fact.envelope.certainty,
			state: object(fact.state),
			summary: object(fact.summary)
		};
	}

	public gap(gap: Gap): NativeRecord {
		return {
			kind: 'source_gap',
			capability: gap.capability,
			source_instance_id: gap.source_instance_id,
			first_missing_sequence: gap.first_sequence,
			last_missing_sequence: gap.last_sequence,
			reason: GAP_REASON[gap.reason],
			occurred_at: iso(this.now())
		};
	}

	/** A source restarted: `resetId` names this reset uniquely within the stream. */
	public reset(
		reset: Reset,
		resetId: string,
		reason: 'restart' | 'resume' | 'permission_changed' = 'restart'
	): NativeRecord {
		return {
			kind: 'source_reset',
			reset_id: resetId,
			capability: reset.capability,
			previous_source_instance_id: reset.previous_source_instance_id,
			previous_final_sequence: reset.previous_sequence,
			new_source_instance_id: reset.source_instance_id,
			reason,
			occurred_at: iso(this.now())
		};
	}

	/** Participation is confirmed; from here on participation rules are reported. */
	public participationConfirmed(): NativeRecord {
		this.confirmed = true;
		return { kind: 'participation_confirmed', observed_at: iso(this.now()) };
	}

	public rules(statuses: readonly RuleStatus[], contained: boolean): readonly NativeRecord[] {
		if (!this.confirmed) return [];
		const records: NativeRecord[] = [];
		for (const status of statuses) {
			if (!this.participationRules.has(status.rule_id)) continue;
			const cause =
				status.status === 'unknown' ? (status.unknown_cause ?? undefined) : undefined;
			const key = `${status.status}|${cause ?? ''}|${contained ? 1 : 0}`;
			if (this.sent.get(status.rule_id) === key) continue;
			this.sent.set(status.rule_id, key);
			records.push({
				kind: 'rule_status',
				rule_id: status.rule_id,
				status: status.status,
				...(cause === undefined ? {} : { unknown_cause: cause }),
				contained,
				observed_at: iso(this.now())
			});
		}
		return records;
	}
}
