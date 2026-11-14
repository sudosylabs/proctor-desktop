/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Emitter } from '../../../../../src/prctr/base/common/event.ts';
import type {
	Fact,
	Notification,
	Policy,
	RuleStatus
} from '../../../../../src/prctr/platform/native/common/nativeAgentProtocol.generated.ts';
import type {
	INativeAgentService,
	NativeAgentClip,
	NativeAgentPhase,
	NativeAgentSnapshot
} from '../../../../../src/prctr/platform/native/electron-main/nativeAgentService.ts';
import type { NativeAgentFailure } from '../../../../../src/prctr/platform/native/node/nativeAgentConnection.ts';
import type { ProtectedRecordStore } from '../../../../../src/prctr/platform/protectedStorage/node/protectedRecordStore.ts';
import {
	ServerCommandError,
	type IServerEvents,
	type ServerCommandChannel
} from '../../../../../src/prctr/platform/serverApi/common/serverEvents.ts';
import type { SessionApi } from '../../../../../src/prctr/platform/serverApi/node/sessionApi.ts';
import {
	ExamParticipationService,
	ParticipationError
} from '../../../../../src/prctr/workbench/services/examSecurity/electron-main/examParticipationService.ts';

const SITTING = 'h9nfemqtwz47ydgjcx1ia56br8';
const ATTEMPT = 'qtwz47ydgjcx1ia56br8kpous3';
const PARTICIPATION = '8kpous3h9nfemqtwz47ydgjcx1';
const DIGEST = (byte: string) => `sha256:${byte.repeat(64)}`;
const REGISTRY = 'sha256:e4c05771fa6f34c08c0f01aa98e33f88973baacf832c67d760457f2b4f9d734d';

const rules = [
	{
		rule_id: 'baseline.single_display',
		capability: 'display',
		mode: 'enforce',
		phase: 'both',
		reason: 'display.single_display_required',
		requirement: { Compare: { field: 'display.summary.active_physical', op: 'eq', value: 1 } }
	},
	{
		rule_id: 'baseline.window',
		capability: 'candidate_window',
		mode: 'enforce',
		phase: 'participation',
		reason: 'candidate_window.window_required',
		requirement: { Compare: { field: 'candidate_window.presence', op: 'eq', value: 'present' } }
	}
] as const;

function policy(
	scope:
		{ kind: 'admission'; admission_scope_id: string } | { kind: 'attempt'; attempt_id: string }
) {
	const family = (id: string, extra: Record<string, unknown> = {}) => ({
		id,
		mode: 'disabled',
		outcome: 'flag',
		...extra
	});
	return {
		policy_id: 'policy-1',
		revision: '1',
		ordinal: 1,
		digest: DIGEST('a'),
		institution_id: 'ybndrfg8ejkmcpqxot1uwisza3',
		exam_revision_id: 'ybndrfg8ejkmcpqxot1uwisza4',
		sitting_id: SITTING,
		scope,
		issued_at: '2026-11-13T09:00:00.000Z',
		active_from: '2026-11-13T09:00:00.000Z',
		application_release_id: 'dev-1',
		matrix_id: 'matrix-1',
		target_tuple: 'aarch64-apple-darwin',
		registry_digest: REGISTRY,
		focus_loss_mode: 'observe',
		connection_loss_mode: 'enforce',
		resolved_exception_refs: [],
		evidence_class_id: 'native_integrity',
		visibility_class_id: 'examiner_restricted',
		retention_class_id: 'native_minimized',
		capabilities: [
			family('process_application', { allowed_application_ids: [] }),
			family('interactive_session'),
			family('clipboard', { observe_os_clipboard_changes: false, strategy: 'disabled' }),
			family('printing', {
				candidate_print_commands: 'not_applied',
				monitored_spooler: 'not_required'
			}),
			family('removable_storage', { enabled_sub_capabilities: [] }),
			family('virtualization', { rule: 'not_applied' }),
			family('network_configuration', { enabled_sub_capabilities: [] }),
			family('camera', { concurrent_use_check: 'not_required', require_ready: false }),
			family('microphone', { concurrent_use_check: 'not_required', require_ready: false }),
			family('external_capture')
		],
		screen_recording: { enabled: false },
		activations: [
			{ capability: 'display', categories: [] },
			{ capability: 'candidate_window', categories: [] }
		],
		rules
	};
}

function fact(capability: string, state: Record<string, unknown> = {}, sequence = 1): Fact {
	return {
		capability,
		source_instance_id: `${capability.replace('_', '')}00001`,
		sequence,
		captured_at_ms: 10,
		envelope: { permission: 'granted', health: 'healthy', certainty: 'complete' },
		state,
		summary: {},
		changes: []
	};
}

function status(rule_id: string, value: RuleStatus['status']): RuleStatus {
	return { rule_id, status: value, local_effect: 'none' };
}

class FakeAgent implements INativeAgentService {
	declare readonly _serviceBrand: undefined;
	public readonly onDidNotifyEmitter = new Emitter<Notification>();
	public readonly onDidNotify = this.onDidNotifyEmitter.event;
	public readonly onDidChangeContainment = new Emitter<boolean>().event;
	public readonly restartEmitter = new Emitter<NativeAgentSnapshot>();
	public readonly onDidRestart = this.restartEmitter.event;
	public readonly failEmitter = new Emitter<NativeAgentFailure>();
	public readonly onDidFail = this.failEmitter.event;
	public readonly onDidClip = new Emitter<NativeAgentClip>().event;
	public phase: NativeAgentPhase = 'idle';
	public contained = false;
	public readonly calls: string[] = [];
	public readonly hostEvents: { capability: string; event: unknown }[] = [];
	public bindingRules: RuleStatus[] = [status('baseline.single_display', 'met')];
	public opened: Policy | undefined;

	public async query(capability: string): Promise<Fact> {
		this.calls.push(`query:${capability}`);
		return fact(capability, { presence: 'present' }, 2);
	}
	public async openReadiness(_id: string, policy: Policy): Promise<NativeAgentSnapshot> {
		this.calls.push('openReadiness');
		this.opened = policy;
		this.phase = 'readiness';
		return { facts: [], rules: [status('baseline.single_display', 'met')] };
	}
	public async beginParticipation(): Promise<NativeAgentSnapshot> {
		this.calls.push('beginParticipation');
		this.phase = 'binding';
		return {
			facts: [
				fact('candidate_window', { presence: 'absent' }),
				fact('display', { displays: [] })
			],
			rules: [...this.bindingRules, status('baseline.window', 'not_met')]
		};
	}
	public async confirmParticipation(): Promise<readonly RuleStatus[]> {
		this.calls.push('confirmParticipation');
		this.phase = 'participation';
		return [status('baseline.single_display', 'met'), status('baseline.window', 'met')];
	}
	public async recorderSave(): Promise<void> {}
	public async recorderRelease(): Promise<void> {}
	public async abandonParticipation(): Promise<readonly RuleStatus[]> {
		this.calls.push('abandonParticipation');
		this.phase = 'readiness';
		return [];
	}
	public sendHostEvent(capability: string, event: unknown): void {
		this.hostEvents.push({ capability, event });
	}
	public async close(disposition: 'delete' | 'seal'): Promise<NativeAgentSnapshot | undefined> {
		this.calls.push(`close:${disposition}`);
		this.phase = 'idle';
		return undefined;
	}
	public dispose(): void {}
}

class Store implements ProtectedRecordStore {
	private readonly records = new Map<string, Uint8Array>();
	public async read(key: string) {
		return this.records.get(key);
	}
	public async write(key: string, bytes: Uint8Array) {
		this.records.set(key, bytes);
	}
	public async delete(key: string) {
		this.records.delete(key);
	}
	public async list(prefix = '') {
		return [...this.records.keys()].filter((key) => key.startsWith(prefix));
	}
	public dispose() {}
}

interface Call {
	readonly operation: string;
	readonly input: Record<string, unknown>;
}

class Server {
	public readonly calls: Call[] = [];
	public readonly commands: { action: string; data: Record<string, unknown> }[] = [];
	public overviewDigest = DIGEST('d');
	public prepareDigest = DIGEST('d');
	public admission: 'eligible' | 'blocked' = 'eligible';
	public connectContentDigest = DIGEST('c');
	private readonly listeners = new Map<string, (event: { data: unknown }) => void>();
	public readonly continuity = new Emitter<void>();

	public api(): Pick<SessionApi, 'request'> {
		return {
			request: (async (operation: string, input: Record<string, unknown>) => {
				this.calls.push({ operation, input });
				return {
					status: operation === 'submitExamAttempt' ? 201 : 200,
					value: this.answer(operation, input),
					headers: {}
				};
			}) as unknown as SessionApi['request']
		};
	}

	private answer(operation: string, input: Record<string, unknown>): unknown {
		const disclosures = {
			browser_activity_disclosure: {},
			screen_recording_disclosure: null,
			catalog_bindings: [],
			capability_matrix_digest: DIGEST('e'),
			server_time: '2026-11-13T09:00:00.000Z'
		};
		switch (operation) {
			case 'getSecurityPolicyOverview':
				return {
					...disclosures,
					policy: policy({ kind: 'admission', admission_scope_id: 's1' }),
					readiness_digest: this.overviewDigest
				};
			case 'prepareSecurityPreflight':
				return {
					...disclosures,
					policy: policy({ kind: 'admission', admission_scope_id: 's1' }),
					readiness_digest: this.prepareDigest,
					policy_content_digest: DIGEST('c'),
					frozen_attempt_configuration: null,
					preflight_challenge: {
						preflight_id: 'preflight-1',
						challenge: 'x'.repeat(43),
						issued_at: '2026-11-13T09:00:00.000Z',
						expires_at: new Date(Date.now() + 60_000).toISOString()
					}
				};
			case 'reportSecurityPreflight':
				return {
					preflight_id: 'preflight-1',
					report_digest: DIGEST('f'),
					admission: this.admission,
					reason_codes: this.admission === 'blocked' ? ['native_rule_unmet'] : [],
					rules: [],
					server_time: '2026-11-13T09:00:00.000Z',
					expires_at: new Date(Date.now() + 60_000).toISOString()
				};
			case 'appendNativeDelivery': {
				const body = input['body'] as { stream_id: string; batch_sequence: number };
				return {
					receipt: {
						stream_id: body.stream_id,
						batch_sequence: body.batch_sequence,
						request_digest: (input['header'] as Record<string, string>)[
							'Idempotency-Key'
						],
						received_at: '2026-11-13T09:00:00.000Z'
					},
					highest_contiguous_batch_sequence: body.batch_sequence,
					settled_through_batch_sequence: body.batch_sequence,
					highest_seen_batch_sequence: body.batch_sequence,
					missing_batch_ranges: [],
					missing_ranges_truncated: false,
					server_time: '2026-11-13T09:00:00.000Z'
				};
			}
			default:
				return {};
		}
	}

	public events(): Pick<IServerEvents, 'on' | 'openCommandChannel' | 'onDidLoseContinuity'> {
		return {
			on: ((name: string, _scope: unknown, listener: (event: { data: unknown }) => void) => {
				this.listeners.set(name, listener);
				return { accepted: Promise.resolve(), dispose: () => this.listeners.delete(name) };
			}) as unknown as IServerEvents['on'],
			openCommandChannel: () => this.channel(),
			onDidLoseContinuity: this.continuity.event
		};
	}

	public emit(name: string, data: unknown): void {
		this.listeners.get(name)?.({ data });
	}

	private channel(): ServerCommandChannel {
		return {
			send: async (action, data) => {
				this.commands.push({ action, data: data as Record<string, unknown> });
				if (action === 'exam_attempt.connect')
					return this.connectReply(data as Record<string, unknown>);
				if (action === 'exam_attempt.renew')
					return {
						generation: 1,
						accepted_sequence: (data as { sequence: number }).sequence,
						database_time: '2026-11-13T09:00:05.000Z',
						lease_expires_at: new Date(Date.now() + 15_000).toISOString(),
						duplicate: false,
						security_control: {
							processed_control_sequence: 1,
							processed_control_digest: DIGEST('9'),
							security_interaction_allowed: true,
							delivery_watermark_rejections: []
						}
					};
				if (action === 'exam_attempt.security.update')
					return {
						processed_control_sequence: 2,
						processed_control_digest: DIGEST('9'),
						security_interaction_allowed: false,
						delivery_watermark_rejections: []
					};
				return {};
			},
			needsResynchronization: false,
			onDidNeedResynchronization: new Emitter<void>().event,
			resynchronized: () => undefined,
			dispose: () => undefined
		};
	}

	private connectReply(data: Record<string, unknown>) {
		const security = data['security'] as { report_digest: string };
		return {
			attempt_connection_id: 'nfemqtwz47ydgjcx1ia56br8kp',
			attempt_id: ATTEMPT,
			browser_policy: null,
			candidate_runtime_capabilities: {},
			first_admission: true,
			generation: 1,
			lease_expires_at: new Date(Date.now() + 15_000).toISOString(),
			live_corrections: [],
			participation_id: PARTICIPATION,
			renewal_interval_seconds: 5,
			replayed: false,
			started_at: '2026-11-13T09:00:00.000Z',
			workspace_id: 'br8kpous3h9nfemqtwz47ydgjc',
			security: {
				policy: policy({ kind: 'attempt', attempt_id: ATTEMPT }),
				policy_content_digest: this.connectContentDigest,
				preflight_id: 'preflight-1',
				preflight_report_digest: security.report_digest,
				preflight_policy_digest: DIGEST('a'),
				participation_id: PARTICIPATION,
				generation: 1,
				security_session_id: this.sessionId,
				delivery_stream_id: 'stream-1',
				renewal_interval_seconds: 5
			}
		};
	}

	public sessionId = '';
}

function setup() {
	const server = new Server();
	const agent = new FakeAgent();
	let counter = 0;
	const recordings = {
		deleted: [] as string[],
		open: async (attemptId: string) => ({
			recording_id: attemptId,
			key: 'k'.repeat(43),
			directory: '/recordings'
		}),
		delete: async (attemptId: string) => {
			recordings.deleted.push(attemptId);
		}
	};
	const service = new ExamParticipationService({
		api: server.api(),
		events: server.events(),
		agent,
		certification: { kind: 'development' },
		nativeRegistryDigest: REGISTRY,
		configurationManifestFingerprint: DIGEST('8'),
		openSpool: async () => new Store(),
		recordings,
		randomBytes: (length) => new Uint8Array(length).fill(++counter)
	});
	server.sessionId = Buffer.from(new Uint8Array(16).fill(1)).toString('hex');
	return { server, agent, service, recordings };
}

async function settle(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!predicate() && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 5));
}

void test('readiness, Start and Connect bind the agent, report in activation order and admit', async () => {
	const { server, agent, service } = setup();
	const view = await service.openReadiness(SITTING);
	assert.equal(view.readinessDigest, DIGEST('d'));
	assert.deepEqual(
		agent.opened?.activations.map((activation) => activation.capability),
		['display', 'candidate_window']
	);
	await service.start(SITTING);
	assert.equal(service.phase, 'admitted');
	const report = server.calls.find((call) => call.operation === 'reportSecurityPreflight')?.input[
		'body'
	] as {
		capabilities: { capability: string }[];
		rules: { rule_id: string }[];
		security_session_id: string;
	};
	assert.deepEqual(
		report.capabilities.map((entry) => entry.capability),
		['display', 'candidate_window']
	);
	assert.deepEqual(
		report.rules.map((rule) => rule.rule_id),
		['baseline.single_display'],
		'readiness rules only'
	);
	assert.equal(report.security_session_id, server.sessionId);
	const connect = server.commands.find(
		(command) => command.action === 'exam_attempt.connect'
	)?.data;
	assert.deepEqual(connect?.['security'], {
		kind: 'preflight',
		preflight_id: 'preflight-1',
		report_digest: DIGEST('f')
	});
	assert.equal((connect?.['continuity_credential'] as string).length, 43);
	assert.equal(service.admitted?.attemptId, ATTEMPT);
	service.dispose();
});

void test('the mounted window fact reaches the server before participation_confirmed', async () => {
	const { server, agent, service } = setup();
	await service.start(SITTING);
	await service.candidateMounted({ nativeWindow: '4242' });
	assert.deepEqual(agent.hostEvents[0], {
		capability: 'candidate_window',
		event: { attach: { window: '4242' } }
	});
	assert.equal(service.phase, 'participating');
	await settle(() => server.calls.some((call) => call.operation === 'appendNativeDelivery'));
	const kinds = server.calls
		.filter((call) => call.operation === 'appendNativeDelivery')
		.flatMap(
			(call) =>
				(call.input['body'] as { records: { kind: string; capability?: string }[] }).records
		)
		.map((record) =>
			record.kind === 'capability_fact' ? `fact:${record.capability}` : record.kind
		);
	assert.ok(
		kinds.indexOf('fact:candidate_window') < kinds.indexOf('participation_confirmed'),
		kinds.join()
	);
	assert.equal(service.projection().posture, 'compliant');
	assert.equal(service.projection().canSubmit, true);
	service.dispose();
});

void test('a restart during readiness replaces the rule statuses', async () => {
	const { agent, service } = setup();
	await service.openReadiness(SITTING);
	agent.restartEmitter.fire({ facts: [], rules: [status('baseline.window', 'not_met')] });
	assert.deepEqual(service.readinessView()?.rules, [status('baseline.window', 'not_met')]);
	service.dispose();
});

void test('an agent failure during readiness fails it until checks are retried', async () => {
	const { agent, service } = setup();
	await service.openReadiness(SITTING);
	agent.failEmitter.fire('exited');
	assert.equal(service.phase, 'failed');
	assert.equal(service.projection().posture, 'failed');
	await service.openReadiness(SITTING);
	assert.equal(service.phase, 'readiness');
	service.dispose();
});

void test('a restart during participation re-attaches the window and delivers the fresh states', async () => {
	const { server, agent, service } = setup();
	await service.start(SITTING);
	await service.candidateMounted({ nativeWindow: '4242' });
	agent.hostEvents.length = 0;
	agent.restartEmitter.fire({
		facts: [fact('display', { displays: [] }, 0)],
		rules: [status('baseline.window', 'not_met')]
	});
	assert.deepEqual(agent.hostEvents, [
		{ capability: 'candidate_window', event: { attach: { window: '4242' } } }
	]);
	const displayFacts = () =>
		server.calls
			.filter((call) => call.operation === 'appendNativeDelivery')
			.flatMap(
				(call) =>
					(call.input['body'] as { records: { kind: string; capability?: string }[] })
						.records
			)
			.filter(
				(record) => record.kind === 'capability_fact' && record.capability === 'display'
			);
	await settle(() => displayFacts().length > 0);
	assert.equal(displayFacts().length, 1, 'the restarted display state is delivered');
	service.dispose();
});

void test('a renewal carries the security control with the native watermark', async () => {
	const { server, service } = setup();
	await service.start(SITTING);
	await service.renew();
	const renew = server.commands.find((command) => command.action === 'exam_attempt.renew')?.data;
	assert.equal(renew?.['sequence'], 1);
	const control = renew?.['security_control'] as {
		control_sequence: number;
		stream_id: string;
		delivery_watermarks: { family: string; source_id: string }[];
	};
	assert.equal(control.control_sequence, 1);
	assert.equal(control.stream_id, 'stream-1');
	assert.deepEqual(
		control.delivery_watermarks.map((mark) => [mark.family, mark.source_id]),
		[['native', 'stream-1']]
	);
	service.dispose();
});

void test('a security update between renewals applies the server result', async () => {
	const { server, service } = setup();
	await service.start(SITTING);
	await service.securityUpdate();
	assert.ok(server.commands.some((command) => command.action === 'exam_attempt.security.update'));
	assert.equal(service.projection().posture, 'contained', 'the server withdrew interaction');
	service.dispose();
});

void test('a changed readiness digest at Start refreshes readiness and stops', async () => {
	const { server, agent, service } = setup();
	await service.openReadiness(SITTING);
	server.prepareDigest = DIGEST('7');
	await assert.rejects(
		service.start(SITTING),
		(error: unknown) =>
			error instanceof ParticipationError && error.code === 'readiness_changed'
	);
	assert.equal(service.phase, 'readiness');
	assert.equal(service.readinessView()?.readinessDigest, DIGEST('7'));
	assert.equal(agent.calls.filter((call) => call === 'openReadiness').length, 2);
	service.dispose();
});

void test('a blocked preflight abandons the binding and returns to readiness', async () => {
	const { server, agent, service } = setup();
	server.admission = 'blocked';
	await assert.rejects(
		service.start(SITTING),
		(error: unknown) =>
			error instanceof ParticipationError && error.code === 'preflight_blocked'
	);
	assert.ok(agent.calls.includes('abandonParticipation'));
	assert.equal(service.phase, 'readiness');
	assert.equal(server.commands.length, 0, 'nothing connects');
	service.dispose();
});

void test('an enforce readiness rule no longer met before Connect stops Start', async () => {
	const { server, agent, service } = setup();
	agent.bindingRules = [status('baseline.single_display', 'unknown')];
	await assert.rejects(
		service.start(SITTING),
		(error: unknown) =>
			error instanceof ParticipationError && error.code === 'readiness_regressed'
	);
	assert.equal(server.commands.length, 0);
	service.dispose();
});

void test('an admitted binding that differs from the prepared one is refused', async () => {
	const { server, service } = setup();
	server.connectContentDigest = DIGEST('6');
	await assert.rejects(
		service.start(SITTING),
		(error: unknown) => error instanceof ParticipationError && error.code === 'binding_mismatch'
	);
	service.dispose();
});

void test('suspension seals the recording and ends live access; reallow allows a rejoin', async () => {
	const { server, agent, service } = setup();
	await service.start(SITTING);
	await service.candidateMounted({ nativeWindow: '1' });
	server.emit('exam_attempt_access_suspended', {
		exam_attempt_id: ATTEMPT,
		exam_sitting_id: SITTING,
		state: 'suspended',
		changed_at: '2026-11-13T09:01:00.000Z'
	});
	await settle(() => agent.calls.includes('close:seal'));
	assert.equal(service.phase, 'suspended');
	assert.equal(service.access(), undefined);
	assert.equal(service.projection().attemptState, 'suspended');
	server.emit('exam_attempt_access_reallowed', {
		exam_attempt_id: ATTEMPT,
		exam_sitting_id: SITTING,
		state: 'active',
		changed_at: '2026-11-13T09:02:00.000Z'
	});
	await settle(() => service.phase === 'idle');
	assert.equal(service.rejoinAttemptId(), ATTEMPT);
	service.dispose();
});

void test('submission sends the live credentials and deletes the local recording', async () => {
	const { server, agent, service, recordings } = setup();
	await service.start(SITTING);
	await service.candidateMounted({ nativeWindow: '1' });
	await service.submit({ currentRevisionId: 'revision', workspaceCursor: 3 });
	assert.equal(recordings.deleted.length, 1, 'the recording key goes with the recording');
	const submit = server.calls.find((call) => call.operation === 'submitExamAttempt')?.input;
	assert.equal(
		(submit?.['header'] as Record<string, string>)['X-Proctor-Attempt-Connection-ID'],
		'nfemqtwz47ydgjcx1ia56br8kp'
	);
	assert.equal(service.phase, 'submitted');
	assert.ok(agent.calls.includes('close:delete'));
	assert.equal(service.projection().canSubmit, false);
	service.dispose();
});

void test('a refused Connect reports its server code', async () => {
	const { server, service } = setup();
	const events = server.events();
	const refusing = new ExamParticipationService({
		api: server.api(),
		events: {
			...events,
			openCommandChannel: () => ({
				...events.openCommandChannel(),
				send: async () => {
					throw new ServerCommandError('rejected', {
						code: 'exam.security.readiness_unmet'
					} as never);
				}
			})
		},
		agent: new FakeAgent(),
		certification: { kind: 'development' },
		nativeRegistryDigest: REGISTRY,
		configurationManifestFingerprint: DIGEST('8'),
		openSpool: async () => new Store(),
		randomBytes: (length) => new Uint8Array(length).fill(1)
	});
	await assert.rejects(
		refusing.start(SITTING),
		(error: unknown) =>
			error instanceof ParticipationError &&
			error.code === 'connect_refused' &&
			error.detail[0] === 'exam.security.readiness_unmet'
	);
	refusing.dispose();
	service.dispose();
});
