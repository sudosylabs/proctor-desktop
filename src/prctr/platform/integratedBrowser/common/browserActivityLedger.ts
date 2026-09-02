/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import type { BrowserActivityLocation, BrowserBlockedConsequence } from './browserPolicy.js';
import {
	validateBrowserActivityRecord,
	type BrowserActivityClock,
	type BrowserActivityDeliveryPort,
	type BrowserActivityGap,
	type BrowserActivityIdentity,
	type BrowserActivityKind,
	type BrowserActivityRecord,
	type BrowserActivityScope,
	type BrowserActivitySeal,
	type BrowserActivityState,
	type ProtectedBrowserActivityMutation,
	type ProtectedBrowserActivityPort
} from './browserActivity.js';

export type BrowserActivityLedgerHealth =
	'available' | 'corruptStore' | 'lostKey' | 'overflow' | 'storeUnavailable';
export interface BrowserActivityLedgerOptions {
	readonly scope: BrowserActivityScope;
	readonly capacity: number;
	readonly store: ProtectedBrowserActivityPort;
	readonly identity: BrowserActivityIdentity;
	readonly clock: BrowserActivityClock;
}
interface MutableBrowserActivityState {
	readonly schemaVersion: 1;
	readonly scope: BrowserActivityScope;
	readonly sourceInstanceId: string;
	highestAcknowledged: number;
	lastSequence: number;
	records: BrowserActivityRecord[];
	gaps: BrowserActivityGap[];
	sealed: boolean;
}
type ProtectedWrite =
	| { readonly kind: 'replace'; readonly state: BrowserActivityState }
	| { readonly kind: 'apply'; readonly mutations: ProtectedBrowserActivityMutation[] };

export class BrowserActivityLedger extends Disposable {
	readonly #options: BrowserActivityLedgerOptions;
	readonly #healthEmitter = this._register(new Emitter<BrowserActivityLedgerHealth>());
	readonly onDidChangeHealth: Event<BrowserActivityLedgerHealth> = this.#healthEmitter.event;
	#state: MutableBrowserActivityState;
	#health: BrowserActivityLedgerHealth;
	readonly #pendingWrites: ProtectedWrite[] = [];
	#writeInFlight: Promise<void> | undefined;
	#failedWrite: ProtectedWrite | undefined;
	#stateSerial: Promise<void> = Promise.resolve();
	private constructor(
		options: BrowserActivityLedgerOptions,
		state: BrowserActivityState,
		health: BrowserActivityLedgerHealth
	) {
		super();
		this.#options = options;
		this.#state = thawState(state);
		this.#health = health;
	}
	static async create(options: BrowserActivityLedgerOptions): Promise<BrowserActivityLedger> {
		if (
			!Number.isSafeInteger(options.capacity) ||
			options.capacity < 16 ||
			options.capacity > 65_536
		)
			throw new RangeError('Browser Activity capacity is outside packaged bounds');
		const normalizedOptions = Object.freeze({
			...options,
			scope: validateScope(options.scope)
		});
		const loaded = await normalizedOptions.store.load(normalizedOptions.scope);
		const sourceInstanceId = normalizedOptions.identity.nextSourceInstanceId();
		if (loaded.kind === 'available' && loaded.state !== undefined) {
			try {
				return new BrowserActivityLedger(
					normalizedOptions,
					validateState(
						loaded.state,
						normalizedOptions.scope,
						normalizedOptions.capacity
					),
					'available'
				);
			} catch {
				const ledger = new BrowserActivityLedger(
					normalizedOptions,
					freshState(normalizedOptions.scope, sourceInstanceId, 'corruptStore'),
					'corruptStore'
				);
				ledger.#persistReplace();
				await ledger.flush();
				return ledger;
			}
		}
		const gapReason = loaded.kind === 'available' ? undefined : loaded.kind;
		const ledger = new BrowserActivityLedger(
			normalizedOptions,
			freshState(normalizedOptions.scope, sourceInstanceId, gapReason),
			loaded.kind === 'available' ? 'available' : loaded.kind
		);
		if (gapReason !== undefined) {
			ledger.#persistReplace();
			await ledger.flush();
		}
		return ledger;
	}
	get health(): BrowserActivityLedgerHealth {
		return this.#health;
	}
	get scope(): BrowserActivityScope {
		return this.#options.scope;
	}
	get sourceInstanceId(): string {
		return this.#state.sourceInstanceId;
	}
	get lastSequence(): number {
		return this.#state.lastSequence;
	}
	append(
		kind: BrowserActivityKind,
		details: {
			readonly location?: BrowserActivityLocation;
			readonly matchedRuleId?: string;
			readonly blockedConsequence?: BrowserBlockedConsequence;
		} = {}
	): BrowserActivityRecord | undefined {
		if (this.#state.sealed) throw new Error('Browser Activity source is sealed');
		const sequence = this.#state.lastSequence + 1;
		if (!Number.isSafeInteger(sequence))
			throw new RangeError('Browser Activity sequence exhausted');
		if (this.#state.records.length >= this.#options.capacity) {
			const gap = Object.freeze({
				from: sequence,
				to: sequence,
				reason: 'overflow' as const
			});
			this.#state.lastSequence = sequence;
			appendGap(this.#state.gaps, gap);
			this.#setHealth('overflow');
			this.#persistMutation({ kind: 'appendGap', gap });
			return undefined;
		}
		const record = validateBrowserActivityRecord({
			sourceInstanceId: this.#state.sourceInstanceId,
			sequence,
			participationGeneration: this.#options.scope.participationGeneration,
			kind,
			clientOccurredAtMs: this.#options.clock.now(),
			...details
		});
		this.#state.lastSequence = sequence;
		this.#state.records.push(record);
		this.#persistMutation({ kind: 'appendRecord', record });
		return record;
	}
	pending(): readonly BrowserActivityRecord[] {
		return Object.freeze(
			this.#state.records.filter(
				(record) => record.sequence > this.#state.highestAcknowledged
			)
		);
	}
	deliver(port: BrowserActivityDeliveryPort): Promise<void> {
		return this.#enqueueState(async () => {
			const pending = this.pending();
			if (pending.length === 0) return;
			const deliveredThrough = pending.at(-1)?.sequence ?? this.#state.highestAcknowledged;
			const ack = await port.deliver(
				this.#options.scope,
				this.#state.sourceInstanceId,
				pending,
				this.#state.highestAcknowledged
			);
			await this.#acknowledge(
				ack.sourceInstanceId,
				ack.highestContiguousSequence,
				ack.requestedGaps,
				deliveredThrough
			);
		});
	}
	acknowledge(
		sourceInstanceId: string,
		highestContiguousSequence: number,
		requestedGaps: readonly number[]
	): Promise<void> {
		return this.#enqueueState(() =>
			this.#acknowledge(sourceInstanceId, highestContiguousSequence, requestedGaps)
		);
	}
	async #acknowledge(
		sourceInstanceId: string,
		highestContiguousSequence: number,
		requestedGaps: readonly number[],
		deliveredThrough = this.#state.lastSequence
	): Promise<void> {
		if (
			sourceInstanceId !== this.#state.sourceInstanceId ||
			!Number.isSafeInteger(highestContiguousSequence) ||
			highestContiguousSequence < this.#state.highestAcknowledged ||
			highestContiguousSequence > this.#state.lastSequence
		)
			throw new TypeError('Browser Activity acknowledgement is invalid');
		if (!Array.isArray(requestedGaps) || requestedGaps.length > this.#options.capacity)
			throw new TypeError('Browser Activity requested gaps exceed packaged bounds');
		const requested = new Set<number>();
		if (highestContiguousSequence > deliveredThrough)
			throw new TypeError('Browser Activity acknowledgement exceeds the delivered range');
		for (const value of requestedGaps) {
			if (
				!Number.isSafeInteger(value) ||
				value <= highestContiguousSequence ||
				value > deliveredThrough ||
				requested.has(value)
			)
				throw new TypeError('Browser Activity requested gap is invalid');
			requested.add(value);
		}
		await this.flush();
		this.#state.records = this.#state.records.filter(
			(record) =>
				record.sequence > highestContiguousSequence || requested.has(record.sequence)
		);
		this.#state.highestAcknowledged = highestContiguousSequence;
		this.#persistMutation(
			Object.freeze({
				kind: 'acknowledge',
				highestContiguousSequence,
				requestedGaps: Object.freeze([...requested])
			})
		);
		await this.flush();
	}
	seal(): BrowserActivitySeal {
		if (!this.#state.sealed) {
			this.#state.sealed = true;
			this.#persistMutation({ kind: 'seal', finalSequence: this.#state.lastSequence });
		}
		return Object.freeze({
			sourceInstanceId: this.#state.sourceInstanceId,
			participationGeneration: this.#options.scope.participationGeneration,
			highestAcknowledged: this.#state.highestAcknowledged,
			finalSequence: this.#state.lastSequence,
			gaps: Object.freeze([...this.#state.gaps]),
			sealed: true
		});
	}
	async flush(): Promise<void> {
		await this.#drainWrites();
		if (this.#failedWrite === undefined) return;
		this.#pendingWrites.unshift(this.#failedWrite);
		this.#failedWrite = undefined;
		this.#pumpWrite();
		await this.#drainWrites();
		if (this.#failedWrite !== undefined)
			throw new Error('Protected Browser Activity could not be persisted');
	}
	async #drainWrites(): Promise<void> {
		while (
			this.#failedWrite === undefined &&
			(this.#writeInFlight !== undefined || this.#pendingWrites.length > 0)
		) {
			this.#pumpWrite();
			const write = this.#writeInFlight;
			if (write !== undefined) await write;
		}
	}
	#persistReplace(): void {
		this.#pendingWrites.push(
			Object.freeze({ kind: 'replace', state: snapshotState(this.#state) })
		);
		this.#pumpWrite();
	}
	#persistMutation(mutation: ProtectedBrowserActivityMutation): void {
		const prior = this.#pendingWrites.at(-1);
		if (prior?.kind === 'apply') {
			const last = prior.mutations.at(-1);
			if (
				last?.kind === 'appendGap' &&
				mutation.kind === 'appendGap' &&
				last.gap.reason === mutation.gap.reason &&
				last.gap.to + 1 === mutation.gap.from
			)
				prior.mutations[prior.mutations.length - 1] = Object.freeze({
					kind: 'appendGap',
					gap: Object.freeze({ ...last.gap, to: mutation.gap.to })
				});
			else prior.mutations.push(Object.freeze(mutation));
		} else this.#pendingWrites.push({ kind: 'apply', mutations: [Object.freeze(mutation)] });
		this.#pumpWrite();
	}
	#pumpWrite(): void {
		if (this.#writeInFlight !== undefined || this.#failedWrite !== undefined) return;
		const write = this.#pendingWrites.shift();
		if (write === undefined) return;
		if (write.kind === 'apply') Object.freeze(write.mutations);
		let operation: Promise<void>;
		try {
			operation = Promise.resolve(
				write.kind === 'replace'
					? this.#options.store.replace(write.state)
					: this.#options.store.apply(
							this.#options.scope,
							this.#state.sourceInstanceId,
							write.mutations
						)
			);
		} catch (error) {
			operation = Promise.reject(error);
		}
		this.#writeInFlight = operation
			.then(
				() => {
					if (this.#health === 'storeUnavailable') this.#setHealth('available');
				},
				() => {
					this.#failedWrite = write;
					this.#setHealth('storeUnavailable');
				}
			)
			.finally(() => {
				this.#writeInFlight = undefined;
				if (this.#failedWrite === undefined) this.#pumpWrite();
			});
	}
	#enqueueState<T>(operation: () => Promise<T>): Promise<T> {
		const queued = this.#stateSerial.then(operation);
		this.#stateSerial = queued.then(
			() => {},
			() => {}
		);
		return queued;
	}
	#setHealth(health: BrowserActivityLedgerHealth): void {
		if (this.#health === health) return;
		this.#health = health;
		this.#healthEmitter.fire(health);
	}
}

function freshState(
	scope: BrowserActivityScope,
	sourceInstanceId: string,
	gapReason?: BrowserActivityGap['reason']
): BrowserActivityState {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(sourceInstanceId))
		throw new TypeError('Browser Activity source identity is invalid');
	return freezeState({
		schemaVersion: 1,
		scope,
		sourceInstanceId,
		highestAcknowledged: 0,
		lastSequence: gapReason === undefined ? 0 : 1,
		records: [],
		gaps: gapReason === undefined ? [] : [{ from: 1, to: 1, reason: gapReason }],
		sealed: false
	});
}
function validateState(
	value: unknown,
	scope: BrowserActivityScope,
	capacity: number
): BrowserActivityState {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'scope',
			'sourceInstanceId',
			'highestAcknowledged',
			'lastSequence',
			'records',
			'gaps',
			'sealed'
		]) ||
		value.schemaVersion !== 1 ||
		!sameScope(validateScope(value.scope), scope) ||
		typeof value.sourceInstanceId !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.sourceInstanceId) ||
		!Number.isSafeInteger(value.lastSequence) ||
		(value.lastSequence as number) < 0 ||
		!Number.isSafeInteger(value.highestAcknowledged) ||
		(value.highestAcknowledged as number) < 0 ||
		(value.highestAcknowledged as number) > (value.lastSequence as number) ||
		!Array.isArray(value.records) ||
		value.records.length > capacity ||
		!Array.isArray(value.gaps) ||
		value.gaps.length > capacity ||
		typeof value.sealed !== 'boolean'
	)
		throw new TypeError('Protected Browser Activity state is invalid');
	const records = value.records.map((record) => validateBrowserActivityRecord(record));
	const gaps = value.gaps.map(validateGap);
	const highestAcknowledged = value.highestAcknowledged as number;
	const lastSequence = value.lastSequence as number;
	const invalidRecord = records.some((record, index) => {
		const prior = records[index - 1];
		return (
			record.sourceInstanceId !== value.sourceInstanceId ||
			record.participationGeneration !== scope.participationGeneration ||
			record.sequence <= highestAcknowledged ||
			record.sequence > lastSequence ||
			(prior !== undefined && prior.sequence >= record.sequence)
		);
	});
	const invalidGap = gaps.some((gap, index) => {
		const prior = gaps[index - 1];
		return gap.to > lastSequence || (prior !== undefined && prior.to >= gap.from);
	});
	const state = freezeState({
		schemaVersion: 1,
		scope,
		sourceInstanceId: value.sourceInstanceId,
		highestAcknowledged,
		lastSequence,
		records,
		gaps,
		sealed: value.sealed
	});
	if (invalidRecord || invalidGap || !hasExactCoverage(state))
		throw new TypeError('Protected Browser Activity state is invalid');
	return state;
}
function hasExactCoverage(state: BrowserActivityState): boolean {
	const segments = [
		...state.records.map((record) => ({ from: record.sequence, to: record.sequence })),
		...state.gaps.map((gap) => ({ from: gap.from, to: gap.to }))
	].sort((left, right) => left.from - right.from || left.to - right.to);
	let expected = state.highestAcknowledged + 1;
	for (const segment of segments) {
		if (segment.to <= state.highestAcknowledged) continue;
		const from = Math.max(segment.from, state.highestAcknowledged + 1);
		if (from !== expected) return false;
		expected = segment.to + 1;
	}
	return expected === state.lastSequence + 1;
}
function freezeState(state: BrowserActivityState): BrowserActivityState {
	return Object.freeze({
		schemaVersion: 1,
		scope: validateScope(state.scope),
		sourceInstanceId: state.sourceInstanceId,
		highestAcknowledged: state.highestAcknowledged,
		lastSequence: state.lastSequence,
		records: Object.freeze(state.records.map(validateBrowserActivityRecord)),
		gaps: Object.freeze(state.gaps.map(validateGap)),
		sealed: state.sealed
	});
}
function thawState(state: BrowserActivityState): MutableBrowserActivityState {
	return {
		schemaVersion: 1,
		scope: state.scope,
		sourceInstanceId: state.sourceInstanceId,
		highestAcknowledged: state.highestAcknowledged,
		lastSequence: state.lastSequence,
		records: [...state.records],
		gaps: [...state.gaps],
		sealed: state.sealed
	};
}
function snapshotState(state: MutableBrowserActivityState): BrowserActivityState {
	return Object.freeze({
		schemaVersion: 1,
		scope: state.scope,
		sourceInstanceId: state.sourceInstanceId,
		highestAcknowledged: state.highestAcknowledged,
		lastSequence: state.lastSequence,
		records: Object.freeze([...state.records]),
		gaps: Object.freeze([...state.gaps]),
		sealed: state.sealed
	});
}
function appendGap(gaps: BrowserActivityGap[], next: BrowserActivityGap): void {
	const prior = gaps.at(-1);
	if (prior?.reason === next.reason && prior.to + 1 === next.from)
		gaps[gaps.length - 1] = Object.freeze({ ...prior, to: next.to });
	else gaps.push(Object.freeze(next));
}
function validateScope(value: unknown): BrowserActivityScope {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'attemptId',
			'participationGeneration',
			'policyRevision',
			'policyDigest'
		]) ||
		!boundedIdentifier(value.attemptId) ||
		!Number.isSafeInteger(value.participationGeneration) ||
		(value.participationGeneration as number) <= 0 ||
		!boundedIdentifier(value.policyRevision) ||
		typeof value.policyDigest !== 'string' ||
		!/^[a-z0-9]+:[A-Za-z0-9_-]{8,256}$/iu.test(value.policyDigest)
	)
		throw new TypeError('Browser Activity scope is invalid');
	return Object.freeze({
		attemptId: value.attemptId,
		participationGeneration: value.participationGeneration as number,
		policyRevision: value.policyRevision,
		policyDigest: value.policyDigest
	});
}
function validateGap(value: unknown): BrowserActivityGap {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['from', 'to', 'reason']) ||
		!Number.isSafeInteger(value.from) ||
		!Number.isSafeInteger(value.to) ||
		(value.from as number) <= 0 ||
		(value.from as number) > (value.to as number) ||
		(value.reason !== 'corruptStore' &&
			value.reason !== 'lostKey' &&
			value.reason !== 'overflow')
	)
		throw new TypeError('Browser Activity gap is invalid');
	return Object.freeze({
		from: value.from as number,
		to: value.to as number,
		reason: value.reason
	});
}
function sameScope(left: BrowserActivityScope, right: BrowserActivityScope): boolean {
	return (
		left.attemptId === right.attemptId &&
		left.participationGeneration === right.participationGeneration &&
		left.policyRevision === right.policyRevision &&
		left.policyDigest === right.policyDigest
	);
}
function boundedIdentifier(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
