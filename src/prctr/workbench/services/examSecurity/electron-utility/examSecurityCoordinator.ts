/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	getNativeCapability,
	type NativeClosedEffect
} from '../../../../platform/native/common/nativeCapabilityRegistry.js';
import type { NativeSourceId } from '../../../../platform/native/common/securityUtilityProtocol.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import type {
	AuthoritativeSecurityState,
	CandidateSecurityProjection,
	DetectorFinding,
	ExamSecurityCoordinator,
	ExamSecurityCoordinatorOptions,
	ExamSecurityObservation,
	MinimizedIntegrityOccurrence,
	SafeSecurityReason,
	SecurityReconciliation,
	SecuritySourceCoverage,
	SecuritySourceReset,
	SecureExamPosture
} from '../common/examSecurity.js';

interface ActiveOccurrence {
	readonly occurrenceId: string;
	readonly conditionId: string;
	readonly capabilityId: string;
	readonly mode: 'enforce' | 'observe';
	readonly firstObservedUnixMs: number;
	lastConfirmedUnixMs: number;
	repeatCount: number;
	certainty: 'complete' | 'partial' | 'unknown';
	gapCount: number;
	sourceRanges: DetectorFinding['sourceRanges'];
	evidenceSignature: string;
}
interface FindingRecoveryFence {
	readonly source: NativeSourceId;
	readonly sourceInstanceId: string;
	readonly sequence: number;
	readonly replacementSnapshotRequired: boolean;
}
type EvaluationOutcome =
	| {
			readonly requiresContainment: true;
			readonly posture: 'checking' | 'contained' | 'failed';
			readonly reason: SafeSecurityReason;
	  }
	| {
			readonly requiresContainment: false;
			readonly posture: 'compliant' | 'degraded';
			readonly reason?: SafeSecurityReason;
	  };
const SECURITY_REASON_BY_CAPABILITY = Object.freeze({
	candidate_window: 'candidateWindow',
	connection: 'connection',
	display_topology: 'display',
	focus_loss: 'candidateWindow',
	process_application: 'processApplication',
	interactive_session: 'interactiveSession',
	clipboard: 'policy',
	printing: 'printing',
	removable_storage: 'removableStorage',
	virtualization: 'virtualization',
	network_configuration: 'network',
	camera: 'media',
	microphone: 'media',
	external_capture: 'policy'
} satisfies Readonly<Record<string, SafeSecurityReason>>);

export function createExamSecurityCoordinator(
	options: ExamSecurityCoordinatorOptions
): ExamSecurityCoordinator {
	return new ExamSecurityCoordinatorModel(options);
}

class ExamSecurityCoordinatorModel implements ExamSecurityCoordinator {
	readonly #options: ExamSecurityCoordinatorOptions;
	readonly #listeners = new Set<(projection: CandidateSecurityProjection) => void>();
	readonly #occurrences = new Map<string, ActiveOccurrence>();
	readonly #findingStates = new Map<string, DetectorFinding>();
	readonly #findingRecoveryFences = new Map<string, FindingRecoveryFence>();
	readonly #conditionDefinitions = new Map<
		string,
		Pick<DetectorFinding, 'capabilityId' | 'mode' | 'reason'>
	>();
	readonly #pendingDelivery = new Map<string, MinimizedIntegrityOccurrence>();
	readonly #sourceWatermarks = new Map<
		NativeSourceId,
		Pick<SecuritySourceCoverage, 'sourceInstanceId' | 'sequence'>
	>();
	readonly #seenSourceInstances = new Map<NativeSourceId, Set<string>>();
	readonly #automaticRestartConsumed = new Set<NativeSourceId>();
	#authoritative: AuthoritativeSecurityState;
	#highestAuthoritative: AuthoritativeSecurityState;
	#posture: SecureExamPosture = 'uninitialized';
	#safeReason: SafeSecurityReason | undefined;
	#protectedWork: CandidateSecurityProjection['protectedWork'] = 'notRequired';
	#projectionRevision = 0;
	#projection: CandidateSecurityProjection;
	#serial = Promise.resolve();
	#evaluationEpoch = 0;
	#started = false;
	#stopping = false;
	#stopPhase = 0;
	#stopPromise: Promise<void> | undefined;
	#disposed = false;

	constructor(options: ExamSecurityCoordinatorOptions) {
		this.#options = options;
		this.#authoritative = validateAuthoritative(options.authoritative);
		this.#highestAuthoritative = this.#authoritative;
		this.#validateBinding();
		this.#projection = this.#deriveProjection();
	}

	observe(): ExamSecurityObservation {
		this.#assertLive();
		return Object.freeze({
			current: this.#projection,
			onDidChange: (listener: (projection: CandidateSecurityProjection) => void) => {
				this.#listeners.add(listener);
				return Object.freeze({ dispose: () => this.#listeners.delete(listener) });
			}
		});
	}
	start(): Promise<void> {
		return this.#enqueue(async () => {
			if (this.#started) throw new Error('Exam Security Coordinator can start only once');
			if (this.#stopping) return;
			this.#started = true;
			this.#options.ports.gates.denyAll('policy');
			try {
				const receipt = await this.#options.ports.enforcement.apply(
					this.#options.selection.closedEffects as readonly NativeClosedEffect[],
					this.#options.binding.participationGeneration
				);
				if (this.#disposed || this.#stopping) return;
				if (!receipt.verified) throw new Error('closed effects were not verified');
				this.#commit('checking', 'policy');
			} catch {
				if (!this.#disposed && !this.#stopping) await this.#contain('failed', 'policy', []);
			}
		});
	}
	signalHighConfidence(reason: SafeSecurityReason): void {
		this.#assertStarted();
		if (this.#stopping || this.#posture === 'stopped') return;
		this.#evaluationEpoch++;
		this.#options.ports.gates.denyAll(reason);
		this.#commit('checking', reason);
	}
	reconcile(value: SecurityReconciliation): Promise<void> {
		if (this.#stopping || this.#posture === 'stopped') return Promise.resolve();
		let reconciliation: SecurityReconciliation;
		try {
			this.#assertStarted();
			reconciliation = validateReconciliation(
				value,
				this.#options.binding.participationGeneration,
				this.#options.selection.selectedSources,
				this.#options.policy.capabilities,
				this.#options.policy.focusLossMode
			);
		} catch (error) {
			return this.#rejectReconciliation(error);
		}
		const epoch = this.#evaluationEpoch;
		return this.#enqueue(async () => {
			if (this.#stopping || epoch !== this.#evaluationEpoch) return;
			let findings: readonly DetectorFinding[];
			try {
				this.#validateSourceContinuity(reconciliation.sources, reconciliation.sourceResets);
				findings = this.#applyFindings(reconciliation);
				this.#commitFindingResetFences(reconciliation.sources, reconciliation.sourceResets);
				this.#commitSourceContinuity(reconciliation.sources, reconciliation.sourceResets);
			} catch (error) {
				await this.#containReconciliationFailure();
				throw error;
			}
			if (!this.#policyIsCurrent()) {
				await this.#contain('failed', 'policy', []);
				return;
			}
			const records = this.#updateOccurrences(findings);
			this.#stage(records);
			const outcome = this.#evaluate({
				...reconciliation,
				findings: Object.freeze([...this.#findingStates.values()])
			});
			if (outcome.requiresContainment)
				await this.#contain(outcome.posture, outcome.reason, records);
			else await this.#recover(outcome.posture, outcome.reason, records);
		});
	}
	updateAuthoritativeState(value: AuthoritativeSecurityState): Promise<void> {
		this.#assertStarted();
		if (this.#stopping || this.#posture === 'stopped') return Promise.resolve();
		const next = validateAuthoritative(value);
		if (this.#options.policy.scope.kind === 'admission' && next.attemptState === 'active')
			throw new TypeError('One-use admission policy cannot authorize active participation');
		if (next.authoritativeTimeUnixMs < this.#highestAuthoritative.authoritativeTimeUnixMs)
			throw new TypeError('Authoritative security time cannot move backward');
		if (next.attemptRevision < this.#highestAuthoritative.attemptRevision)
			return Promise.resolve();
		if (next.attemptRevision === this.#highestAuthoritative.attemptRevision) {
			if (!sameAuthoritative(next, this.#highestAuthoritative))
				throw new TypeError('Authoritative Attempt revision is ambiguous');
			return Promise.resolve();
		}
		this.#evaluationEpoch++;
		this.#highestAuthoritative = next;
		const reason: SafeSecurityReason = next.paused
			? 'pause'
			: next.leasePhase !== 'connected'
				? 'connection'
				: 'policy';
		this.#options.ports.gates.denyAll(reason);
		return this.#enqueue(async () => {
			if (
				this.#stopping ||
				next.attemptRevision !== this.#highestAuthoritative.attemptRevision
			)
				return;
			this.#authoritative = next;
			if (!this.#policyIsCurrent()) {
				await this.#contain('failed', 'policy', []);
				return;
			}
			if (next.attemptState !== 'active' || next.paused || next.leasePhase !== 'connected')
				await this.#contain(
					next.leasePhase === 'expired'
						? 'failed'
						: this.#posture === 'uninitialized'
							? 'checking'
							: this.#posture,
					reason,
					[]
				);
			else this.#commit('checking', 'policy');
		});
	}
	failClosed(reason: SafeSecurityReason): Promise<void> {
		this.#assertStarted();
		if (this.#stopping || this.#posture === 'stopped') return Promise.resolve();
		this.#evaluationEpoch++;
		this.#options.ports.gates.denyAll(reason);
		return this.#enqueue(() =>
			this.#stopping ? Promise.resolve() : this.#contain('failed', reason, [])
		);
	}
	stop(): Promise<void> {
		this.#assertStarted();
		if (this.#posture === 'stopped') return Promise.resolve();
		if (this.#stopPromise !== undefined) return this.#stopPromise;
		this.#stopping = true;
		this.#evaluationEpoch++;
		this.#options.ports.gates.denyAll('policy');
		const attempt = this.#enqueue(() => this.#performStop(), false);
		let tracked: Promise<void>;
		tracked = attempt.then(
			() => {},
			(error) => {
				if (!this.#disposed) this.#commit('failed', 'sourceCoverage');
				if (this.#stopPromise === tracked) this.#stopPromise = undefined;
				throw error;
			}
		);
		this.#stopPromise = tracked;
		return tracked;
	}
	async #performStop(): Promise<void> {
		this.#assertStopLive();
		if (this.#stopPhase < 1) {
			await this.#options.ports.undispatched.cancelProvenUndispatched();
			this.#assertStopLive();
			this.#stopPhase = 1;
		}
		if (this.#stopPhase < 2) {
			await this.#protectWork();
			this.#assertStopLive();
			this.#stopPhase = 2;
		}
		if (this.#stopPhase < 3) {
			const stopped = await this.#options.ports.sources.stopAndDrain(
				this.#options.binding.participationGeneration
			);
			this.#assertStopLive();
			if (!stopped.clean) throw new Error('native sources did not stop cleanly');
			this.#stopPhase = 3;
		}
		if (this.#stopPhase < 4) {
			await this.#deliver([]);
			this.#assertStopLive();
			this.#stopPhase = 4;
		}
		if (this.#stopPhase < 5) {
			await this.#options.ports.delivery.seal(this.#options.binding.participationGeneration);
			this.#assertStopLive();
			this.#stopPhase = 5;
		}
		if (this.#stopPhase < 6) {
			await this.#options.ports.enforcement.release(
				this.#options.binding.participationGeneration
			);
			this.#assertStopLive();
			this.#stopPhase = 6;
		}
		this.#findingStates.clear();
		this.#findingRecoveryFences.clear();
		this.#occurrences.clear();
		this.#sourceWatermarks.clear();
		this.#seenSourceInstances.clear();
		this.#automaticRestartConsumed.clear();
		this.#commit('stopped', undefined);
	}

	async #contain(
		posture: SecureExamPosture,
		reason: SafeSecurityReason,
		records: readonly MinimizedIntegrityOccurrence[]
	): Promise<void> {
		if (this.#disposed) return;
		this.#options.ports.gates.denyAll(reason);
		try {
			await this.#options.ports.undispatched.cancelProvenUndispatched();
			if (this.#disposed) return;
			await this.#protectWork();
			if (this.#disposed) return;
			const receipt = await this.#options.ports.enforcement.apply(
				this.#options.selection.closedEffects as readonly NativeClosedEffect[],
				this.#options.binding.participationGeneration
			);
			if (this.#disposed) return;
			if (!receipt.verified) throw new Error('closed effects were not verified');
			this.#commit(posture, reason);
			if (this.#disposed) return;
			await this.#deliver(records);
		} catch {
			if (!this.#disposed) this.#commit('failed', reason);
		}
	}

	async #recover(
		posture: 'compliant' | 'degraded',
		reason: SafeSecurityReason | undefined,
		records: readonly MinimizedIntegrityOccurrence[]
	): Promise<void> {
		if (this.#disposed) return;
		// Protection is a checkpoint for the containment episode that just ended. New
		// accepted work must receive a fresh checkpoint if a later episode begins.
		if (this.#protectedWork === 'protected') this.#protectedWork = 'notRequired';
		this.#commit(posture, reason);
		if (this.#interactionAllowed())
			this.#options.ports.gates.allowAll(this.#options.binding.participationGeneration);
		else
			this.#options.ports.gates.denyAll(
				this.#authoritative.paused
					? 'pause'
					: this.#authoritative.leasePhase !== 'connected'
						? 'connection'
						: 'policy'
			);
		try {
			await this.#deliver(records);
		} catch {
			if (!this.#disposed) {
				this.#options.ports.gates.denyAll('sourceCoverage');
				this.#commit('failed', 'sourceCoverage');
			}
		}
	}

	#stage(records: readonly MinimizedIntegrityOccurrence[]): void {
		for (const record of records)
			this.#pendingDelivery.set(`${record.occurrenceId}:${record.status}`, record);
	}
	async #deliver(records: readonly MinimizedIntegrityOccurrence[]): Promise<void> {
		this.#stage(records);
		if (this.#pendingDelivery.size === 0) return;
		await this.#options.ports.delivery.enqueue(
			Object.freeze([...this.#pendingDelivery.values()])
		);
		this.#pendingDelivery.clear();
	}

	async #protectWork(): Promise<void> {
		if (this.#protectedWork === 'protected') return;
		this.#protectedWork = 'protecting';
		const receipt = await this.#options.ports.workspace.protectAcceptedAndUnknown();
		if (!receipt.protected || !receipt.unknownOutcomesRetained) {
			this.#protectedWork = 'failed';
			throw new Error('Workspace protection failed');
		}
		this.#protectedWork = 'protected';
	}

	#evaluate(reconciliation: SecurityReconciliation): EvaluationOutcome {
		const coverageBySource = new Map(
			reconciliation.sources.map((source) => [source.source, source])
		);
		let observeDegraded = this.#options.selection.unavailableCoverageKeys.length > 0;
		for (const source of this.#options.selection.enforcedSourceIds) {
			const coverage = coverageBySource.get(source);
			if (
				coverage === undefined ||
				coverage.health === 'failed' ||
				coverage.health === 'stopped' ||
				coverage.permission === 'denied' ||
				coverage.permission === 'restricted' ||
				coverage.permission === 'unavailable' ||
				coverage.gapCount > 0
			)
				return { posture: 'failed', reason: 'sourceCoverage', requiresContainment: true };
			if (
				!coverage.complete ||
				coverage.health === 'starting' ||
				coverage.health === 'recovering' ||
				coverage.permission === 'not_determined'
			)
				return { posture: 'checking', reason: 'sourceCoverage', requiresContainment: true };
			if (coverage.health !== 'healthy')
				return { posture: 'failed', reason: 'sourceCoverage', requiresContainment: true };
		}
		for (const source of this.#options.selection.observeSourceIds) {
			const coverage = coverageBySource.get(source);
			if (
				coverage === undefined ||
				!coverage.complete ||
				coverage.health !== 'healthy' ||
				coverage.permission !== 'granted' ||
				coverage.gapCount > 0
			)
				observeDegraded = true;
		}
		if (!reconciliation.complete)
			return { posture: 'checking', reason: 'sourceCoverage', requiresContainment: true };
		for (const finding of reconciliation.findings) {
			if (
				finding.mode === 'enforce' &&
				(finding.certainty !== 'complete' || finding.gaps > 0)
			)
				return { posture: 'failed', reason: 'sourceCoverage', requiresContainment: true };
			if (
				finding.mode === 'observe' &&
				(finding.certainty !== 'complete' ||
					finding.gaps > 0 ||
					finding.status === 'present')
			)
				observeDegraded = true;
			if (finding.mode === 'enforce' && finding.status === 'checking')
				return { posture: 'checking', reason: finding.reason, requiresContainment: true };
			if (finding.mode === 'enforce' && finding.status === 'present')
				return { posture: 'contained', reason: finding.reason, requiresContainment: true };
		}
		if (
			this.#authoritative.attemptState === 'active' &&
			(this.#authoritative.paused || this.#authoritative.leasePhase !== 'connected')
		)
			return {
				posture: this.#authoritative.leasePhase === 'expired' ? 'failed' : 'checking',
				reason: this.#authoritative.paused ? 'pause' : 'connection',
				requiresContainment: true
			};
		return { posture: observeDegraded ? 'degraded' : 'compliant', requiresContainment: false };
	}

	#applyFindings(reconciliation: SecurityReconciliation): readonly DetectorFinding[] {
		const incoming = new Map(
			reconciliation.findings.map((finding) => [finding.conditionId, finding])
		);
		const effective = [...reconciliation.findings];
		if (reconciliation.complete)
			for (const prior of this.#findingStates.values())
				if (
					!incoming.has(prior.conditionId) &&
					this.#canSynthesizeRecovery(
						prior,
						reconciliation.sources,
						reconciliation.sourceResets
					)
				)
					effective.push(
						Object.freeze({
							...prior,
							status: 'clear' as const,
							certainty: 'complete' as const,
							gaps: 0
						})
					);
		for (const finding of reconciliation.findings) {
			const prior = this.#findingStates.get(finding.conditionId);
			if (
				finding.status === 'clear' &&
				prior !== undefined &&
				!this.#canSynthesizeRecovery(
					prior,
					reconciliation.sources,
					reconciliation.sourceResets
				)
			)
				throw new TypeError(
					'Security condition recovery lacks healthy fresh source coverage'
				);
		}
		for (const finding of effective) {
			const definition = this.#conditionDefinitions.get(finding.conditionId);
			if (
				definition !== undefined &&
				(definition.capabilityId !== finding.capabilityId ||
					definition.mode !== finding.mode ||
					definition.reason !== finding.reason)
			)
				throw new TypeError(
					'Security condition identity cannot be reassigned during a coordinator lifetime'
				);
		}
		for (const finding of effective)
			if (!this.#conditionDefinitions.has(finding.conditionId))
				this.#conditionDefinitions.set(
					finding.conditionId,
					Object.freeze({
						capabilityId: finding.capabilityId,
						mode: finding.mode,
						reason: finding.reason
					})
				);
		const coverageBySource = new Map(
			reconciliation.sources.map((source) => [source.source, source])
		);
		for (const finding of effective) {
			if (finding.status === 'clear') {
				this.#findingStates.delete(finding.conditionId);
				this.#findingRecoveryFences.delete(finding.conditionId);
				continue;
			}
			const source = findingSource(finding.capabilityId);
			const coverage = source === undefined ? undefined : coverageBySource.get(source);
			if (source === undefined || coverage === undefined)
				throw new TypeError('Security condition lacks its registered source coverage');
			this.#findingStates.set(finding.conditionId, finding);
			this.#findingRecoveryFences.set(
				finding.conditionId,
				Object.freeze({
					source,
					sourceInstanceId: coverage.sourceInstanceId,
					sequence: coverage.sequence,
					replacementSnapshotRequired: false
				})
			);
		}
		return Object.freeze(effective);
	}
	#validateSourceContinuity(
		sources: readonly SecuritySourceCoverage[],
		resets: readonly SecuritySourceReset[]
	): void {
		const resetsBySource = new Map(resets.map((reset) => [reset.source, reset]));
		const coverageBySource = new Map(sources.map((source) => [source.source, source]));
		for (const reset of resets) {
			const prior = this.#sourceWatermarks.get(reset.source);
			const coverage = coverageBySource.get(reset.source);
			if (this.#seenSourceInstances.get(reset.source)?.has(reset.newSourceInstanceId))
				throw new TypeError('Security source instance identity cannot be reused');
			if (this.#automaticRestartConsumed.has(reset.source))
				throw new TypeError('Security source automatic restart was already consumed');
			if (
				prior === undefined ||
				coverage === undefined ||
				prior.sourceInstanceId !== reset.previousSourceInstanceId ||
				prior.sequence !== reset.previousSequence ||
				coverage.sourceInstanceId !== reset.newSourceInstanceId ||
				reset.previousSourceInstanceId === reset.newSourceInstanceId
			)
				throw new TypeError(
					'Security source reset does not match the exact supervisor continuity edge'
				);
		}
		for (const source of sources) {
			const prior = this.#sourceWatermarks.get(source.source);
			const reset = resetsBySource.get(source.source);
			if (
				prior !== undefined &&
				prior.sourceInstanceId !== source.sourceInstanceId &&
				reset === undefined
			)
				throw new TypeError('Security source instance reset lacks explicit continuity');
			if (
				prior !== undefined &&
				prior.sourceInstanceId === source.sourceInstanceId &&
				reset !== undefined
			)
				throw new TypeError('Security source reset does not replace the prior instance');
			if (
				prior !== undefined &&
				prior.sourceInstanceId === source.sourceInstanceId &&
				source.sequence < prior.sequence
			)
				throw new TypeError('Security source sequence regressed');
		}
	}
	#commitFindingResetFences(
		sources: readonly SecuritySourceCoverage[],
		resets: readonly SecuritySourceReset[]
	): void {
		const coverageBySource = new Map(sources.map((source) => [source.source, source]));
		for (const reset of resets) {
			const coverage = coverageBySource.get(reset.source) as SecuritySourceCoverage;
			for (const [conditionId, fence] of this.#findingRecoveryFences)
				if (
					fence.source === reset.source &&
					fence.sourceInstanceId === reset.previousSourceInstanceId
				)
					this.#findingRecoveryFences.set(
						conditionId,
						Object.freeze({
							source: reset.source,
							sourceInstanceId: reset.newSourceInstanceId,
							sequence: coverage.sequence,
							replacementSnapshotRequired: true
						})
					);
		}
	}
	#commitSourceContinuity(
		sources: readonly SecuritySourceCoverage[],
		resets: readonly SecuritySourceReset[]
	): void {
		for (const source of sources) {
			this.#sourceWatermarks.set(
				source.source,
				Object.freeze({
					sourceInstanceId: source.sourceInstanceId,
					sequence: source.sequence
				})
			);
			let seen = this.#seenSourceInstances.get(source.source);
			if (seen === undefined) {
				seen = new Set();
				this.#seenSourceInstances.set(source.source, seen);
			}
			seen.add(source.sourceInstanceId);
		}
		for (const reset of resets) this.#automaticRestartConsumed.add(reset.source);
	}
	#canSynthesizeRecovery(
		prior: DetectorFinding,
		sources: readonly SecuritySourceCoverage[],
		resets: readonly SecuritySourceReset[]
	): boolean {
		const fence = this.#findingRecoveryFences.get(prior.conditionId);
		if (fence === undefined) return false;
		const coverage = sources.find((source) => source.source === fence.source);
		if (
			coverage === undefined ||
			coverage.health !== 'healthy' ||
			coverage.permission !== 'granted' ||
			!coverage.complete ||
			coverage.gapCount !== 0
		)
			return false;
		if (coverage.sourceInstanceId === fence.sourceInstanceId)
			return fence.replacementSnapshotRequired
				? coverage.sequence >= fence.sequence
				: coverage.sequence > fence.sequence;
		return resets.some(
			(reset) =>
				reset.source === fence.source &&
				reset.previousSourceInstanceId === fence.sourceInstanceId &&
				reset.newSourceInstanceId === coverage.sourceInstanceId
		);
	}
	#rejectReconciliation(error: unknown): Promise<void> {
		if (!this.#started || this.#disposed || this.#stopping) return Promise.reject(error);
		this.#evaluationEpoch++;
		this.#options.ports.gates.denyAll('sourceCoverage');
		return this.#enqueue(() => this.#contain('failed', 'sourceCoverage', [])).then(
			() => {
				throw error;
			},
			(containmentError) => {
				throw new AggregateError(
					[error, containmentError],
					'Security reconciliation rejection and containment failed'
				);
			}
		);
	}
	async #containReconciliationFailure(): Promise<void> {
		this.#evaluationEpoch++;
		this.#options.ports.gates.denyAll('sourceCoverage');
		await this.#contain('failed', 'sourceCoverage', []);
	}

	#updateOccurrences(
		findings: readonly DetectorFinding[]
	): readonly MinimizedIntegrityOccurrence[] {
		const records: MinimizedIntegrityOccurrence[] = [];
		const now = this.#authoritative.authoritativeTimeUnixMs;
		for (const finding of findings) {
			const active = this.#occurrences.get(finding.conditionId);
			if (finding.status === 'checking') continue;
			if (finding.status === 'clear') {
				if (active !== undefined) {
					active.lastConfirmedUnixMs = now;
					records.push(this.#record(active, 'recovered'));
					this.#occurrences.delete(finding.conditionId);
				}
				continue;
			}
			if (active === undefined) {
				const opened: ActiveOccurrence = {
					occurrenceId: this.#options.ports.ids.nextOccurrenceId(),
					conditionId: finding.conditionId,
					capabilityId: finding.capabilityId,
					mode: finding.mode,
					firstObservedUnixMs: now,
					lastConfirmedUnixMs: now,
					repeatCount: 1,
					certainty: finding.certainty,
					gapCount: finding.gaps,
					sourceRanges: freezeRanges(finding.sourceRanges),
					evidenceSignature: occurrenceEvidenceSignature(finding)
				};
				this.#occurrences.set(finding.conditionId, opened);
				records.push(this.#record(opened, 'opened'));
			} else if (active.evidenceSignature !== occurrenceEvidenceSignature(finding)) {
				active.lastConfirmedUnixMs = now;
				active.repeatCount = Math.min(65_535, active.repeatCount + 1);
				active.certainty = finding.certainty;
				active.gapCount = Math.min(65_535, active.gapCount + finding.gaps);
				active.sourceRanges = freezeRanges(finding.sourceRanges);
				active.evidenceSignature = occurrenceEvidenceSignature(finding);
				records.push(this.#record(active, 'repeated'));
			}
		}
		return Object.freeze(records);
	}

	#record(
		value: ActiveOccurrence,
		status: MinimizedIntegrityOccurrence['status']
	): MinimizedIntegrityOccurrence {
		return Object.freeze({
			occurrenceId: value.occurrenceId,
			conditionId: value.conditionId,
			capabilityId: value.capabilityId,
			mode: value.mode,
			status,
			firstObservedUnixMs: value.firstObservedUnixMs,
			lastConfirmedUnixMs: value.lastConfirmedUnixMs,
			repeatCount: value.repeatCount,
			certainty: value.certainty,
			gapCount: value.gapCount,
			sourceRanges: value.sourceRanges,
			policyDigest: this.#options.policy.digest,
			participationGeneration: this.#options.binding.participationGeneration
		});
	}
	#interactionAllowed(): boolean {
		return (
			this.#options.policy.scope.kind === 'attempt' &&
			this.#authoritative.attemptState === 'active' &&
			!this.#authoritative.paused &&
			this.#authoritative.leasePhase === 'connected' &&
			(this.#posture === 'compliant' || this.#posture === 'degraded')
		);
	}
	#correctionAllows(capability: 'browser' | 'submission' | 'workspace'): boolean {
		return !this.#authoritative.activeCorrections.some(
			(correction) =>
				correction.requiresAcknowledgement &&
				!correction.acknowledged &&
				correction.affectedCapabilities.includes(capability)
		);
	}
	#deriveProjection(): CandidateSecurityProjection {
		const allowed = this.#interactionAllowed();
		const conditions = [...this.#findingStates.values()]
			.filter((finding) => finding.mode === 'enforce' && finding.status !== 'clear')
			.map((finding) => ({
				reason: finding.reason,
				state: finding.status === 'checking' ? ('checking' as const) : ('required' as const)
			}));
		if (
			this.#safeReason !== undefined &&
			!conditions.some((item) => item.reason === this.#safeReason) &&
			(this.#posture === 'checking' ||
				this.#posture === 'contained' ||
				this.#posture === 'failed' ||
				this.#authoritative.paused)
		)
			conditions.push({
				reason: this.#safeReason,
				state:
					this.#posture === 'contained' ||
					this.#posture === 'failed' ||
					this.#authoritative.paused
						? 'required'
						: 'checking'
			});
		const dedupedConditions = conditions
			.filter(
				(item, index) =>
					conditions.findIndex(
						(candidate) =>
							candidate.reason === item.reason && candidate.state === item.state
					) === index
			)
			.sort((left, right) => left.reason.localeCompare(right.reason));
		const corrections = this.#authoritative.activeCorrections.map((correction) =>
			Object.freeze({
				correctionId: correction.correctionId,
				revision: correction.revision,
				reason: correction.reason,
				state:
					correction.requiresAcknowledgement && !correction.acknowledged
						? ('acknowledgementRequired' as const)
						: ('notice' as const),
				affectedCapabilities: Object.freeze([...correction.affectedCapabilities])
			})
		);
		return Object.freeze({
			revision: this.#projectionRevision,
			attemptState: this.#authoritative.attemptState,
			attemptRevision: this.#authoritative.attemptRevision,
			posture: this.#posture,
			...(this.#safeReason === undefined ? {} : { safeReason: this.#safeReason }),
			participationGeneration: this.#options.binding.participationGeneration,
			leasePhase: this.#authoritative.leasePhase,
			paused: this.#authoritative.paused,
			protectedWork: this.#protectedWork,
			canJoin:
				this.#authoritative.attemptState === 'ready' &&
				!this.#authoritative.paused &&
				this.#authoritative.leasePhase === 'connected' &&
				(this.#posture === 'compliant' || this.#posture === 'degraded'),
			canRetryChecks:
				this.#authoritative.attemptState !== 'submitted' &&
				['checking', 'contained', 'failed'].includes(this.#posture),
			canWorkspaceMutate: allowed && this.#correctionAllows('workspace'),
			canUseBrowser: allowed && this.#correctionAllows('browser'),
			canSubmit: allowed && this.#correctionAllows('submission'),
			activeSecurityConditions: Object.freeze(dedupedConditions),
			activeCorrections: Object.freeze(corrections),
			authoritativeTimeUnixMs: this.#authoritative.authoritativeTimeUnixMs
		});
	}
	#commit(posture: SecureExamPosture, reason: SafeSecurityReason | undefined): void {
		this.#posture = posture;
		this.#safeReason = reason;
		this.#projectionRevision++;
		this.#projection = this.#deriveProjection();
		for (const listener of [...this.#listeners]) {
			try {
				listener(this.#projection);
			} catch (error) {
				onUnexpectedError(error);
			}
		}
	}
	#enqueue(task: () => Promise<void>, skipWhenDisposed = true): Promise<void> {
		this.#assertLive();
		const guarded = (): Promise<void> =>
			this.#disposed && skipWhenDisposed ? Promise.resolve() : task();
		const queued = this.#serial.then(guarded, guarded);
		this.#serial = queued.catch(() => {});
		return queued;
	}
	#policyIsCurrent(): boolean {
		return this.#authoritative.authoritativeTimeUnixMs >= this.#options.policy.activeFromUnixMs;
	}
	#validateBinding(): void {
		const attemptScope =
			this.#options.policy.scope.kind === 'attempt'
				? this.#options.policy.scope.attemptId
				: undefined;
		if (attemptScope !== undefined && attemptScope !== this.#options.binding.attemptId)
			throw new TypeError('Exam Security Policy does not match the Attempt binding');
		if (
			this.#options.policy.scope.kind === 'admission' &&
			this.#authoritative.attemptState === 'active'
		)
			throw new TypeError('One-use admission policy cannot authorize active participation');
		if (
			!Number.isSafeInteger(this.#options.binding.participationGeneration) ||
			this.#options.binding.participationGeneration <= 0
		)
			throw new TypeError('Exam Security participation generation is invalid');
		const authority = this.#options.ports.policyAuthority.verify(
			this.#options.policy,
			this.#options.binding
		);
		if (!authority.authenticated || !authority.antiRollbackAccepted)
			throw new TypeError('Exam Security Policy authenticity or anti-rollback check failed');
		if (!this.#policyIsCurrent())
			throw new TypeError('Exam Security Policy is not current at authoritative time');
	}
	#assertStarted(): void {
		this.#assertLive();
		if (!this.#started) throw new Error('Exam Security Coordinator has not started');
	}
	#assertStopLive(): void {
		if (this.#disposed)
			throw new Error('Exam Security Coordinator was disposed before shutdown completed');
	}
	#assertLive(): void {
		if (this.#disposed) throw new Error('Exam Security Coordinator is disposed');
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#options.ports.gates.denyAll('policy');
		this.#listeners.clear();
	}
}

function validateReconciliation(
	value: SecurityReconciliation,
	generation: number,
	selectedSources: readonly string[],
	capabilities: ExamSecurityCoordinatorOptions['policy']['capabilities'],
	focusLossMode: ExamSecurityCoordinatorOptions['policy']['focusLossMode']
): SecurityReconciliation {
	if (
		!isExactRecord(value, [
			'participationGeneration',
			'complete',
			'sources',
			'sourceResets',
			'findings'
		]) ||
		value.participationGeneration !== generation ||
		!Array.isArray(value.sources) ||
		!Array.isArray(value.sourceResets) ||
		!Array.isArray(value.findings) ||
		typeof value.complete !== 'boolean' ||
		value.sources.length > selectedSources.length ||
		value.sourceResets.length > selectedSources.length ||
		value.findings.length > 128
	)
		throw new TypeError('Security reconciliation is invalid or stale');
	const coverageBySource = new Map<string, SecuritySourceCoverage>();
	const sources: SecuritySourceCoverage[] = [];
	for (const source of value.sources) {
		if (
			!isExactRecord(source, [
				'source',
				'sourceInstanceId',
				'sequence',
				'health',
				'permission',
				'complete',
				'gapCount'
			])
		)
			throw new TypeError('Security reconciliation source coverage is invalid');
		const coverage = source as SecuritySourceCoverage;
		if (
			!selectedSources.includes(coverage.source) ||
			coverageBySource.has(coverage.source) ||
			!validCoverage(coverage)
		)
			throw new TypeError('Security reconciliation source coverage is invalid');
		const frozen: SecuritySourceCoverage = Object.freeze({ ...coverage });
		coverageBySource.set(coverage.source, frozen);
		sources.push(frozen);
	}
	const resetSources = new Set<string>();
	const sourceResets: SecuritySourceReset[] = [];
	for (const reset of value.sourceResets) {
		if (
			!isExactRecord(reset, [
				'kind',
				'source',
				'previousSourceInstanceId',
				'previousSequence',
				'newSourceInstanceId',
				'attempt'
			])
		)
			throw new TypeError('Security source reset is invalid');
		const sourceReset = reset as SecuritySourceReset;
		if (
			sourceReset.kind !== 'restarted' ||
			!selectedSources.includes(sourceReset.source) ||
			resetSources.has(sourceReset.source) ||
			!coverageBySource.has(sourceReset.source) ||
			typeof sourceReset.previousSourceInstanceId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u.test(sourceReset.previousSourceInstanceId) ||
			!Number.isSafeInteger(sourceReset.previousSequence) ||
			sourceReset.previousSequence < 0 ||
			typeof sourceReset.newSourceInstanceId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u.test(sourceReset.newSourceInstanceId) ||
			sourceReset.attempt !== 1
		)
			throw new TypeError('Security source reset is invalid');
		resetSources.add(sourceReset.source);
		sourceResets.push(Object.freeze({ ...sourceReset }));
	}
	const seenConditions = new Set<string>();
	const enforcedBaselineCapabilities = new Set([
		'candidate_window',
		'connection',
		'display_topology'
	]);
	const findings: DetectorFinding[] = [];
	for (const finding of value.findings) {
		if (
			!isExactRecord(finding, [
				'conditionId',
				'capabilityId',
				'mode',
				'status',
				'reason',
				'certainty',
				'gaps',
				'sourceRanges'
			])
		)
			throw new TypeError('Detector finding is invalid');
		const detectorFinding = finding as DetectorFinding;
		const family = capabilities.find(
			(candidate) => candidate.id === detectorFinding.capabilityId
		);
		const expectedMode =
			detectorFinding.capabilityId === 'focus_loss'
				? focusLossMode
				: enforcedBaselineCapabilities.has(detectorFinding.capabilityId)
					? 'enforce'
					: family?.mode;
		const expectedReason =
			SECURITY_REASON_BY_CAPABILITY[
				detectorFinding.capabilityId as keyof typeof SECURITY_REASON_BY_CAPABILITY
			];
		const expectedSource = findingSource(detectorFinding.capabilityId);
		if (
			(expectedMode !== 'enforce' && expectedMode !== 'observe') ||
			detectorFinding.mode !== expectedMode ||
			detectorFinding.reason !== expectedReason ||
			expectedSource === undefined ||
			!selectedSources.includes(expectedSource) ||
			!coverageBySource.has(expectedSource) ||
			typeof detectorFinding.conditionId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(detectorFinding.conditionId) ||
			typeof detectorFinding.capabilityId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(detectorFinding.capabilityId) ||
			seenConditions.has(detectorFinding.conditionId) ||
			!['enforce', 'observe'].includes(detectorFinding.mode) ||
			!['checking', 'clear', 'present'].includes(detectorFinding.status) ||
			!['complete', 'partial', 'unknown'].includes(detectorFinding.certainty) ||
			!Number.isSafeInteger(detectorFinding.gaps) ||
			detectorFinding.gaps < 0 ||
			detectorFinding.gaps > 65_535 ||
			!Array.isArray(detectorFinding.sourceRanges) ||
			detectorFinding.sourceRanges.length > selectedSources.length
		)
			throw new TypeError('Detector finding is invalid');
		seenConditions.add(detectorFinding.conditionId);
		const seenRanges = new Set<string>();
		const sourceRanges: DetectorFinding['sourceRanges'][number][] = [];
		for (const range of detectorFinding.sourceRanges) {
			if (
				!isExactRecord(range, [
					'source',
					'sourceInstanceId',
					'firstSequence',
					'lastSequence'
				])
			)
				throw new TypeError('Detector finding source range is invalid');
			const sourceRange = range as DetectorFinding['sourceRanges'][number];
			const coverage = coverageBySource.get(sourceRange.source);
			const key = `${sourceRange.source}:${sourceRange.sourceInstanceId}:${sourceRange.firstSequence}:${sourceRange.lastSequence}`;
			if (
				sourceRange.source !== expectedSource ||
				seenRanges.has(key) ||
				coverage === undefined ||
				typeof sourceRange.sourceInstanceId !== 'string' ||
				sourceRange.sourceInstanceId !== coverage.sourceInstanceId ||
				!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u.test(sourceRange.sourceInstanceId) ||
				!Number.isSafeInteger(sourceRange.firstSequence) ||
				!Number.isSafeInteger(sourceRange.lastSequence) ||
				sourceRange.firstSequence < 0 ||
				sourceRange.firstSequence > sourceRange.lastSequence ||
				sourceRange.lastSequence > coverage.sequence
			)
				throw new TypeError('Detector finding source range is invalid');
			seenRanges.add(key);
			sourceRanges.push(Object.freeze({ ...sourceRange }));
		}
		findings.push(
			Object.freeze({ ...detectorFinding, sourceRanges: Object.freeze(sourceRanges) })
		);
	}
	return Object.freeze({
		participationGeneration: value.participationGeneration,
		complete: value.complete,
		sources: Object.freeze(sources),
		sourceResets: Object.freeze(sourceResets),
		findings: Object.freeze(findings)
	});
}

function occurrenceEvidenceSignature(finding: DetectorFinding): string {
	return JSON.stringify([
		finding.capabilityId,
		finding.mode,
		finding.certainty,
		finding.gaps,
		finding.sourceRanges.map((range) => [
			range.source,
			range.sourceInstanceId,
			range.firstSequence,
			range.lastSequence
		])
	]);
}
function findingSource(capabilityId: string): NativeSourceId | undefined {
	if (capabilityId === 'candidate_window' || capabilityId === 'focus_loss')
		return 'candidate-window';
	if (capabilityId === 'display_topology') return 'display-topology';
	if (capabilityId === 'connection' || capabilityId === 'external_capture')
		return 'capture-session';
	const source = getNativeCapability(capabilityId)?.sourceId;
	return source as NativeSourceId | undefined;
}
function validCoverage(value: SecuritySourceCoverage): boolean {
	return (
		typeof value.sourceInstanceId === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u.test(value.sourceInstanceId) &&
		Number.isSafeInteger(value.sequence) &&
		value.sequence >= 0 &&
		typeof value.health === 'string' &&
		['degraded', 'failed', 'healthy', 'recovering', 'starting', 'stopped'].includes(
			value.health
		) &&
		typeof value.permission === 'string' &&
		['denied', 'granted', 'not_determined', 'restricted', 'unavailable'].includes(
			value.permission
		) &&
		typeof value.complete === 'boolean' &&
		Number.isSafeInteger(value.gapCount) &&
		value.gapCount >= 0 &&
		value.gapCount <= 65_535
	);
}
function validateAuthoritative(value: AuthoritativeSecurityState): AuthoritativeSecurityState {
	if (
		!isExactRecord(value, [
			'attemptState',
			'attemptRevision',
			'paused',
			'leasePhase',
			'activeCorrections',
			'authoritativeTimeUnixMs'
		]) ||
		typeof value.attemptState !== 'string' ||
		!['active', 'ready', 'submitted', 'suspended'].includes(value.attemptState) ||
		!Number.isSafeInteger(value.attemptRevision) ||
		value.attemptRevision < 0 ||
		typeof value.paused !== 'boolean' ||
		typeof value.leasePhase !== 'string' ||
		!['connected', 'expired', 'reconnecting'].includes(value.leasePhase) ||
		!Array.isArray(value.activeCorrections) ||
		value.activeCorrections.length > 128 ||
		!Number.isSafeInteger(value.authoritativeTimeUnixMs) ||
		value.authoritativeTimeUnixMs < 0 ||
		(value.attemptState !== 'active' && value.paused)
	)
		throw new TypeError('Authoritative security state is invalid');
	const ids = new Set<string>();
	for (const correction of value.activeCorrections) {
		if (
			!isExactRecord(correction, [
				'correctionId',
				'revision',
				'reason',
				'requiresAcknowledgement',
				'acknowledged',
				'affectedCapabilities'
			]) ||
			typeof correction.correctionId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(correction.correctionId) ||
			ids.has(correction.correctionId) ||
			!Number.isSafeInteger(correction.revision) ||
			correction.revision <= 0 ||
			typeof correction.reason !== 'string' ||
			!safeReasons.has(correction.reason) ||
			typeof correction.requiresAcknowledgement !== 'boolean' ||
			typeof correction.acknowledged !== 'boolean' ||
			!Array.isArray(correction.affectedCapabilities) ||
			correction.affectedCapabilities.length === 0 ||
			correction.affectedCapabilities.length > correctionCapabilities.size ||
			correction.affectedCapabilities.some(
				(capability) =>
					typeof capability !== 'string' || !correctionCapabilities.has(capability)
			) ||
			new Set(correction.affectedCapabilities).size !== correction.affectedCapabilities.length
		)
			throw new TypeError('Authoritative live correction is invalid');
		ids.add(correction.correctionId);
	}
	return freezeAuthoritative(value);
}
function freezeAuthoritative(value: AuthoritativeSecurityState): AuthoritativeSecurityState {
	return Object.freeze({
		...value,
		activeCorrections: Object.freeze(
			value.activeCorrections.map((correction) =>
				Object.freeze({
					...correction,
					affectedCapabilities: Object.freeze([...correction.affectedCapabilities])
				})
			)
		)
	});
}
function sameAuthoritative(
	left: AuthoritativeSecurityState,
	right: AuthoritativeSecurityState
): boolean {
	return (
		left.attemptState === right.attemptState &&
		left.attemptRevision === right.attemptRevision &&
		left.paused === right.paused &&
		left.leasePhase === right.leasePhase &&
		left.authoritativeTimeUnixMs === right.authoritativeTimeUnixMs &&
		JSON.stringify(left.activeCorrections) === JSON.stringify(right.activeCorrections)
	);
}
function freezeRanges(ranges: DetectorFinding['sourceRanges']): DetectorFinding['sourceRanges'] {
	return Object.freeze(ranges.map((range) => Object.freeze({ ...range })));
}
const safeReasons: ReadonlySet<string> = new Set<SafeSecurityReason>([
	'candidateWindow',
	'connection',
	'display',
	'interactiveSession',
	'media',
	'network',
	'pause',
	'policy',
	'printing',
	'processApplication',
	'removableStorage',
	'sourceCoverage',
	'virtualization'
]);
const correctionCapabilities = new Set(['browser', 'submission', 'workspace']);
function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, any> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
