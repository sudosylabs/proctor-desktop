/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { NativeCapabilityMode, NativeClosedEffect } from '../../../../platform/native/common/nativeCapabilityRegistry.js';
import type { NativeSourceId } from '../../../../platform/native/common/securityUtilityProtocol.js';
import type { EffectiveExamSecurityPolicy, ExamSecurityNativeSelection } from './effectivePolicy.js';
import type { AuthoritativeAttemptState, CandidateCorrectionCapability, CandidateSecurityProjection, ParticipationLeasePhase, SafeSecurityReason } from './securityProjectionProtocol.js';

export type { AuthoritativeAttemptState, CandidateSecurityProjection, ParticipationLeasePhase, ProtectedWorkState, SafeSecurityReason, SecureExamPosture } from './securityProjectionProtocol.js';

export interface ExamSecurityBinding { readonly attemptId: string; readonly sessionId: string; readonly connectionId: string; readonly participationGeneration: number; readonly securitySessionId: string }
export interface AuthoritativeLiveCorrection { readonly correctionId: string; readonly revision: number; readonly reason: SafeSecurityReason; readonly requiresAcknowledgement: boolean; readonly acknowledged: boolean; readonly affectedCapabilities: readonly CandidateCorrectionCapability[] }
export interface AuthoritativeSecurityState { readonly attemptState: AuthoritativeAttemptState; readonly attemptRevision: number; readonly paused: boolean; readonly leasePhase: ParticipationLeasePhase; readonly activeCorrections: readonly AuthoritativeLiveCorrection[]; readonly authoritativeTimeUnixMs: number }
export interface SecuritySourceCoverage { readonly source: NativeSourceId; readonly sourceInstanceId: string; readonly sequence: number; readonly health: 'degraded' | 'failed' | 'healthy' | 'recovering' | 'starting' | 'stopped'; readonly permission: 'denied' | 'granted' | 'not_determined' | 'restricted' | 'unavailable'; readonly complete: boolean; readonly gapCount: number }
export interface SecuritySourceReset { readonly kind: 'restarted'; readonly source: NativeSourceId; readonly previousSourceInstanceId: string; readonly previousSequence: number; readonly newSourceInstanceId: string; readonly attempt: number }
export interface SecuritySourceRange { readonly source: NativeSourceId; readonly sourceInstanceId: string; readonly firstSequence: number; readonly lastSequence: number }
export interface DetectorFinding { readonly conditionId: string; readonly capabilityId: string; readonly mode: Exclude<NativeCapabilityMode, 'disabled'>; readonly status: 'checking' | 'clear' | 'present'; readonly reason: SafeSecurityReason; readonly certainty: 'complete' | 'partial' | 'unknown'; readonly gaps: number; readonly sourceRanges: readonly SecuritySourceRange[] }
export interface SecurityReconciliation { readonly participationGeneration: number; readonly complete: boolean; readonly sources: readonly SecuritySourceCoverage[]; readonly sourceResets: readonly SecuritySourceReset[]; readonly findings: readonly DetectorFinding[] }

export interface MinimizedIntegrityOccurrence { readonly occurrenceId: string; readonly conditionId: string; readonly capabilityId: string; readonly mode: 'enforce' | 'observe'; readonly status: 'opened' | 'recovered' | 'repeated'; readonly firstObservedUnixMs: number; readonly lastConfirmedUnixMs: number; readonly repeatCount: number; readonly certainty: 'complete' | 'partial' | 'unknown'; readonly gapCount: number; readonly sourceRanges: readonly SecuritySourceRange[]; readonly policyDigest: string; readonly participationGeneration: number }
export interface SecurityOperationGatePort { denyAll(reason: SafeSecurityReason): void; allowAll(participationGeneration: number): void }
export interface UndispatchedOperationPort { cancelProvenUndispatched(): Promise<void> }
export interface WorkspaceProtectionPort { protectAcceptedAndUnknown(): Promise<{ readonly protected: boolean; readonly unknownOutcomesRetained: boolean }> }
export interface ClosedEnforcementPort { apply(effects: readonly NativeClosedEffect[], participationGeneration: number): Promise<{ readonly verified: boolean }>; release(participationGeneration: number): Promise<void> }
export interface NativeSourceLifecyclePort { stopAndDrain(participationGeneration: number): Promise<{ readonly clean: boolean }> }
export interface IntegrityDeliveryPort { enqueue(records: readonly MinimizedIntegrityOccurrence[]): Promise<void>; seal(participationGeneration: number): Promise<void> }
export interface ExamSecurityIdFactory { nextOccurrenceId(): string }
export interface ExamSecurityPolicyAuthorityPort { verify(policy: EffectiveExamSecurityPolicy, binding: ExamSecurityBinding): { readonly authenticated: boolean; readonly antiRollbackAccepted: boolean } }
export interface ExamSecurityPorts { readonly policyAuthority: ExamSecurityPolicyAuthorityPort; readonly gates: SecurityOperationGatePort; readonly undispatched: UndispatchedOperationPort; readonly workspace: WorkspaceProtectionPort; readonly enforcement: ClosedEnforcementPort; readonly sources: NativeSourceLifecyclePort; readonly delivery: IntegrityDeliveryPort; readonly ids: ExamSecurityIdFactory }

export interface ExamSecurityObservation { readonly current: CandidateSecurityProjection; readonly onDidChange: (listener: (projection: CandidateSecurityProjection) => void) => { readonly dispose: () => void } }
export interface ExamSecurityCoordinator {
	observe(): ExamSecurityObservation;
	start(): Promise<void>;
	signalHighConfidence(reason: SafeSecurityReason): void;
	reconcile(value: SecurityReconciliation): Promise<void>;
	updateAuthoritativeState(value: AuthoritativeSecurityState): Promise<void>;
	failClosed(reason: SafeSecurityReason): Promise<void>;
	stop(): Promise<void>;
	dispose(): void;
}
export interface ExamSecurityCoordinatorOptions { readonly binding: ExamSecurityBinding; readonly authoritative: AuthoritativeSecurityState; readonly policy: EffectiveExamSecurityPolicy; readonly selection: ExamSecurityNativeSelection; readonly ports: ExamSecurityPorts }
