/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import type {
	Fact,
	Policy,
	RuleStatus
} from '../../../../platform/native/common/nativeAgentProtocol.generated.js';
import type {
	INativeAgentService,
	NativeAgentSnapshot
} from '../../../../platform/native/electron-main/nativeAgentService.js';
import type { ProtectedRecordStore } from '../../../../platform/protectedStorage/node/protectedRecordStore.js';
import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import { ServerApiError } from '../../../../platform/serverApi/common/serverApi.js';
import {
	ServerCommandError,
	type IServerEvents,
	type ServerCommandChannel
} from '../../../../platform/serverApi/common/serverEvents.js';
import { validateNamedSchema } from '../../../../platform/serverApi/node/serverContract.js';
import { isValidServerEventPayload } from '../../../../platform/serverApi/node/serverRealtimeContract.js';
import type { SessionApi } from '../../../../platform/serverApi/node/sessionApi.js';
import { BrowserDeliveryPump } from '../../integratedBrowser/node/browserDeliveryPump.js';
import { uncertifiedCapabilities, type CertificationEvidence } from '../common/certification.js';
import { agentPolicy, recordsScreen } from '../common/nativePolicy.js';
import { AgentClock, NativeRecordMapper, type NativeRecord } from '../common/nativeRecords.js';
import type {
	CandidateSecurityCondition,
	CandidateSecurityIntent,
	CandidateSecurityProjection,
	SafeSecurityReason
} from '../common/securityProjectionProtocol.js';
import { NativeDeliveryService } from '../node/nativeDeliveryService.js';
import {
	ServerNativeDeliveryTransport,
	type NativeDeliveryAccess
} from '../node/nativeDeliveryTransport.js';
import type { ExamSecurityIpcModel } from './examSecurityIpc.js';

type Schemas = components['schemas'];
export type SecurityPolicyOverview = Schemas['SecurityPolicyOverviewResponse'];
type SecurityPolicyResponse = Schemas['SecurityPolicyResponse'];
type AdmittedSecurity = Schemas['AdmittedSecurity'];
type SecurityControlResult = Schemas['SecurityControlResult'];

/** Connect must reach the server within this long of the report. */
export const CONNECT_WINDOW_MS = 30_000;

/** Why Start or a later step stopped. Only stable codes cross to presentation. */
export type ParticipationFailure =
	| 'readiness_changed'
	| 'uncertified'
	| 'preflight_blocked'
	| 'preflight_expired'
	| 'readiness_regressed'
	| 'connect_refused'
	| 'binding_mismatch'
	| 'invalid_state';

export class ParticipationError extends Error {
	public constructor(
		public readonly code: ParticipationFailure,
		public readonly detail: readonly string[] = []
	) {
		super(`exam participation failed: ${code}`);
		this.name = 'ParticipationError';
	}
}

export type ParticipationPhase =
	| 'idle'
	| 'readiness'
	| 'starting'
	| 'admitted'
	| 'participating'
	| 'suspended'
	| 'submitted'
	| 'failed';

/** What the readiness overview shows: the conditions and the disclosures, no OS detail. */
export interface ReadinessView {
	readonly sittingId: string;
	readonly readinessDigest: string;
	readonly rules: readonly RuleStatus[];
	readonly screenRecordingDisclosure: SecurityPolicyOverview['screen_recording_disclosure'];
	readonly browserActivityDisclosure: SecurityPolicyOverview['browser_activity_disclosure'];
}

/** The window the CandidateWindow composition mounted, as the agent sees it. */
export interface MountedCandidateWindow {
	/** The window's native handle as a decimal string, for the agent's attach host event. */
	readonly nativeWindow: string;
}

export interface ExamParticipationOptions {
	readonly api: Pick<SessionApi, 'request'>;
	readonly events: Pick<IServerEvents, 'on' | 'openCommandChannel' | 'onDidLoseContinuity'>;
	readonly agent: INativeAgentService;
	readonly certification: CertificationEvidence;
	readonly nativeRegistryDigest: string;
	readonly configurationManifestFingerprint: string;
	/** The encrypted spool for one Attempt's native stream. */
	readonly openSpool: (attemptId: string) => Promise<ProtectedRecordStore>;
	/** The recorder's start parameters when the policy records the screen. */
	readonly recording?: (
		attemptId: string
	) => Promise<Parameters<INativeAgentService['confirmParticipation']>[0]>;
	readonly randomBytes: (length: number) => Uint8Array;
	readonly now?: () => number;
}

interface Readiness {
	readonly sittingId: string;
	readonly overview: SecurityPolicyOverview;
	readonly policy: Policy;
	readonly securitySessionId: string;
	facts: Map<string, Fact>;
	rules: Map<string, RuleStatus>;
}

interface Admission {
	readonly sittingId: string;
	readonly attemptId: string;
	readonly workspaceId: string;
	readonly connectionId: string;
	readonly continuityCredential: string;
	readonly security: AdmittedSecurity;
	readonly policy: Policy;
	readonly recording: boolean;
	readonly delivery: NativeDeliveryService;
	readonly mapper: NativeRecordMapper;
	readonly pump: BrowserDeliveryPump;
	leaseExpiresAt: number;
	renewalSequence: number;
	controlSequence: number;
	processedControl: number;
	interactionAllowed: boolean;
	focusSequence: number;
	mounted: boolean;
	timer: ReturnType<typeof setInterval> | undefined;
}

const REASONS: Readonly<Record<string, SafeSecurityReason>> = {
	candidate_window: 'candidateWindow',
	display: 'display',
	interactive_session: 'interactiveSession',
	camera: 'media',
	microphone: 'media',
	network: 'network',
	printing: 'printing',
	process_application: 'processApplication',
	removable_storage: 'removableStorage',
	virtualization: 'virtualization'
};

function hex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('hex');
}

/**
 * Electron main's owner of one Session's exam participation: the readiness session, Start
 * (preflight, report, Connect), the admitted Participation's renewals and native delivery, the
 * CandidateWindow seam, suspension, Focus Loss and submission. It holds the realtime command
 * channel and the native agent; the CandidateWindow and the readiness overview see only its
 * projections.
 */
export class ExamParticipationService extends Disposable implements ExamSecurityIpcModel {
	private readonly _onDidChange = this._register(new Emitter<void>());
	/** The phase, readiness view or projection changed. */
	public readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly now: () => number;
	private readonly clock: AgentClock;
	private _phase: ParticipationPhase = 'idle';
	private readiness: Readiness | undefined;
	private admission: Admission | undefined;
	private channel: ServerCommandChannel | undefined;
	private projectionRevision = 0;
	private attemptRevision = 0;
	private readonly subscriptions: IDisposable[] = [];

	public constructor(private readonly options: ExamParticipationOptions) {
		super();
		this.now = options.now ?? Date.now;
		this.clock = new AgentClock(this.now);
		this._register(
			options.agent.onDidNotify((notification) => void this.notified(notification))
		);
		this._register(
			options.agent.onDidChangeContainment(() => {
				this.publish();
			})
		);
		this._register(
			options.events.onDidLoseContinuity(() => {
				void this.recover();
			})
		);
	}

	public get phase(): ParticipationPhase {
		return this._phase;
	}

	/** The readiness overview's model, while readiness is open. */
	public readinessView(): ReadinessView | undefined {
		const readiness = this.readiness;
		if (readiness === undefined) return undefined;
		return {
			sittingId: readiness.sittingId,
			readinessDigest: readiness.overview.readiness_digest,
			rules: [...readiness.rules.values()],
			screenRecordingDisclosure: readiness.overview.screen_recording_disclosure,
			browserActivityDisclosure: readiness.overview.browser_activity_disclosure
		};
	}

	// ---- Readiness ------------------------------------------------------------------------

	/** Opens the readiness overview for a Sitting: reads its policy and starts the agent on it. */
	public async openReadiness(sittingId: string): Promise<ReadinessView> {
		this.require('idle', 'readiness', 'failed');
		const result = await this.options.api.request('getSecurityPolicyOverview', {
			path: { exam_sitting_id: sittingId }
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
		await this.openWith(sittingId, result.value);
		return this.readinessView()!;
	}

	private async openWith(sittingId: string, overview: SecurityPolicyOverview): Promise<void> {
		const policy = agentPolicy(overview.policy);
		if (this.options.agent.phase !== 'idle') await this.options.agent.close('delete');
		const securitySessionId = hex(this.options.randomBytes(16));
		const snapshot = await this.options.agent.openReadiness(securitySessionId, policy);
		this.readiness = {
			sittingId,
			overview,
			policy,
			securitySessionId,
			facts: new Map(),
			rules: new Map()
		};
		this.absorb(snapshot);
		this._phase = 'readiness';
		this.publish();
	}

	private absorb(snapshot: NativeAgentSnapshot): void {
		const readiness = this.readiness;
		if (readiness === undefined) return;
		for (const fact of snapshot.facts) readiness.facts.set(fact.capability, fact);
		for (const rule of snapshot.rules) readiness.rules.set(rule.rule_id, rule);
	}

	/** Closes readiness without starting. */
	public async closeReadiness(): Promise<void> {
		if (this._phase !== 'readiness') return;
		this.readiness = undefined;
		this._phase = 'idle';
		await this.options.agent.close('delete');
		this.publish();
	}

	// ---- Start ----------------------------------------------------------------------------

	/**
	 * Start: prepares the preflight, binds the agent, reports, and connects. `attemptId` is set
	 * only to rejoin a ready Attempt. On success the Participation is admitted and renewing; the
	 * caller then opens the CandidateWindow and calls {@link candidateMounted}.
	 */
	public async start(sittingId: string, attemptId?: string): Promise<void> {
		if (this.readiness?.sittingId !== sittingId) await this.openReadiness(sittingId);
		this.require('readiness');
		this._phase = 'starting';
		this.publish();
		let bound = false;
		try {
			const prepared = await this.prepare(sittingId, attemptId);
			const missing = uncertifiedCapabilities(prepared.policy, this.options.certification);
			if (missing.length > 0) throw new ParticipationError('uncertified', missing);
			const snapshot = await this.options.agent.beginParticipation();
			bound = true;
			this.absorb(snapshot);
			const reportedAt = this.now();
			const result = await this.report(prepared, snapshot);
			if (result.admission !== 'eligible')
				throw new ParticipationError('preflight_blocked', result.reason_codes);
			if (
				this.now() - reportedAt > CONNECT_WINDOW_MS ||
				this.now() >= Date.parse(result.expires_at)
			)
				throw new ParticipationError('preflight_expired');
			this.recheck();
			await this.connect(sittingId, prepared, result.report_digest);
		} catch (error) {
			if (bound && this.options.agent.phase === 'binding')
				await this.options.agent.abandonParticipation().catch(() => undefined);
			if (this._phase === 'starting') this._phase = 'readiness';
			this.publish();
			throw error;
		}
	}

	private async prepare(sittingId: string, attemptId: string | undefined) {
		const result = await this.options.api.request('prepareSecurityPreflight', {
			path: { exam_sitting_id: sittingId },
			header: { 'Idempotency-Key': hex(this.options.randomBytes(16)) },
			body: {
				...(attemptId === undefined ? {} : { attempt_id: attemptId }),
				native_registry_digest: this.options.nativeRegistryDigest,
				configuration_manifest_fingerprint: this.options.configurationManifestFingerprint
			}
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
		const prepared: SecurityPolicyResponse = result.value;
		if (prepared.readiness_digest !== this.readiness?.overview.readiness_digest) {
			await this.openWith(sittingId, {
				server_time: prepared.server_time,
				policy: prepared.policy,
				readiness_digest: prepared.readiness_digest,
				capability_matrix_digest: prepared.capability_matrix_digest,
				catalog_bindings: prepared.catalog_bindings,
				browser_activity_disclosure: prepared.browser_activity_disclosure,
				screen_recording_disclosure: prepared.screen_recording_disclosure
			});
			throw new ParticipationError('readiness_changed');
		}
		return prepared;
	}

	private async report(prepared: SecurityPolicyResponse, snapshot: NativeAgentSnapshot) {
		const readiness = this.readiness!;
		const facts = new Map(snapshot.facts.map((fact) => [fact.capability, fact]));
		const capabilities = readiness.policy.activations.map((activation) => {
			const fact = facts.get(activation.capability);
			if (fact === undefined)
				throw new ParticipationError('invalid_state', [activation.capability]);
			const mapped = new NativeRecordMapper(readiness.policy, this.clock, this.now).fact(
				fact
			);
			if (mapped.kind !== 'capability_fact') throw new ParticipationError('invalid_state');
			const { kind: _kind, observed_at: _observed, ...readinessFact } = mapped;
			return readinessFact;
		});
		const readinessRules = new Set(
			readiness.policy.rules
				.filter((rule) => rule.phase !== 'participation')
				.map((rule) => rule.rule_id)
		);
		const rules = snapshot.rules
			.filter((rule) => readinessRules.has(rule.rule_id))
			.map((rule) => ({
				rule_id: rule.rule_id,
				status: rule.status,
				...(rule.status === 'unknown' && rule.unknown_cause
					? { unknown_cause: rule.unknown_cause }
					: {})
			}));
		const result = await this.options.api.request('reportSecurityPreflight', {
			path: { security_preflight_id: prepared.preflight_challenge.preflight_id },
			header: { 'Idempotency-Key': hex(this.options.randomBytes(16)) },
			body: {
				challenge: prepared.preflight_challenge.challenge,
				policy_digest: prepared.policy.digest,
				policy_content_digest: prepared.policy_content_digest,
				security_session_id: readiness.securitySessionId,
				capabilities,
				rules,
				reported_at: new Date(this.now()).toISOString()
			}
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
		return result.value;
	}

	/** Right before Connect: every enforce readiness rule must still be met. */
	private recheck(): void {
		const readiness = this.readiness!;
		const enforced = readiness.policy.rules.filter(
			(rule) => rule.mode === 'enforce' && rule.phase !== 'participation'
		);
		const regressed = enforced
			.filter((rule) => readiness.rules.get(rule.rule_id)?.status !== 'met')
			.map((rule) => rule.rule_id);
		if (regressed.length > 0) throw new ParticipationError('readiness_regressed', regressed);
	}

	private commands(): ServerCommandChannel {
		this.channel ??= this._register(this.options.events.openCommandChannel());
		return this.channel;
	}

	private async connect(
		sittingId: string,
		prepared: SecurityPolicyResponse,
		reportDigest: string
	): Promise<void> {
		const readiness = this.readiness!;
		const continuityCredential = Buffer.from(this.options.randomBytes(32)).toString(
			'base64url'
		);
		let reply: unknown;
		try {
			reply = await this.commands().send('exam_attempt.connect', {
				exam_sitting_id: sittingId,
				idempotency_key: hex(this.options.randomBytes(16)),
				continuity_credential: continuityCredential,
				configuration_manifest_fingerprint: this.options.configurationManifestFingerprint,
				security: {
					kind: 'preflight',
					preflight_id: prepared.preflight_challenge.preflight_id,
					report_digest: reportDigest
				}
			});
		} catch (error) {
			if (error instanceof ServerCommandError)
				throw new ParticipationError('connect_refused', [
					error.problem?.code ?? error.outcome
				]);
			throw error;
		}
		if (!isValidServerEventPayload('exam_attempt_connect_reply', reply))
			throw new ServerApiError('invalidResponse');
		const connected = reply as {
			readonly attempt_id: string;
			readonly workspace_id: string;
			readonly attempt_connection_id: string;
			readonly lease_expires_at: string;
			readonly security: unknown;
		};
		validateNamedSchema('AdmittedSecurity', connected.security, 'response');
		const security = connected.security as AdmittedSecurity;
		if (
			security.policy_content_digest !== prepared.policy_content_digest ||
			security.security_session_id !== readiness.securitySessionId ||
			security.preflight_report_digest !== reportDigest
		)
			throw new ParticipationError('binding_mismatch');
		const delivery = await NativeDeliveryService.open(
			await this.options.openSpool(connected.attempt_id),
			new ServerNativeDeliveryTransport(this.options.api),
			{
				attemptId: connected.attempt_id,
				streamId: security.delivery_stream_id,
				participationId: security.participation_id,
				generation: security.generation,
				securitySessionId: security.security_session_id,
				policyDigest: security.policy.digest,
				applicationReleaseId: security.policy.application_release_id,
				matrixId: security.policy.matrix_id
			}
		);
		const access = () => this.access();
		const pump = new BrowserDeliveryPump(
			{ deliver: () => delivery.deliver(access()) },
			() => undefined
		);
		this.admission = {
			sittingId,
			attemptId: connected.attempt_id,
			workspaceId: connected.workspace_id,
			connectionId: connected.attempt_connection_id,
			continuityCredential,
			security,
			policy: readiness.policy,
			recording: recordsScreen(security.policy),
			delivery,
			mapper: new NativeRecordMapper(readiness.policy, this.clock, this.now),
			pump,
			leaseExpiresAt: Date.parse(connected.lease_expires_at),
			renewalSequence: 0,
			controlSequence: 0,
			processedControl: 0,
			interactionAllowed: true,
			focusSequence: 0,
			mounted: false,
			timer: undefined
		};
		this._phase = 'admitted';
		this.subscribeAttempt(sittingId);
		this.admission.timer = setInterval(
			() => void this.renew(),
			security.renewal_interval_seconds * 1000
		);
		this.admission.timer.unref?.();
		this.publish();
	}

	/** The admitted Participation's identity, for the window coordinator and the clip uploader. */
	public get admitted():
		| {
				readonly sittingId: string;
				readonly attemptId: string;
				readonly workspaceId: string;
				readonly participationId: string;
				readonly generation: number;
				readonly recording: boolean;
		  }
		| undefined {
		const admission = this.admission;
		return admission === undefined
			? undefined
			: {
					sittingId: admission.sittingId,
					attemptId: admission.attemptId,
					workspaceId: admission.workspaceId,
					participationId: admission.security.participation_id,
					generation: admission.security.generation,
					recording: admission.recording
				};
	}

	/** The live Participation's credentials, while it is live. */
	public access(): NativeDeliveryAccess | undefined {
		const admission = this.admission;
		if (admission === undefined || this._phase === 'submitted' || this._phase === 'suspended')
			return undefined;
		return {
			continuityCredential: admission.continuityCredential,
			connectionId: admission.connectionId
		};
	}

	// ---- Renewal and security control ------------------------------------------------------

	private control(admission: Admission) {
		admission.controlSequence++;
		return {
			control_sequence: admission.controlSequence,
			policy_digest: admission.security.policy.digest,
			security_session_id: admission.security.security_session_id,
			stream_id: admission.security.delivery_stream_id,
			delivery_watermarks: [admission.delivery.watermark()]
		};
	}

	/** One renewal: extends the lease and reports the delivery watermarks. */
	public async renew(): Promise<void> {
		const admission = this.admission;
		if (
			admission === undefined ||
			(this._phase !== 'admitted' && this._phase !== 'participating')
		)
			return;
		admission.renewalSequence++;
		try {
			const reply = await this.commands().send('exam_attempt.renew', {
				generation: admission.security.generation,
				sequence: admission.renewalSequence,
				continuity_credential: admission.continuityCredential,
				security_control: this.control(admission)
			});
			if (!isValidServerEventPayload('exam_attempt_renew_reply', reply))
				throw new ServerApiError('invalidResponse');
			const renewed = reply as {
				readonly lease_expires_at: string;
				readonly security_control: SecurityControlResult;
			};
			admission.leaseExpiresAt = Math.max(
				admission.leaseExpiresAt,
				Date.parse(renewed.lease_expires_at)
			);
			this.applyControl(admission, renewed.security_control);
		} catch (error) {
			if (error instanceof ServerCommandError && this.commands().needsResynchronization)
				await this.recover();
		}
		this.publish();
	}

	/** Sends a security control between renewals, for example after delivery progressed. */
	public async securityUpdate(): Promise<void> {
		const admission = this.admission;
		if (
			admission === undefined ||
			(this._phase !== 'admitted' && this._phase !== 'participating')
		)
			return;
		const reply = await this.commands().send('exam_attempt.security.update', {
			generation: admission.security.generation,
			continuity_credential: admission.continuityCredential,
			security_control: this.control(admission)
		});
		if (!isValidServerEventPayload('security_control_result', reply))
			throw new ServerApiError('invalidResponse');
		this.applyControl(admission, reply as SecurityControlResult);
		this.publish();
	}

	/** Applies a control result only if it is newer than the last one applied. */
	private applyControl(admission: Admission, result: SecurityControlResult): void {
		if (result.processed_control_sequence < admission.processedControl) return;
		admission.processedControl = result.processed_control_sequence;
		admission.interactionAllowed = result.security_interaction_allowed;
	}

	/** Continuity was lost: re-read the admitted binding, then let commands flow again. */
	private async recover(): Promise<void> {
		const admission = this.admission;
		const channel = this.channel;
		if (admission === undefined || channel === undefined || !channel.needsResynchronization)
			return;
		const result = await this.options.api.request('recoverExamSecurityPolicy', {
			path: { exam_attempt_id: admission.attemptId }
		});
		if (result.status !== 200) return;
		const recovered = result.value;
		if (
			recovered.security.policy_content_digest !== admission.security.policy_content_digest ||
			recovered.security.generation !== admission.security.generation
		) {
			this.contain('binding_mismatch');
			return;
		}
		if (recovered.security_control) this.applyControl(admission, recovered.security_control);
		channel.resynchronized();
		this.publish();
	}

	// ---- Native notifications --------------------------------------------------------------

	private async notified(
		notification: Parameters<Parameters<INativeAgentService['onDidNotify']>[0]>[0]
	): Promise<void> {
		if (notification.kind === 'heartbeat') {
			this.clock.heartbeat(notification.monotonic_ms);
			return;
		}
		const readiness = this.readiness;
		if (readiness !== undefined) {
			if (notification.kind === 'fact')
				readiness.facts.set(notification.fact.capability, notification.fact);
			if (notification.kind === 'rules')
				for (const status of notification.statuses)
					readiness.rules.set(status.rule_id, status);
		}
		const admission = this.admission;
		if (
			admission !== undefined &&
			(this._phase === 'admitted' || this._phase === 'participating')
		) {
			const records: NativeRecord[] = [];
			if (notification.kind === 'fact')
				records.push(admission.mapper.fact(notification.fact));
			if (notification.kind === 'gap') records.push(admission.mapper.gap(notification.gap));
			if (notification.kind === 'reset')
				records.push(
					admission.mapper.reset(notification.reset, hex(this.options.randomBytes(16)))
				);
			if (notification.kind === 'rules')
				records.push(
					...admission.mapper.rules(notification.statuses, this.options.agent.contained)
				);
			await this.deliver(admission, records);
		}
		if (notification.kind === 'rules' || notification.kind === 'fact') this.publish();
	}

	private async deliver(admission: Admission, records: readonly NativeRecord[]): Promise<void> {
		if (records.length === 0) return;
		try {
			await admission.delivery.enqueue(records);
			admission.pump.notify(admission.security.delivery_stream_id);
		} catch {
			this.contain('spool');
		}
	}

	// ---- CandidateWindow seam --------------------------------------------------------------

	/**
	 * The CandidateWindow mounted after admission. The agent attaches to the window, the mounted
	 * window's fact is delivered first, and then participation is confirmed — in that order, so
	 * the server never evaluates the window rule on the absent window reported at Start.
	 */
	public async candidateMounted(window: MountedCandidateWindow): Promise<void> {
		const admission = this.admission;
		if (admission === undefined || this._phase !== 'admitted')
			throw new ParticipationError('invalid_state');
		this.options.agent.sendHostEvent('candidate_window', {
			attach: { window: window.nativeWindow }
		});
		const windowFact = await this.options.agent.query('candidate_window');
		await this.deliver(admission, [admission.mapper.fact(windowFact)]);
		const recording = admission.recording
			? await this.options.recording?.(admission.attemptId)
			: undefined;
		const rules = await this.options.agent.confirmParticipation(recording);
		this.absorb({ facts: [], rules });
		admission.mounted = true;
		this._phase = 'participating';
		await this.deliver(admission, [
			admission.mapper.participationConfirmed(),
			...admission.mapper.rules(rules, this.options.agent.contained)
		]);
		this.publish();
	}

	/** A host event from the CandidateWindow or the print gate, for the agent. */
	public hostEvent(capability: 'candidate_window' | 'printing', event: unknown): void {
		if (this._phase === 'participating' || this._phase === 'admitted')
			this.options.agent.sendHostEvent(capability, event);
	}

	// ---- Server events: suspension and re-entry --------------------------------------------

	private subscribeAttempt(sittingId: string): void {
		for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
		const scope = {
			action: 'exam.sitting.participate',
			resourceType: 'exam_sitting',
			resourceId: sittingId
		} as const;
		this.subscriptions.push(
			this.options.events.on('exam_attempt_access_suspended', scope, (event) => {
				if (event.data.exam_attempt_id === this.admission?.attemptId) void this.suspended();
			}),
			this.options.events.on('exam_attempt_access_reallowed', scope, (event) => {
				if (event.data.exam_attempt_id === this.admission?.attemptId) void this.reallowed();
			})
		);
	}

	/** Suspended: contain, keep the recording for re-entry, and stop live delivery. */
	private async suspended(): Promise<void> {
		const admission = this.admission;
		if (admission === undefined) return;
		this.stopRenewal(admission);
		this._phase = 'suspended';
		this.attemptRevision++;
		this.publish();
		await this.options.agent.close('seal').catch(() => undefined);
		admission.pump.notify(admission.security.delivery_stream_id);
	}

	/** Reallowed: the Attempt is ready again; re-entry is a fresh Start with its ID. */
	private async reallowed(): Promise<void> {
		const admission = this.admission;
		if (admission === undefined || this._phase !== 'suspended') return;
		this.readiness = undefined;
		this._phase = 'idle';
		this.attemptRevision++;
		this.publish();
	}

	/** The Attempt to rejoin after a reallow, if any. */
	public rejoinAttemptId(): string | undefined {
		return this._phase === 'idle' ? this.admission?.attemptId : undefined;
	}

	// ---- Focus Loss and submission ---------------------------------------------------------

	public async reportFocusLoss(
		durationMs: number,
		source: 'window_blur' | 'document_hidden' | 'application_backgrounded' | 'fullscreen_exited'
	): Promise<void> {
		const admission = this.admission;
		if (admission === undefined || this._phase !== 'participating') return;
		admission.focusSequence++;
		await this.commands().send('exam_attempt.focus_loss', {
			schema_version: 1,
			generation: admission.security.generation,
			sequence: admission.focusSequence,
			duration_milliseconds: Math.max(1, Math.min(86_400_000, Math.round(durationMs))),
			continuity_credential: admission.continuityCredential,
			source
		});
	}

	/**
	 * Submits the Attempt with the live credentials, then deletes the local recording and keeps
	 * delivering what remains without them until the upload deadline.
	 */
	public async submit(expected: {
		readonly currentRevisionId: string;
		readonly workspaceCursor: number;
	}): Promise<void> {
		const admission = this.admission;
		if (admission === undefined || this._phase !== 'participating')
			throw new ParticipationError('invalid_state');
		const result = await this.options.api.request('submitExamAttempt', {
			path: { exam_attempt_id: admission.attemptId },
			header: {
				'Idempotency-Key': hex(this.options.randomBytes(16)),
				'X-Proctor-Attempt-Credential': admission.continuityCredential,
				'X-Proctor-Attempt-Connection-ID': admission.connectionId
			},
			body: {
				participation_id: admission.security.participation_id,
				generation: admission.security.generation,
				expected_current_revision_id: expected.currentRevisionId,
				expected_workspace_cursor: expected.workspaceCursor,
				final_focus_loss_sequence: admission.focusSequence
			}
		});
		if (result.status !== 201) throw new ServerApiError('server', { status: result.status });
		this.stopRenewal(admission);
		this._phase = 'submitted';
		this.attemptRevision++;
		this.publish();
		await this.options.agent.close('delete').catch(() => undefined);
		admission.pump.notify(admission.security.delivery_stream_id);
	}

	// ---- Containment and projection -------------------------------------------------------

	private contained = false;

	private contain(_cause: string): void {
		this.contained = true;
		this.publish();
	}

	private stopRenewal(admission: Admission): void {
		if (admission.timer !== undefined) clearInterval(admission.timer);
		admission.timer = undefined;
	}

	private conditions(): readonly CandidateSecurityCondition[] {
		const readiness = this.readiness;
		const admission = this.admission;
		if (readiness === undefined || admission === undefined) return [];
		const conditions = new Map<SafeSecurityReason, CandidateSecurityCondition>();
		for (const rule of admission.policy.rules) {
			if (rule.mode !== 'enforce' || rule.phase === 'readiness') continue;
			const status = readiness.rules.get(rule.rule_id)?.status;
			if (status === 'met') continue;
			const reason = REASONS[rule.capability] ?? 'policy';
			const state = status === 'not_met' ? 'required' : 'checking';
			if (conditions.get(reason)?.state !== 'required')
				conditions.set(reason, { reason, state });
		}
		return [...conditions.values()];
	}

	/** The CandidateWindow's projection of this Participation. */
	public projection(): CandidateSecurityProjection {
		const admission = this.admission;
		const now = this.now();
		const leaseLive = admission !== undefined && now < admission.leaseExpiresAt;
		const participating = this._phase === 'participating';
		const contained =
			this.contained ||
			this.options.agent.contained ||
			(admission !== undefined && !admission.interactionAllowed) ||
			(participating && !leaseLive);
		const conditions = this.conditions();
		const interact = participating && !contained;
		return {
			revision: this.projectionRevision,
			attemptState:
				this._phase === 'submitted'
					? 'submitted'
					: this._phase === 'suspended'
						? 'suspended'
						: this._phase === 'participating' || this._phase === 'admitted'
							? 'active'
							: 'ready',
			attemptRevision: this.attemptRevision,
			posture:
				this._phase === 'submitted'
					? 'stopped'
					: this._phase === 'failed'
						? 'failed'
						: contained
							? 'contained'
							: this._phase === 'participating'
								? conditions.length > 0
									? 'degraded'
									: 'compliant'
								: this._phase === 'idle'
									? 'uninitialized'
									: 'checking',
			...(contained && conditions[0] ? { safeReason: conditions[0].reason } : {}),
			...(contained && !conditions[0] && participating && !leaseLive
				? { safeReason: 'connection' as const }
				: {}),
			participationGeneration: admission?.security.generation ?? 0,
			leasePhase: admission === undefined || leaseLive ? 'connected' : 'expired',
			paused: false,
			protectedWork: 'notRequired',
			canJoin: this._phase === 'idle' && this.rejoinAttemptId() !== undefined,
			canRetryChecks: this._phase === 'readiness',
			canWorkspaceMutate: interact,
			canUseBrowser: interact,
			canSubmit: interact,
			activeSecurityConditions: conditions,
			activeCorrections: [],
			authoritativeTimeUnixMs: now
		};
	}

	private listeners = new Set<(projection: CandidateSecurityProjection) => void>();

	/** {@link ExamSecurityIpcModel}: the CandidateWindow bridge's model. */
	public observe(): ReturnType<ExamSecurityIpcModel['observe']> {
		return {
			current: this.projection(),
			onDidChange: (listener) => {
				this.listeners.add(listener);
				return { dispose: () => this.listeners.delete(listener) };
			}
		};
	}

	public async handleIntent(intent: CandidateSecurityIntent): Promise<void> {
		if (intent.projectionRevision !== this.projectionRevision) return;
		if (intent.kind === 'security.retryChecks' && this.readiness !== undefined)
			await this.openReadiness(this.readiness.sittingId);
	}

	private publish(): void {
		this.projectionRevision++;
		const projection = this.projection();
		for (const listener of this.listeners) listener(projection);
		this._onDidChange.fire();
	}

	private require(...phases: readonly ParticipationPhase[]): void {
		if (!phases.includes(this._phase))
			throw new ParticipationError('invalid_state', [this._phase]);
	}

	public override dispose(): void {
		if (this.admission !== undefined) {
			this.stopRenewal(this.admission);
			this.admission.pump.dispose();
		}
		for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
		this.listeners.clear();
		super.dispose();
	}
}
