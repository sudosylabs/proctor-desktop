import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserDeliveryService } from '../../../../../src/prctr/workbench/services/integratedBrowser/node/browserDeliveryService.ts';
import {
	BrowserSourceStartRefused,
	type BrowserSourceTransport
} from '../../../../../src/prctr/workbench/services/integratedBrowser/node/browserSourceTransport.ts';
import {
	canonicalBrowserDigest,
	browserRecordToWire,
	mapServerBrowserPolicy,
	type BrowserSourceBinding,
	type BrowserSourceStatus
} from '../../../../../src/prctr/workbench/services/integratedBrowser/node/browserServerContract.ts';
import type { components } from '../../../../../src/prctr/platform/serverApi/common/serverApi.generated.ts';
import type { ProtectedRecordStore } from '../../../../../src/prctr/platform/protectedStorage/node/protectedRecordStore.ts';

const binding: BrowserSourceBinding = {
	attemptId: 'y'.repeat(26),
	participationId: 'b'.repeat(26),
	participationGeneration: 1,
	policyRevision: 'n'.repeat(26),
	policyDigest: `sha256:${'a'.repeat(64)}`,
	sourceInstanceId: '12345678-1234-4234-8234-123456789abc'
};
const time = '2026-09-12T00:00:00.000Z';
function status(scope = binding): BrowserSourceStatus {
	return {
		attempt_id: scope.attemptId,
		participation_id: scope.participationId,
		generation: scope.participationGeneration,
		source_session_id: scope.sourceInstanceId,
		policy_revision_id: scope.policyRevision,
		policy_digest: scope.policyDigest,
		allocated_through_sequence: 0,
		highest_contiguous_sequence: 0,
		highest_seen_sequence: 0,
		settled_through_sequence: 0,
		terminal_missing_through_sequence: 0,
		missing_ranges: [],
		missing_ranges_truncated: false,
		closure: {
			unknown_tail: false
		},
		declaration_revision: 0,
		detail_mode: 'collecting',
		budget_scope: null,
		predecessor_source_session_id: null,
		remaining_correction_starts: 32,
		remaining_runtime_reset_starts: 16,
		runtime_reset_reason: null,
		start_transition: 'initial',
		started_at: time,
		server_time: time,
		summary: null,
		summary_only_reason: null
	};
}
class Store implements ProtectedRecordStore {
	readonly records = new Map<string, Uint8Array>();
	fail = false;
	async read(key: string) {
		return this.records.get(key)?.slice();
	}
	async write(key: string, bytes: Uint8Array) {
		if (this.fail) throw new Error('disk unavailable');
		this.records.set(key, bytes.slice());
	}
	async delete(key: string) {
		this.records.delete(key);
	}
	async list(prefix = '') {
		return [...this.records.keys()].filter((key) => key.startsWith(prefix));
	}
	dispose() {}
}
function budget(scope = binding): components['schemas']['DeliveryBudgetSnapshot'] {
	const usage = {
		allocated_positions: 0,
		byte_limit: 128 * 1024 * 1024,
		position_limit: 200_000,
		record_limit: 200_000,
		retained_bytes: 0,
		retained_records: 0,
		stop_reason: null,
		summary_only: false
	} as const;
	const family = {
		attempt: usage,
		participation: usage,
		pending_byte_limit: 2097152 as const,
		pending_bytes: 0
	};
	return {
		participation_id: scope.participationId,
		generation: scope.participationGeneration,
		server_time: time,
		browser: family,
		native: family,
		browser_evidence_bytes: 0,
		browser_evidence_records: 0,
		browser_flag_groups: 0,
		control_metadata_bytes: 0,
		explicit_missing_intervals: 0
	};
}
function transport(overrides: Partial<BrowserSourceTransport> = {}): BrowserSourceTransport {
	return {
		async budget(scope) {
			return budget(scope);
		},
		async stopDetails() {
			throw new Error('unused');
		},
		async start(scope) {
			return status(scope);
		},
		async status(scope) {
			return status(scope);
		},
		async append(scope, records) {
			return {
				source_session_id: scope.sourceInstanceId,
				receipts: records.map((record) => ({
					sequence: record.sequence,
					event_digest: canonicalBrowserDigest(record),
					received_at: time
				})),
				allocated_through_sequence: records.at(-1)!.sequence,
				highest_contiguous_sequence: 0,
				highest_seen_sequence: records.at(-1)!.sequence,
				settled_through_sequence: 0,
				terminal_missing_through_sequence: 0,
				missing_ranges: [],
				missing_ranges_truncated: false,
				server_time: time
			};
		},
		async receipts() {
			return { items: [] };
		},
		async seal(scope, declaration) {
			return {
				...status(scope),
				closure: {
					...status(scope).closure,
					final_sequence: declaration.final_sequence,
					final_declaration_id: declaration.declaration_id,
					final_boundary_origin: 'client_declared'
				}
			};
		},
		async gaps() {
			throw new Error('unused');
		},
		async summary() {
			throw new Error('unused');
		},
		...overrides
	};
}
const opened = { kind: 'browser_opened' as const, client_occurred_at: time };

void test('durable source identity retries exactly after a lost response, including restart', async () => {
	const store = new Store();
	let starts = 0;
	const wire = transport({
		async start(scope) {
			starts++;
			if (starts === 1) throw new Error('response lost');
			return status(scope);
		}
	});
	const first = await BrowserDeliveryService.create(binding.attemptId, store, wire, () => true);
	await assert.rejects(first.start(binding, { kind: 'initial' }));
	first.dispose();
	const second = await BrowserDeliveryService.create(binding.attemptId, store, wire, () => true);
	await second.start(binding, { kind: 'initial' });
	assert.equal(starts, 2);
	assert.equal(second.inventory().length, 1);
	await assert.rejects(
		second.start({ ...binding, policyDigest: `sha256:${'b'.repeat(64)}` }, { kind: 'initial' })
	);
});

void test('exact receipts remove content behind a gap, settlement alone never removes records', async () => {
	const store = new Store();
	let sent: readonly number[] = [];
	const wire = transport({
		async append(scope, records) {
			sent = records.map((record) => record.sequence);
			return {
				...(await transport().append(scope, records)),
				receipts: records
					.filter((record) => record.sequence === 2)
					.map((record) => ({
						sequence: record.sequence,
						event_digest: canonicalBrowserDigest(record),
						received_at: time
					})),
				settled_through_sequence: 2
			};
		}
	});
	const service = await BrowserDeliveryService.create(binding.attemptId, store, wire, () => true);
	await service.start(binding, { kind: 'initial' });
	await service.append(binding.sourceInstanceId, opened);
	await service.append(binding.sourceInstanceId, opened);
	await service.deliver(binding.sourceInstanceId);
	assert.deepEqual(sent, [1, 2]);
	await service.deliver(binding.sourceInstanceId);
	assert.deepEqual(sent, [1]);
});

void test('wrong digest cannot delete protected content', async () => {
	const store = new Store();
	const wire = transport({
		async append(scope, records) {
			return {
				...(await transport().append(scope, records)),
				receipts: [
					{ sequence: 1, event_digest: `sha256:${'f'.repeat(64)}`, received_at: time }
				]
			};
		}
	});
	const service = await BrowserDeliveryService.create(binding.attemptId, store, wire, () => true);
	await service.start(binding, { kind: 'initial' });
	await service.append(binding.sourceInstanceId, opened);
	await assert.rejects(service.deliver(binding.sourceInstanceId), /receipt/);
	assert.equal(
		JSON.parse(new TextDecoder().decode([...store.records.values()][0])).records.length,
		1
	);
});

void test('failed persistence does not consume sequence; current gate is checked for every capture', async () => {
	const store = new Store();
	let active = true;
	const service = await BrowserDeliveryService.create(
		binding.attemptId,
		store,
		transport(),
		() => active
	);
	await service.start(binding, { kind: 'initial' });
	store.fail = true;
	await assert.rejects(service.append(binding.sourceInstanceId, opened));
	store.fail = false;
	assert.equal((await service.append(binding.sourceInstanceId, opened))?.sequence, 1);
	active = false;
	await assert.rejects(service.append(binding.sourceInstanceId, opened));
});

void test('reset refusal permanently records predecessor closure without allocating another source', async () => {
	const next = { ...binding, sourceInstanceId: '12345678-1234-4234-9234-123456789abc' };
	const closed = {
		...status(),
		closure: {
			...status().closure,
			closed_at: time,
			close_reason: 'runtime_reset' as const,
			upload_expires_at: '2026-09-13T00:00:00.000Z'
		}
	};
	const wire = transport({
		async start(scope) {
			if (scope.sourceInstanceId === next.sourceInstanceId)
				throw new BrowserSourceStartRefused(closed);
			return status(scope);
		}
	});
	const service = await BrowserDeliveryService.create(
		binding.attemptId,
		new Store(),
		wire,
		() => true
	);
	await service.start(binding, { kind: 'initial' });
	const transition = {
		kind: 'runtime_reset' as const,
		predecessor_source_session_id: binding.sourceInstanceId,
		reason: 'source_corrupt' as const
	};
	await assert.rejects(service.start(next, transition), BrowserSourceStartRefused);
	assert.equal(service.status(binding.sourceInstanceId)?.closure.closed_at, time);
	await assert.rejects(service.append(binding.sourceInstanceId, opened));
	await assert.rejects(service.start(next, transition), /refused/);
});

void test('final declaration identity survives lost response and disables subsequent capture', async () => {
	const store = new Store();
	const declarations: string[] = [];
	const wire = transport({
		async seal(scope, declaration) {
			declarations.push(declaration.declaration_id);
			if (declarations.length === 1) throw new Error('lost');
			return transport().seal(scope, declaration);
		}
	});
	const service = await BrowserDeliveryService.create(binding.attemptId, store, wire, () => true);
	await service.start(binding, { kind: 'initial' });
	await service.append(binding.sourceInstanceId, opened);
	await assert.rejects(service.seal(binding.sourceInstanceId));
	await assert.rejects(service.append(binding.sourceInstanceId, opened));
	await service.seal(binding.sourceInstanceId);
	assert.equal(declarations[0], declarations[1]);
});

void test('wire mapping strips sentinel locations and never sends the client consequence', () => {
	const mapped = browserRecordToWire(
		{
			sourceInstanceId: binding.sourceInstanceId,
			participationGeneration: 1,
			sequence: 1,
			clientOccurredAtMs: Date.parse(time),
			kind: 'blockedTopLevelNavigation',
			blockedConsequence: 'integrityEvidence',
			blockReason: 'invalid_url',
			location: { scheme: 'invalid', host: '', port: '', path: '/' }
		},
		binding
	);
	assert.deepEqual('location' in mapped ? mapped.location : undefined, {
		scheme: '',
		host: '',
		path: ''
	});
	assert.equal('blockedConsequence' in mapped, false);
});

void test('candidate policy digest is checked before accepting privileged rules', () => {
	const policy = {
		enabled: true,
		start_rule_id: 'docs',
		rules: [
			{
				rule_id: 'docs',
				origin: 'https://example.com',
				path_prefix: '/',
				host_match: 'exact',
				allow_redirects: true,
				blocked_navigation_outcome: 'record',
				institution_http_exception: false
			}
		]
	};
	const wire = {
		...policy,
		policy_revision_id: binding.policyRevision,
		policy_revision_number: 1,
		policy_digest: canonicalBrowserDigest(policy),
		browser_activity_disclosure: {
			audience: 'exam_managers_with_browser_activity_permission',
			browser_activity_retention_days: 30,
			may_create_integrity_evidence: false,
			notice_id: 'integrated_browser_activity',
			retention_anchor: 'eligible_closed_sitting_records_completion',
			retention_policy_revision: 1
		}
	};
	assert.equal(mapServerBrowserPolicy(wire, binding, 'https://example.com').startRuleId, 'docs');
	assert.throws(() =>
		mapServerBrowserPolicy(
			{ ...wire, policy_digest: binding.policyDigest },
			binding,
			'https://example.com'
		)
	);
});

void test('local loss declaration retries its persisted identity before delivering later records', async () => {
	const store = new Store();
	const declarations: string[] = [];
	let batches = 0;
	const record = { ...opened, sequence: 3, policy_revision_id: binding.policyRevision };
	store.records.set(
		`browser_${binding.sourceInstanceId}`,
		new TextEncoder().encode(
			JSON.stringify({
				version: 1,
				binding,
				transition: { kind: 'initial' },
				allocated: 3,
				records: [{ record, digest: canonicalBrowserDigest(record) }],
				status: status(),
				lossRanges: [{ first: 1, last: 2 }]
			})
		)
	);
	const wire = transport({
		async gaps(scope, declaration) {
			declarations.push(declaration.declaration_id);
			if (declarations.length === 1) throw new Error('response lost');
			return {
				receipt: {
					declaration_id: declaration.declaration_id,
					declaration_revision: 1,
					request_digest: canonicalBrowserDigest(declaration),
					settled_through_sequence: 2
				},
				status: { ...status(scope), declaration_revision: 1, settled_through_sequence: 2 }
			};
		},
		async append(scope, records) {
			batches++;
			return transport().append(scope, records);
		}
	});
	const service = await BrowserDeliveryService.create(binding.attemptId, store, wire, () => true);
	await assert.rejects(service.deliver(binding.sourceInstanceId));
	await service.deliver(binding.sourceInstanceId);
	assert.equal(declarations[0], declarations[1]);
	assert.equal(batches, 0);
	await service.deliver(binding.sourceInstanceId);
	assert.equal(batches, 1);
});

void test('server summary-only status recovers receipts and reports omitted tail without allocating detail', async () => {
	const store = new Store();
	let collecting = true;
	const summaries: components['schemas']['UnretainedDeliverySummary'][] = [];
	const summaryStatus = () => ({
		...status(),
		detail_mode: 'summary_only' as const,
		budget_scope: 'participation' as const,
		summary_only_reason: 'records' as const,
		terminal_missing_through_sequence: 1
	});
	const wire = transport({
		async status() {
			return collecting ? status() : summaryStatus();
		},
		async summary(_scope, summary) {
			summaries.push(summary);
			return { status: summaryStatus(), summary };
		}
	});
	const service = await BrowserDeliveryService.create(binding.attemptId, store, wire, () => true);
	await service.start(binding, { kind: 'initial' });
	await service.append(binding.sourceInstanceId, opened);
	collecting = false;
	await service.deliver(binding.sourceInstanceId);
	assert.equal(await service.append(binding.sourceInstanceId, opened), undefined);
	assert.equal(service.allocated(binding.sourceInstanceId), 1);
	await service.deliver(binding.sourceInstanceId);
	assert.equal(summaries[0]?.unretained_record_count, 2);
	assert.equal(summaries[0]?.count_complete, true);
});

void test('bounded spool reserves a truthful gap instead of silently dropping a record', async () => {
	const store = new Store();
	const records = Array.from({ length: 8192 }, (_, index) => {
		const record = {
			...opened,
			sequence: index + 1,
			policy_revision_id: binding.policyRevision
		};
		return { record, digest: canonicalBrowserDigest(record) };
	});
	store.records.set(
		`browser_${binding.sourceInstanceId}`,
		new TextEncoder().encode(
			JSON.stringify({
				version: 1,
				binding,
				transition: { kind: 'initial' },
				allocated: 8192,
				records,
				status: status()
			})
		)
	);
	const service = await BrowserDeliveryService.create(
		binding.attemptId,
		store,
		transport(),
		() => true
	);
	assert.equal((await service.append(binding.sourceInstanceId, opened))?.sequence, 8193);
	const snapshot = JSON.parse(new TextDecoder().decode([...store.records.values()][0]));
	assert.equal(snapshot.records.length, 8192);
	assert.deepEqual(snapshot.lossRanges, [{ first: 8193, last: 8193 }]);
});

void test('a captured event remains durable when pause wins the subsequent storage turn', async () => {
	const store = new Store();
	let active = true;
	const service = await BrowserDeliveryService.create(
		binding.attemptId,
		store,
		transport(),
		() => active
	);
	await service.start(binding, { kind: 'initial' });
	const captured = service.append(binding.sourceInstanceId, opened);
	active = false;
	assert.equal((await captured)?.sequence, 1);
	await assert.rejects(service.append(binding.sourceInstanceId, opened));
	assert.equal(service.allocated(binding.sourceInstanceId), 1);
});

void test('recovery selects the declared successor instead of reopening its predecessor', async () => {
	const store = new Store();
	const next = { ...binding, sourceInstanceId: '12345678-1234-4234-9234-123456789abc' };
	const wire = transport({
		async start(scope) {
			if (scope.sourceInstanceId === next.sourceInstanceId) throw new Error('response lost');
			return status(scope);
		}
	});
	const service = await BrowserDeliveryService.create(binding.attemptId, store, wire, () => true);
	await service.start(binding, { kind: 'initial' });
	await assert.rejects(
		service.start(next, {
			kind: 'runtime_reset',
			predecessor_source_session_id: binding.sourceInstanceId,
			reason: 'coordinator_restarted'
		})
	);
	service.dispose();
	const restored = await BrowserDeliveryService.create(
		binding.attemptId,
		store,
		wire,
		() => true
	);
	assert.equal(
		restored.currentSource(binding.participationId, 1)?.sourceInstanceId,
		next.sourceInstanceId
	);
});

void test('source sink bounds pending capture and contains synchronously when storage cannot keep up', async () => {
	const { ServerBrowserActivitySinkFactory } =
		await import('../../../../../src/prctr/workbench/services/integratedBrowser/node/serverBrowserActivitySink.ts');
	const store = new Store();
	const delivery = await BrowserDeliveryService.create(
		binding.attemptId,
		store,
		transport(),
		() => true
	);
	let contained = 0;
	const factory = new ServerBrowserActivitySinkFactory(delivery, {
		participationId: binding.participationId,
		unavailable() {
			contained++;
		},
		pending() {},
		now: () => Date.parse(time)
	});
	const sink = await factory.create({
		schemaVersion: 1,
		attemptId: binding.attemptId,
		participationGeneration: 1,
		revision: binding.policyRevision,
		ordinal: 1,
		digest: binding.policyDigest,
		rules: []
	});
	for (let index = 0; index < 256; index++) sink.append('browserOpened');
	assert.throws(() => sink.append('browserOpened'), /queue/);
	assert.equal(contained, 1);
	await assert.rejects(sink.flush(), /queue/);
	delivery.dispose();
});

void test('foundation keeps source authority across separate native panel instances', async () => {
	const { BrowserFoundation } =
		await import('../../../../../src/prctr/workbench/services/integratedBrowser/node/browserFoundation.ts');
	const browserPolicy = {
		enabled: true,
		start_rule_id: 'docs',
		rules: [
			{
				rule_id: 'docs',
				origin: 'https://example.com',
				path_prefix: '/',
				host_match: 'exact',
				allow_redirects: true,
				blocked_navigation_outcome: 'record',
				institution_http_exception: false
			}
		]
	};
	const candidatePolicy = {
		...browserPolicy,
		policy_revision_id: binding.policyRevision,
		policy_revision_number: 1,
		policy_digest: canonicalBrowserDigest(browserPolicy),
		browser_activity_disclosure: {
			audience: 'exam_managers_with_browser_activity_permission',
			browser_activity_retention_days: 30,
			may_create_integrity_evidence: false,
			notice_id: 'integrated_browser_activity',
			retention_anchor: 'eligible_closed_sitting_records_completion',
			retention_policy_revision: 1
		}
	};
	let starts = 0,
		destroyed = 0;
	let delivered = () => {};
	const deliveryResumed = new Promise<void>((resolve) => {
		delivered = resolve;
	});
	const foundation = await BrowserFoundation.create({
		attemptId: binding.attemptId,
		store: new Store(),
		transport: transport({
			async status(scope) {
				delivered();
				return status(scope);
			},
			async start(scope) {
				starts++;
				return status(scope);
			}
		}),
		canCapture: () => true,
		unavailable() {
			throw new Error('unexpected containment');
		},
		deliveryFailed() {},
		now: () => Date.parse(time)
	});
	foundation.setOnline(false);
	const sessionOptions = {
		participationId: binding.participationId,
		generation: 1,
		institutionOrigin: 'https://example.com',
		candidatePolicy,
		currentGate: () => ({
			attemptState: 'active' as const,
			participationGeneration: 1,
			paused: false,
			posture: 'compliant' as const,
			coordinatorAvailable: true
		}),
		hostFactory: {
			async create(
				delegate: import('../../../../../src/prctr/platform/integratedBrowser/common/browserEnforcement.ts').BrowserEnforcementDelegate
			) {
				return {
					async open(url: string) {
						delegate.commitTopLevel(url, 'navigation');
					},
					async navigate() {},
					async back() {},
					async forward() {},
					async reload() {},
					async close() {
						destroyed++;
					},
					setInputBlocked() {},
					setSurface() {},
					surfaceFocused() {
						return false;
					},
					onDidChangeSurfaceFocus() {
						return { dispose() {} };
					},
					historyState() {
						return { canGoBack: false, canGoForward: false };
					}
				};
			}
		}
	};
	const first = await foundation.createSession(sessionOptions);
	await first.coordinator.handleIntent({ kind: 'browser.open', startRuleId: first.startRuleId });
	await first.dispose();
	const second = await foundation.createSession(sessionOptions);
	await second.coordinator.handleIntent({
		kind: 'browser.open',
		startRuleId: second.startRuleId
	});
	const disposeCoordinator = second.coordinator.dispose.bind(second.coordinator);
	second.coordinator.dispose = async () => {
		throw new Error('close flush unavailable');
	};
	await assert.rejects(foundation.dispose(), /close flush/);
	second.coordinator.dispose = disposeCoordinator;
	foundation.setOnline(true);
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			deliveryResumed,
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error('delivery did not resume after failed close')),
					1000
				);
			})
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
	foundation.setOnline(false);
	await second.dispose();
	assert.equal(starts, 1);
	assert.equal(destroyed, 2);
	assert.equal(foundation.delivery.inventory().length, 1);
	assert.equal(
		foundation.delivery.allocated(foundation.delivery.inventory()[0]!.sourceInstanceId),
		6
	);
	await foundation.dispose();
});

void test('slow delivery never blocks durable capture or overwrites a concurrent event', async () => {
	let release: (() => void) | undefined;
	let entered: (() => void) | undefined;
	const waiting = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const response = new Promise<void>((resolve) => {
		release = resolve;
	});
	const store = new Store();
	let requests = 0;
	const service = await BrowserDeliveryService.create(
		binding.attemptId,
		store,
		transport({
			async append(scope, records) {
				requests++;
				entered!();
				await response;
				return transport().append(scope, records);
			}
		}),
		() => true
	);
	await service.start(binding, { kind: 'initial' });
	await service.append(binding.sourceInstanceId, opened);
	const delivery = service.deliver(binding.sourceInstanceId);
	await waiting;
	const next = await service.append(binding.sourceInstanceId, opened);
	assert.equal(next?.sequence, 2);
	release!();
	await delivery;
	assert.equal(
		JSON.parse(new TextDecoder().decode([...store.records.values()][0])).records[0].record
			.sequence,
		2
	);
	await service.deliver(binding.sourceInstanceId);
	assert.equal(requests, 2);
});
