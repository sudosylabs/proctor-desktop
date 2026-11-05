/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import { parseStrictContractJson } from '../../../../platform/serverApi/node/canonicalContract.js';
import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import type { ProtectedRecordStore } from '../../../../platform/protectedStorage/node/protectedRecordStore.js';
import {
	BrowserSourceStartRefused,
	assertBrowserSourceStatus,
	type BrowserSourceTransport
} from './browserSourceTransport.js';
import {
	canonicalBrowserBytes,
	canonicalBrowserDigest,
	readBrowserSchema,
	type BrowserReceipt,
	type BrowserSourceBinding,
	type BrowserSourceStatus,
	type BrowserStartTransition,
	type BrowserWireRecord
} from './browserServerContract.js';

type AllocatedRecord = BrowserWireRecord extends infer T
	? T extends BrowserWireRecord
		? Omit<T, 'sequence' | 'policy_revision_id'>
		: never
	: never;
interface StoredEvent {
	readonly record: BrowserWireRecord;
	readonly digest: string;
}
interface SourceSnapshot {
	readonly version: 1;
	readonly binding: BrowserSourceBinding;
	readonly transition: BrowserStartTransition;
	readonly allocated: number;
	readonly records: readonly StoredEvent[];
	readonly status?: BrowserSourceStatus;
	readonly finalDeclaration?: components['schemas']['FinalDeliveryDeclaration'];
	readonly refused?: true;
	readonly lossRanges?: readonly components['schemas']['SequenceRange'][];
	readonly pendingGap?: components['schemas']['DeclareDeliveryGaps'];
	readonly summary?: components['schemas']['UnretainedDeliverySummary'];
	readonly summarySent?: number;
	readonly summarySentAt?: number;
	readonly stopDetailsKey?: string;
	readonly budget?: components['schemas']['DeliveryFamilyBudget'];
	readonly cutoffReceiptCursor?: string;
}
export class BrowserSpoolCapacityError extends Error {
	constructor() {
		super('Protected Browser Activity capacity exhausted');
	}
}

/** One instance owns every browser source for one Attempt, including historical Participations.
 * All allocations and receipts commit through encrypted atomic snapshots before callers proceed.
 * Server settlement never stands in for an exact content receipt.
 */
export class BrowserDeliveryService {
	private serial: Promise<unknown> = Promise.resolve();
	private deliverySerial: Promise<unknown> = Promise.resolve();
	private readonly sources = new Map<string, SourceSnapshot>();
	private disposed = false;
	private constructor(
		private readonly attemptId: string,
		private readonly store: ProtectedRecordStore,
		private readonly transport: BrowserSourceTransport,
		private readonly canCapture: (binding: BrowserSourceBinding) => boolean
	) {}
	static async create(
		attemptId: string,
		store: ProtectedRecordStore,
		transport: BrowserSourceTransport,
		canCapture: (binding: BrowserSourceBinding) => boolean
	): Promise<BrowserDeliveryService> {
		const service = new BrowserDeliveryService(attemptId, store, transport, canCapture);
		for (const key of await store.list('browser_')) {
			const bytes = await store.read(key);
			if (!bytes) continue;
			const snapshot = validateSnapshot(
				parseStrictContractJson(bytes, { maxBytes: 4 * 1024 * 1024 + 64 * 1024 })
			);
			if (
				snapshot.binding.attemptId !== attemptId ||
				key !== sourceKey(snapshot.binding.sourceInstanceId)
			)
				throw new TypeError('Protected browser source scope is invalid');
			service.sources.set(snapshot.binding.sourceInstanceId, snapshot);
		}
		service.assertCapacity();
		return service;
	}
	inventory(): readonly BrowserSourceBinding[] {
		return Object.freeze([...this.sources.values()].map((value) => value.binding));
	}
	/** Retain the declared successor even after an uncertain/refused start. Falling back to its
	 * predecessor would resurrect closed authority or spend a second source reservation. */
	currentSource(participationId: string, generation: number): BrowserSourceBinding | undefined {
		if (this.disposed) throw new Error('Browser delivery owner is disposed');
		const candidates = [...this.sources.values()].filter(
			(state) =>
				state.binding.participationId === participationId &&
				state.binding.participationGeneration === generation
		);
		const replaced = new Set(
			candidates.flatMap((state) =>
				state.transition.kind === 'initial'
					? []
					: [state.transition.predecessor_source_session_id]
			)
		);
		const latest = candidates.filter((state) => !replaced.has(state.binding.sourceInstanceId));
		if (latest.length > 1 || (candidates.length > 0 && latest.length === 0))
			throw new Error('Browser source continuity requires privileged reconciliation');
		return latest[0]?.binding;
	}
	status(source: string): BrowserSourceStatus | undefined {
		return this.source(source).status;
	}
	retryStart(source: string): Promise<BrowserSourceStatus> {
		const state = this.source(source);
		return this.start(state.binding, state.transition);
	}
	allocated(source: string): number {
		return this.source(source).allocated;
	}
	/** Call again with the same source after any uncertain result. UUID replacement is never a retry. */
	start(
		binding: BrowserSourceBinding,
		transition: BrowserStartTransition
	): Promise<BrowserSourceStatus> {
		return this.enqueue(async () => {
			validateBinding(binding);
			if (binding.attemptId !== this.attemptId || !this.canCapture(binding))
				throw new Error('Browser source admission is unavailable');
			let current = this.sources.get(binding.sourceInstanceId);
			if (
				current &&
				(canonicalBrowserDigest(current.binding) !== canonicalBrowserDigest(binding) ||
					canonicalBrowserDigest(current.transition) !==
						canonicalBrowserDigest(transition))
			)
				throw new TypeError('Browser source retry changed its declaration');
			if (current?.refused) throw new Error('Browser source successor was refused');
			if (current?.status) return current.status;
			if (!current) {
				if (transition.kind !== 'initial') {
					const predecessor = this.source(transition.predecessor_source_session_id);
					if (
						predecessor.binding.participationId !== binding.participationId ||
						predecessor.binding.participationGeneration !==
							binding.participationGeneration
					)
						throw new TypeError('Browser source predecessor scope is invalid');
				}
				current = {
					version: 1,
					binding: Object.freeze({ ...binding }),
					transition: Object.freeze({ ...transition }),
					allocated: 0,
					records: []
				};
				await this.commit(current);
			}
			try {
				const status = await this.transport.start(binding, transition);
				assertBrowserSourceStatus(binding, status);
				await this.commit({ ...current, status });
				return status;
			} catch (error) {
				if (error instanceof BrowserSourceStartRefused && transition.kind !== 'initial') {
					const prior = this.source(transition.predecessor_source_session_id);
					assertBrowserSourceStatus(prior.binding, error.predecessor);
					await this.commit({ ...prior, status: error.predecessor });
					await this.commit({ ...current, refused: true });
				}
				throw error;
			}
		});
	}
	append(source: string, event: AllocatedRecord): Promise<BrowserWireRecord | undefined> {
		// Capture provenance is checked when the event arrives. A later pause may withdraw
		// navigation, but must not discard an already observed event awaiting durable storage.
		if (!this.canCapture(this.source(source).binding))
			return Promise.reject(new Error('Browser source capture is unavailable'));
		event = structuredClone(event);
		return this.enqueue(async () => {
			const state = this.source(source);
			if (
				!state.status ||
				state.status.closure.closed_at ||
				state.finalDeclaration ||
				state.refused
			)
				throw new Error('Browser source capture is unavailable');
			if (this.summaryOnly(state)) {
				await this.commit(this.summarize(state, event.client_occurred_at));
				return undefined;
			}
			const sequence = state.allocated + 1;
			const participationPositions = [...this.sources.values()]
				.filter((value) => value.binding.participationId === state.binding.participationId)
				.reduce((sum, value) => sum + value.allocated, 0);
			const attemptPositions = [...this.sources.values()].reduce(
				(sum, value) => sum + value.allocated,
				0
			);
			if (participationPositions >= 50_000 || attemptPositions >= 200_000) {
				await this.commit(
					this.summarize(
						{ ...state, stopDetailsKey: state.stopDetailsKey ?? randomUUID() },
						event.client_occurred_at
					)
				);
				return undefined;
			}
			const record = readBrowserSchema('BrowserDeliveryRecord', {
				...event,
				sequence,
				policy_revision_id: state.binding.policyRevision
			});
			if (
				'redirect_from_sequence' in record &&
				record.redirect_from_sequence !== undefined &&
				record.redirect_from_sequence >= sequence
			)
				throw new TypeError('Browser redirect predecessor is invalid');
			try {
				await this.commit({
					...state,
					allocated: sequence,
					records: [...state.records, { record, digest: canonicalBrowserDigest(record) }]
				});
			} catch (error) {
				if (!(error instanceof BrowserSpoolCapacityError)) throw error;
				const ranges = [...(state.lossRanges ?? [])];
				const prior = ranges.at(-1);
				if (prior?.last === sequence - 1)
					ranges[ranges.length - 1] = { first: prior.first, last: sequence };
				else ranges.push({ first: sequence, last: sequence });
				if (ranges.length <= 32) {
					try {
						await this.commit({ ...state, allocated: sequence, lossRanges: ranges });
						return record;
					} catch (controlError) {
						if (!(controlError instanceof BrowserSpoolCapacityError))
							throw controlError;
					}
				}
				await this.commit(
					this.summarize(
						{ ...state, stopDetailsKey: state.stopDetailsKey ?? randomUUID() },
						event.client_occurred_at
					)
				);
				return undefined;
			}
			return record;
		});
	}
	/** Send a bounded window once. The shared delivery scheduler owns retries/backoff and pacing. */
	deliver(source: string): Promise<number> {
		const pending = this.deliverySerial.then(async () => {
			let state = this.source(source);
			const status = await this.transport.status(state.binding);
			assertBrowserSourceStatus(state.binding, status);
			const budget = await this.transport.budget(state.binding);
			if (
				budget.participation_id !== state.binding.participationId ||
				budget.generation !== state.binding.participationGeneration
			)
				throw new TypeError('Browser budget scope is invalid');
			await this.update(source, (current) => ({
				...current,
				status,
				budget: budget.browser
			}));
			state = this.source(source);
			if (await this.deliverControl(state)) return 1;
			state = this.source(source);
			if (this.summaryOnly(state)) return 0;
			const window =
				Math.max(status.highest_contiguous_sequence, status.settled_through_sequence) +
				4096;
			const events: BrowserWireRecord[] = [];
			let bytes = 1024;
			for (const { record } of state.records) {
				if (record.sequence > window) break;
				const size = canonicalBrowserBytes(record).byteLength;
				if (events.length === 64 || bytes + size > 256 * 1024 - 1024) break;
				events.push(record);
				bytes += size;
			}
			if (!events.length) return 0;
			const result = await this.transport.append(state.binding, events);
			if (result.source_session_id !== source)
				throw new TypeError('Browser receipt scope is invalid');
			await this.enqueue(() =>
				this.applyReceipts(
					source,
					result.receipts,
					new Set(events.map((event) => event.sequence))
				)
			);
			return events.length;
		});
		this.deliverySerial = pending.catch(() => {});
		return pending;
	}
	/** Recover exact receipts after a lost response, including accepted content beyond a permanent gap. */
	recoverReceipts(source: string): Promise<void> {
		return this.enqueue(async () => {
			let cursor: string | undefined;
			let previous = 0;
			for (let pages = 0; ; pages++) {
				const state = this.source(source);
				if (pages > state.allocated + 1)
					throw new TypeError('Browser receipt cursor is invalid');
				const page = await this.transport.receipts(state.binding, cursor);
				previous = assertReceiptPage(page.items, previous, state.allocated);
				await this.applyReceipts(source, page.items);
				if (page.next_cursor === undefined) break;
				if (page.next_cursor === cursor)
					throw new TypeError('Browser receipt cursor is invalid');
				cursor = page.next_cursor;
			}
		});
	}
	seal(source: string): Promise<BrowserSourceStatus> {
		return this.enqueue(async () => {
			let state = this.source(source);
			if (!state.status) throw new Error('Browser source has no server status');
			if (!state.finalDeclaration) {
				const finalDeclaration = {
					declaration_id: randomUUID(),
					expected_revision: state.status.declaration_revision,
					final_sequence: state.allocated
				};
				await this.commit({ ...state, finalDeclaration });
				state = this.source(source);
			}
			const status = await this.transport.seal(state.binding, state.finalDeclaration!);
			assertBrowserSourceStatus(state.binding, status);
			await this.commit({ ...state, status });
			return status;
		});
	}
	private summaryOnly(state: SourceSnapshot): boolean {
		return (
			state.status?.detail_mode === 'summary_only' ||
			!!state.stopDetailsKey ||
			[...this.sources.values()].some(
				(source) =>
					source.budget?.attempt.summary_only ||
					(source.binding.participationId === state.binding.participationId &&
						source.budget?.participation.summary_only)
			)
		);
	}
	private summarize(
		state: SourceSnapshot,
		time: string | null,
		complete = true,
		count = 1
	): SourceSnapshot {
		const prior = state.summary;
		const nextCount = (prior?.unretained_record_count ?? 0) + count;
		return {
			...state,
			summary: {
				summary_sequence: Math.min(
					Number.MAX_SAFE_INTEGER,
					(prior?.summary_sequence ?? 0) + 1
				),
				unretained_record_count: Math.min(Number.MAX_SAFE_INTEGER, nextCount),
				count_complete:
					(prior?.count_complete ?? true) && complete && Number.isSafeInteger(nextCount),
				first_unretained_at:
					time === null
						? prior?.first_unretained_at
						: prior?.first_unretained_at &&
							  Date.parse(prior.first_unretained_at) < Date.parse(time)
							? prior.first_unretained_at
							: time,
				last_unretained_at:
					time === null
						? prior?.last_unretained_at
						: prior?.last_unretained_at &&
							  Date.parse(prior.last_unretained_at) > Date.parse(time)
							? prior.last_unretained_at
							: time
			}
		};
	}
	private async deliverControl(input: SourceSnapshot): Promise<boolean> {
		let state = input;
		const source = state.binding.sourceInstanceId;
		if (state.stopDetailsKey && state.status?.detail_mode !== 'summary_only') {
			const result = await this.transport.stopDetails(state.binding, state.stopDetailsKey);
			for (const status of result.browser) {
				const own = this.sources.get(status.source_session_id);
				if (own) {
					assertBrowserSourceStatus(own.binding, status);
					await this.update(own.binding.sourceInstanceId, (current) => ({
						...current,
						status,
						budget: result.budget.browser
					}));
				}
			}
			return true;
		}
		if (
			state.status?.detail_mode === 'summary_only' &&
			(state.records.length || state.lossRanges?.length)
		) {
			// Receipt recovery precedes omission accounting. New summary-only capture may continue
			// while this network call is pending; its counts must survive this transaction.
			const cursor = state.cutoffReceiptCursor;
			const page = await this.transport.receipts(state.binding, cursor);
			await this.enqueue(async () => {
				state = this.source(source);
				assertReceiptPage(page.items, 0, state.allocated);
				if (page.next_cursor !== undefined && page.next_cursor === cursor)
					throw new TypeError('Browser receipt cursor is invalid');
				await this.applyReceipts(source, page.items);
				state = this.source(source);
				if (page.next_cursor !== undefined) {
					await this.commit({ ...state, cutoffReceiptCursor: page.next_cursor });
				} else {
					for (const { record } of state.records)
						state = this.summarize(
							state,
							record.client_occurred_at,
							record.sequence <= state.status!.terminal_missing_through_sequence
						);
					const lostCount = (state.lossRanges ?? []).reduce(
						(count, range) => count + range.last - range.first + 1,
						0
					);
					if (lostCount) state = this.summarize(state, null, false, lostCount);
					await this.commit({
						...state,
						records: [],
						lossRanges: [],
						pendingGap: undefined,
						cutoffReceiptCursor: undefined
					});
				}
			});
			return true;
		}
		if (state.lossRanges?.length && state.status?.detail_mode !== 'summary_only') {
			await this.update(source, (current) =>
				current.pendingGap
					? current
					: {
							...current,
							pendingGap: {
								declaration_id: randomUUID(),
								expected_revision: current.status!.declaration_revision,
								allocated_through_sequence: current.allocated,
								ranges: current.lossRanges!,
								reason: 'local_capacity_exhausted'
							}
						}
			);
			state = this.source(source);
			const declaration = state.pendingGap!;
			const result = await this.transport.gaps(state.binding, declaration);
			if (
				result.receipt.declaration_id !== declaration.declaration_id ||
				result.receipt.request_digest !== canonicalBrowserDigest(declaration)
			)
				throw new TypeError('Browser loss declaration receipt is invalid');
			assertBrowserSourceStatus(state.binding, result.status);
			await this.update(source, (current) => ({
				...current,
				status: result.status,
				lossRanges: subtractRanges(current.lossRanges ?? [], declaration.ranges),
				pendingGap: undefined
			}));
			return true;
		}
		if (state.summary && state.summary.summary_sequence !== state.summarySent) {
			if (!state.finalDeclaration && Date.now() - (state.summarySentAt ?? 0) < 5000)
				return true;
			const summary = state.summary;
			const result = await this.transport.summary(
				state.binding,
				summary,
				`${source}_${summary.summary_sequence}`
			);
			assertBrowserSourceStatus(state.binding, result.status);
			if (canonicalBrowserDigest(result.summary) !== canonicalBrowserDigest(summary))
				throw new TypeError('Browser summary acknowledgement is invalid');
			await this.update(source, (current) => ({
				...current,
				status: result.status,
				summarySent: summary.summary_sequence,
				summarySentAt: Date.now()
			}));
			return true;
		}
		return false;
	}
	private update(
		source: string,
		transform: (current: SourceSnapshot) => SourceSnapshot
	): Promise<void> {
		return this.enqueue(() => this.commit(transform(this.source(source))));
	}

	private async applyReceipts(
		source: string,
		receipts: readonly BrowserReceipt[],
		delivered?: ReadonlySet<number>
	): Promise<void> {
		const state = this.source(source);
		const bySequence = new Map(state.records.map((event) => [event.record.sequence, event]));
		const accepted = new Set<number>();
		for (const receipt of receipts) {
			readBrowserSchema('BrowserEventReceipt', receipt);
			const event = bySequence.get(receipt.sequence);
			if (
				receipt.sequence > state.allocated ||
				(delivered && !delivered.has(receipt.sequence)) ||
				accepted.has(receipt.sequence) ||
				(event && event.digest !== receipt.event_digest)
			)
				throw new TypeError('Browser content receipt does not match allocated bytes');
			accepted.add(receipt.sequence);
		}
		await this.commit({
			...state,
			records: state.records.filter((event) => !accepted.has(event.record.sequence))
		});
	}
	private source(source: string): SourceSnapshot {
		if (this.disposed) throw new Error('Browser delivery owner is disposed');
		const state = this.sources.get(source);
		if (!state) throw new TypeError('Browser source is unknown');
		return state;
	}
	private assertCapacity(next?: SourceSnapshot): void {
		let records = 0,
			detailBytes = 0,
			metadataBytes = 0;
		const sources = new Map(this.sources);
		if (next) sources.set(next.binding.sourceInstanceId, next);
		for (const state of sources.values()) {
			records += state.records.length;
			for (const event of state.records)
				detailBytes += canonicalBrowserBytes(event).byteLength;
			metadataBytes += canonicalBrowserBytes({ ...state, records: [] }).byteLength;
		}
		if (records > 8192 || detailBytes > 4 * 1024 * 1024 || metadataBytes > 64 * 1024)
			throw new BrowserSpoolCapacityError();
	}
	private async commit(next: SourceSnapshot): Promise<void> {
		if (this.disposed) throw new Error('Browser delivery owner is disposed');
		next = Object.fromEntries(
			Object.entries(next).filter(([, value]) => value !== undefined)
		) as unknown as SourceSnapshot;
		const prior = this.sources.get(next.binding.sourceInstanceId);
		if (
			prior?.status &&
			next.status &&
			((prior.status.closure.closed_at && !next.status.closure.closed_at) ||
				(prior.status.detail_mode === 'summary_only' &&
					next.status.detail_mode !== 'summary_only'))
		)
			throw new TypeError('Browser source authority regressed');
		if (prior?.budget?.attempt.summary_only && next.budget && !next.budget.attempt.summary_only)
			next = { ...next, budget: { ...next.budget, attempt: prior.budget.attempt } };
		if (
			prior?.budget?.participation.summary_only &&
			next.budget &&
			!next.budget.participation.summary_only
		)
			next = {
				...next,
				budget: { ...next.budget, participation: prior.budget.participation }
			};
		this.assertCapacity(next);
		const bytes = canonicalBrowserBytes(next);
		next = validateSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
		await this.store.write(sourceKey(next.binding.sourceInstanceId), bytes);
		if (this.disposed) throw new Error('Browser delivery owner is disposed');
		this.sources.set(next.binding.sourceInstanceId, next);
	}
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const pending = this.serial.then(() => {
			if (this.disposed) throw new Error('Browser delivery owner is disposed');
			return operation();
		});
		this.serial = pending.catch(() => {});
		return pending;
	}
	dispose(): void {
		this.disposed = true;
		this.sources.clear();
	}
}
function sourceKey(source: string): string {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(source))
		throw new TypeError('Browser source must be a canonical UUIDv4');
	return `browser_${source}`;
}
function validateBinding(binding: BrowserSourceBinding): void {
	sourceKey(binding.sourceInstanceId);
	for (const value of [binding.attemptId, binding.participationId, binding.policyRevision])
		if (!/^[ybndrfg8ejkmcpqxot1uwisza345h769]{26}$/u.test(value))
			throw new TypeError('Browser source identifier is invalid');
	if (
		!Number.isSafeInteger(binding.participationGeneration) ||
		binding.participationGeneration < 1 ||
		!/^sha256:[0-9a-f]{64}$/u.test(binding.policyDigest)
	)
		throw new TypeError('Browser source scope is invalid');
}
function validateSnapshot(value: unknown): SourceSnapshot {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('Browser source snapshot is invalid');
	const state = value as SourceSnapshot;
	if (
		Object.keys(value).some(
			(key) =>
				![
					'version',
					'binding',
					'transition',
					'allocated',
					'records',
					'status',
					'finalDeclaration',
					'refused',
					'lossRanges',
					'pendingGap',
					'summary',
					'summarySent',
					'summarySentAt',
					'stopDetailsKey',
					'budget',
					'cutoffReceiptCursor'
				].includes(key)
		) ||
		state.version !== 1 ||
		(state.cutoffReceiptCursor !== undefined &&
			(typeof state.cutoffReceiptCursor !== 'string' ||
				state.cutoffReceiptCursor.length < 1 ||
				state.cutoffReceiptCursor.length > 2048)) ||
		!Number.isSafeInteger(state.allocated) ||
		state.allocated < 0 ||
		state.allocated > 50_000 ||
		!Array.isArray(state.records) ||
		state.records.length > 8192
	)
		throw new TypeError('Browser source snapshot is invalid');
	validateBinding(state.binding);
	if (
		!state.transition ||
		!['initial', 'policy_correction', 'runtime_reset'].includes(state.transition.kind)
	)
		throw new TypeError('Browser source transition is invalid');
	if (state.transition.kind !== 'initial')
		sourceKey(state.transition.predecessor_source_session_id);
	let prior = 0;
	for (const event of state.records) {
		readBrowserSchema('BrowserDeliveryRecord', event.record);
		if (
			event.record.policy_revision_id !== state.binding.policyRevision ||
			event.record.sequence <= prior ||
			event.record.sequence > state.allocated ||
			canonicalBrowserDigest(event.record) !== event.digest
		)
			throw new TypeError('Browser source record is invalid');
		prior = event.record.sequence;
	}
	if (state.status) {
		readBrowserSchema('BrowserSourceStatus', state.status);
		assertBrowserSourceStatus(state.binding, state.status);
	}
	if (state.finalDeclaration) {
		readBrowserSchema('FinalDeliveryDeclaration', state.finalDeclaration);
		if (state.finalDeclaration.final_sequence !== state.allocated)
			throw new TypeError('Browser final boundary is invalid');
	}
	if (state.lossRanges) {
		let end = 0;
		for (const range of state.lossRanges) {
			readBrowserSchema('SequenceRange', range);
			if (
				range.first <= end ||
				range.last > state.allocated ||
				state.records.some(
					(event) =>
						event.record.sequence >= range.first && event.record.sequence <= range.last
				)
			)
				throw new TypeError('Browser loss range is invalid');
			end = range.last;
		}
	}
	if (state.pendingGap) readBrowserSchema('DeclareDeliveryGaps', state.pendingGap);
	if (state.summary) readBrowserSchema('UnretainedDeliverySummary', state.summary);
	if (state.budget) readBrowserSchema('DeliveryFamilyBudget', state.budget);
	if (state.stopDetailsKey) sourceKey(state.stopDetailsKey);
	return freezeSnapshot(state);
}

function subtractRanges(
	ranges: readonly components['schemas']['SequenceRange'][],
	settled: readonly components['schemas']['SequenceRange'][]
): readonly components['schemas']['SequenceRange'][] {
	let result = [...ranges];
	for (const remove of settled)
		result = result.flatMap((range) =>
			range.last < remove.first || range.first > remove.last
				? [range]
				: [
						...(range.first < remove.first
							? [{ first: range.first, last: remove.first - 1 }]
							: []),
						...(range.last > remove.last
							? [{ first: remove.last + 1, last: range.last }]
							: [])
					]
		);
	return result;
}
function freezeSnapshot<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const item of Object.values(value)) freezeSnapshot(item);
		Object.freeze(value);
	}
	return value;
}

/** Receipts are strictly ascending within and across pages and never exceed the allocated sequence. */
function assertReceiptPage(
	items: readonly { readonly sequence: number }[],
	previous: number,
	allocated: number
): number {
	let last = previous;
	for (const { sequence } of items) {
		if (sequence <= last || sequence > allocated)
			throw new TypeError('Browser receipt page regressed');
		last = sequence;
	}
	return last;
}
