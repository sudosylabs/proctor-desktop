import assert from 'node:assert';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import { BrowserActivityLedger } from '../../../../../src/prctr/platform/integratedBrowser/common/browserActivityLedger.ts';
import type { BrowserActivityDeliveryPort, BrowserActivityScope, BrowserActivityState, ProtectedBrowserActivityLoad, ProtectedBrowserActivityMutation, ProtectedBrowserActivityPort } from '../../../../../src/prctr/platform/integratedBrowser/common/browserActivity.ts';

const scope: BrowserActivityScope = Object.freeze({ attemptId: 'attempt:one', participationGeneration: 4, policyRevision: 'browser:1', policyDigest: 'sha256:abcdefgh' });
class Store implements ProtectedBrowserActivityPort {
	state: BrowserActivityState | undefined; loadResult: ProtectedBrowserActivityLoad | undefined; writes = 0; replaceWrites = 0; applyWrites = 0; activeWrites = 0; maximumConcurrentWrites = 0; failWrites = false; readonly barriers: Promise<void>[] = []; readonly snapshots: BrowserActivityState[] = []; readonly appliedBatches: Array<readonly ProtectedBrowserActivityMutation[]> = [];
	async load(requested: BrowserActivityScope): Promise<ProtectedBrowserActivityLoad> { assert.deepStrictEqual(requested, scope); return this.loadResult ?? { kind: 'available', ...(this.state === undefined ? {} : { state: this.state }) }; }
	async replace(state: BrowserActivityState): Promise<void> { this.replaceWrites++; this.snapshots.push(state); await this.#write(() => { this.state = state; }); }
	async apply(requestedScope: BrowserActivityScope, sourceInstanceId: string, mutations: readonly ProtectedBrowserActivityMutation[]): Promise<void> { this.applyWrites++; this.appliedBatches.push(mutations); await this.#write(() => { this.state = applyMutations(this.state, requestedScope, sourceInstanceId, mutations); }); }
	async #write(commit: () => void): Promise<void> { this.writes++; this.activeWrites++; this.maximumConcurrentWrites = Math.max(this.maximumConcurrentWrites, this.activeWrites); try { const barrier = this.barriers.shift(); if (barrier !== undefined) await barrier; if (this.failWrites) throw new Error('store unavailable'); commit(); } finally { this.activeWrites--; } }
}
const identity = { nextSourceInstanceId: () => 'browser-source:one' }; const clock = { now: () => 1234 };

test('activity ledger persists ordered minimized records, replays at least once and applies contiguous acknowledgement', async () => {
	const store = new Store(); const ledger = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity, clock }); ledger.append('browserOpened'); ledger.append('topLevelNavigation', { location: { scheme: 'https', host: 'docs.example.test', port: '', path: '/reference' }, matchedRuleId: 'docs' }); await ledger.flush(); assert.strictEqual(store.writes >= 1, true); assert.deepStrictEqual(ledger.pending().map(record => record.sequence), [1, 2]); let deliveries = 0; const delivery: BrowserActivityDeliveryPort = { async deliver(_scope, source, records) { deliveries++; return { sourceInstanceId: source, highestContiguousSequence: records.at(-1)!.sequence, requestedGaps: [] }; } }; await ledger.deliver(delivery); assert.strictEqual(deliveries, 1); assert.deepStrictEqual(ledger.pending(), []); const seal = ledger.seal(); assert.deepStrictEqual({ final: seal.finalSequence, ack: seal.highestAcknowledged, gaps: seal.gaps }, { final: 2, ack: 2, gaps: [] }); ledger.dispose();
});

test('activity ledger preserves source identity across reload and reports overflow, corrupt-store and lost-key gaps', async () => {
	const store = new Store(); const first = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity, clock }); for (let index = 0; index < 17; index++) first.append(index === 0 ? 'browserOpened' : 'topLevelNavigation', index === 0 ? {} : { location: { scheme: 'https', host: 'docs.example.test', port: '', path: `/${index}` }, matchedRuleId: 'docs' }); await first.flush(); assert.strictEqual(first.health, 'overflow'); assert.deepStrictEqual(first.seal().gaps, [{ from: 17, to: 17, reason: 'overflow' }]); const reloaded = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity: { nextSourceInstanceId: () => 'unused' }, clock }); assert.strictEqual(reloaded.sourceInstanceId, 'browser-source:one'); assert.strictEqual(reloaded.lastSequence, 17); const corrupt = new Store(); corrupt.loadResult = { kind: 'corruptStore' }; const corruptLedger = await BrowserActivityLedger.create({ scope, capacity: 16, store: corrupt, identity, clock }); assert.strictEqual(corruptLedger.health, 'corruptStore'); assert.strictEqual(corruptLedger.seal().gaps[0]?.reason, 'corruptStore'); const lost = new Store(); lost.loadResult = { kind: 'lostKey' }; const lostLedger = await BrowserActivityLedger.create({ scope, capacity: 16, store: lost, identity, clock }); assert.strictEqual(lostLedger.health, 'lostKey'); first.dispose(); reloaded.dispose(); corruptLedger.dispose(); lostLedger.dispose();
});

test('activity ledger rejects cross-source and cross-generation records as corrupt protected state', async () => {
	for (const record of [
		{ sourceInstanceId: 'browser-source:other', participationGeneration: scope.participationGeneration },
		{ sourceInstanceId: 'browser-source:one', participationGeneration: scope.participationGeneration + 1 }
	]) {
		const store = new Store(); store.state = { schemaVersion: 1, scope, sourceInstanceId: 'browser-source:one', highestAcknowledged: 0, lastSequence: 1, records: [{ ...record, sequence: 1, kind: 'browserOpened', clientOccurredAtMs: 1 }], gaps: [], sealed: false } as BrowserActivityState;
		const ledger = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity: { nextSourceInstanceId: () => 'browser-source:fresh' }, clock }); assert.strictEqual(ledger.health, 'corruptStore'); assert.strictEqual(ledger.sourceInstanceId, 'browser-source:fresh'); assert.deepStrictEqual(ledger.seal().gaps, [{ from: 1, to: 1, reason: 'corruptStore' }]); ledger.dispose();
	}
});

test('activity ledger rejects unexpected restored fields and invalid blocked consequences', async () => {
	const base = { sourceInstanceId: 'browser-source:one', sequence: 1, participationGeneration: scope.participationGeneration, clientOccurredAtMs: 1 };
	for (const record of [
		{ ...base, kind: 'browserOpened', secret: 'must-not-survive' },
		{ ...base, kind: 'blockedTopLevelNavigation', location: { scheme: 'https', host: 'docs.example.test', port: '', path: '/' }, blockedConsequence: 'dismiss' },
		{ ...base, kind: 'topLevelNavigation', location: { scheme: 'file', host: '', port: '', path: '/private' }, matchedRuleId: 'docs' },
		{ ...base, kind: 'topLevelRedirect', location: { scheme: 'https', host: 'bad..example.test', port: '', path: '/' }, matchedRuleId: 'docs' },
		{ ...base, kind: 'topLevelNavigation', location: { scheme: 'https', host: 'docs.example.test', port: '443', path: '/' }, matchedRuleId: 'docs' },
		{ ...base, kind: 'topLevelNavigation', location: { scheme: 'https', host: 'docs.example.test', port: '', path: '/a/../b' }, matchedRuleId: 'docs' },
		{ ...base, kind: 'topLevelNavigation', location: { scheme: 'https', host: 'docs.example.test', port: '', path: '/a\\b' }, matchedRuleId: 'docs' },
		{ ...base, kind: 'topLevelNavigation', location: { scheme: 'https', host: 'docs.example.test', port: '', path: '/' } }
	]) {
		const store = new Store(); store.state = { schemaVersion: 1, scope, sourceInstanceId: 'browser-source:one', highestAcknowledged: 0, lastSequence: 1, records: [record], gaps: [], sealed: false } as unknown as BrowserActivityState;
		const ledger = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity: { nextSourceInstanceId: () => 'browser-source:fresh' }, clock }); assert.strictEqual(ledger.health, 'corruptStore'); assert.strictEqual(ledger.sourceInstanceId, 'browser-source:fresh'); ledger.dispose();
	}
});

test('activity ledger converts sequence holes and record-gap overlap into an explicit corrupt-store source', async () => {
	const record = (sequence: number) => ({ sourceInstanceId: 'browser-source:one', sequence, participationGeneration: scope.participationGeneration, kind: 'browserOpened' as const, clientOccurredAtMs: 1 });
	for (const state of [
		{ schemaVersion: 1, scope, sourceInstanceId: 'browser-source:one', highestAcknowledged: 0, lastSequence: 3, records: [record(1), record(3)], gaps: [], sealed: false },
		{ schemaVersion: 1, scope, sourceInstanceId: 'browser-source:one', highestAcknowledged: 0, lastSequence: 2, records: [record(1), record(2)], gaps: [{ from: 2, to: 2, reason: 'overflow' as const }], sealed: false }
	] satisfies BrowserActivityState[]) { const store = new Store(); store.state = state; const ledger = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity: { nextSourceInstanceId: () => 'browser-source:fresh' }, clock }); assert.strictEqual(ledger.health, 'corruptStore'); assert.strictEqual(ledger.sourceInstanceId, 'browser-source:fresh'); ledger.dispose(); }
});

test('activity flush rejects persistent protected-store failure and retries the exact state', async () => {
	const store = new Store(); const ledger = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity, clock }); store.failWrites = true; ledger.append('browserOpened'); await assert.rejects(ledger.flush(), /could not be persisted/u); assert.strictEqual(ledger.health, 'storeUnavailable'); store.failWrites = false; await ledger.flush(); assert.strictEqual(ledger.health, 'available'); assert.strictEqual(store.state?.lastSequence, 1); ledger.dispose();
});

test('activity persistence keeps one write in flight and coalesces a burst to the latest state', async () => {
	const store = new Store(); let releaseFirstWrite = () => {}; store.barriers.push(new Promise<void>(resolve => { releaseFirstWrite = resolve; })); const ledger = await BrowserActivityLedger.create({ scope, capacity: 512, store, identity, clock });
	for (let index = 0; index < 256; index++) ledger.append(index === 0 ? 'browserOpened' : 'topLevelNavigation', index === 0 ? {} : { location: { scheme: 'https', host: 'docs.example.test', port: '', path: `/${index}` }, matchedRuleId: 'docs' });
	assert.strictEqual(store.writes, 1); assert.strictEqual(store.maximumConcurrentWrites, 1); assert.strictEqual(store.appliedBatches[0]?.[0]?.kind, 'appendRecord'); releaseFirstWrite(); await ledger.flush();
	assert.strictEqual(store.writes, 2); assert.strictEqual(store.maximumConcurrentWrites, 1); assert.strictEqual(store.replaceWrites, 0); assert.strictEqual(store.state?.lastSequence, 256); assert.strictEqual(store.state?.records.length, 256); ledger.dispose();
});

test('paced high-volume activity uses incremental protected mutations instead of repeated full snapshots', async () => {
	const store = new Store(); const ledger = await BrowserActivityLedger.create({ scope, capacity: 2_048, store, identity, clock }); for (let index = 0; index < 1_024; index++) { ledger.append(index === 0 ? 'browserOpened' : 'topLevelNavigation', index === 0 ? {} : { location: { scheme: 'https', host: 'docs.example.test', port: '', path: `/${index}` }, matchedRuleId: 'docs' }); await ledger.flush(); }
	assert.strictEqual(store.replaceWrites, 0); assert.strictEqual(store.applyWrites, 1_024); assert.strictEqual(store.appliedBatches.every(batch => batch.length === 1), true); assert.strictEqual(store.state?.records.length, 1_024); ledger.dispose();
});

test('a rejected append does not advance sequence or corrupt later persistence', async () => {
	const store = new Store(); let now = -1; const ledger = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity, clock: { now: () => now } }); assert.throws(() => ledger.append('browserOpened'), /identity is invalid/u); assert.strictEqual(ledger.lastSequence, 0); now = 1; ledger.append('browserOpened'); await ledger.flush(); assert.strictEqual(store.state?.lastSequence, 1); const reloaded = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity: { nextSourceInstanceId: () => 'unused' }, clock }); assert.strictEqual(reloaded.health, 'available'); assert.strictEqual(reloaded.lastSequence, 1); ledger.dispose(); reloaded.dispose();
});

test('activity acknowledgements bound and deduplicate hostile requested-gap lists before retention', async () => {
	const store = new Store(); const ledger = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity, clock }); ledger.append('browserOpened'); ledger.append('browserClosed'); await ledger.flush();
	await assert.rejects(ledger.acknowledge(ledger.sourceInstanceId, 0, [1, 1]), /requested gap/u);
	await assert.rejects(ledger.acknowledge(ledger.sourceInstanceId, 0, Array.from({ length: 17 }, (_, index) => index + 1)), /packaged bounds/u);
	await assert.rejects(ledger.acknowledge(ledger.sourceInstanceId, 0, null as unknown as readonly number[]), /packaged bounds/u);
	assert.deepStrictEqual(ledger.pending().map(record => record.sequence), [1, 2]); ledger.dispose();
});

test('activity acknowledgements serialize monotonically and commit deletion with the durable watermark', async () => {
	const store = new Store(); const ledger = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity, clock }); ledger.append('browserOpened'); ledger.append('browserClosed'); await ledger.flush(); const higher = ledger.acknowledge(ledger.sourceInstanceId, 2, []); const stale = ledger.acknowledge(ledger.sourceInstanceId, 1, []); await higher; await assert.rejects(stale, /acknowledgement is invalid/u); assert.strictEqual(store.state?.highestAcknowledged, 2); assert.deepStrictEqual(store.state?.records, []); ledger.dispose(); const reloaded = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity: { nextSourceInstanceId: () => 'unused' }, clock }); assert.strictEqual(reloaded.lastSequence, 2); assert.deepStrictEqual(reloaded.pending(), []); reloaded.dispose();
});

test('a failed atomic acknowledgement leaves replayable protected records after restart', async () => {
	const store = new Store(); const ledger = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity, clock }); ledger.append('browserOpened'); ledger.append('browserClosed'); await ledger.flush(); store.failWrites = true; await assert.rejects(ledger.acknowledge(ledger.sourceInstanceId, 2, []), /could not be persisted/u); ledger.dispose(); store.failWrites = false; const reloaded = await BrowserActivityLedger.create({ scope, capacity: 16, store, identity: { nextSourceInstanceId: () => 'unused' }, clock }); assert.strictEqual(reloaded.lastSequence, 2); assert.deepStrictEqual(reloaded.pending().map(record => record.sequence), [1, 2]); reloaded.dispose();
});

function applyMutations(current: BrowserActivityState | undefined, requestedScope: BrowserActivityScope, sourceInstanceId: string, mutations: readonly ProtectedBrowserActivityMutation[]): BrowserActivityState { let state = current ?? { schemaVersion: 1 as const, scope: requestedScope, sourceInstanceId, highestAcknowledged: 0, lastSequence: 0, records: [], gaps: [], sealed: false }; assert.deepStrictEqual(state.scope, requestedScope); assert.strictEqual(state.sourceInstanceId, sourceInstanceId); let records = [...state.records]; let gaps = [...state.gaps]; let highestAcknowledged = state.highestAcknowledged; let lastSequence = state.lastSequence; let sealed = state.sealed; for (const mutation of mutations) { if (mutation.kind === 'appendRecord') { assert.strictEqual(sealed, false); assert.strictEqual(mutation.record.sequence, lastSequence + 1); records.push(mutation.record); lastSequence = mutation.record.sequence; } else if (mutation.kind === 'appendGap') { assert.strictEqual(sealed, false); assert.strictEqual(mutation.gap.from, lastSequence + 1); const prior = gaps.at(-1); if (prior?.reason === mutation.gap.reason && prior.to + 1 === mutation.gap.from) gaps[gaps.length - 1] = Object.freeze({ ...prior, to: mutation.gap.to }); else gaps.push(mutation.gap); lastSequence = mutation.gap.to; } else if (mutation.kind === 'acknowledge') { assert.strictEqual(mutation.highestContiguousSequence >= highestAcknowledged && mutation.highestContiguousSequence <= lastSequence, true); const requested = new Set(mutation.requestedGaps); records = records.filter(record => record.sequence > mutation.highestContiguousSequence || requested.has(record.sequence)); highestAcknowledged = mutation.highestContiguousSequence; } else { assert.strictEqual(mutation.finalSequence, lastSequence); sealed = true; } } return Object.freeze({ schemaVersion: 1, scope: state.scope, sourceInstanceId, highestAcknowledged, lastSequence, records: Object.freeze(records), gaps: Object.freeze(gaps), sealed }); }
