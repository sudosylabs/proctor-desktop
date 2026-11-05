/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type AuthoritativeAttemptState = 'active' | 'ready' | 'submitted' | 'suspended';
export type SecureExamPosture =
	'uninitialized' | 'checking' | 'compliant' | 'degraded' | 'contained' | 'failed' | 'stopped';
export type ParticipationLeasePhase = 'connected' | 'expired' | 'reconnecting';
export type SafeSecurityReason =
	| 'candidateWindow'
	| 'connection'
	| 'display'
	| 'interactiveSession'
	| 'media'
	| 'network'
	| 'pause'
	| 'policy'
	| 'printing'
	| 'processApplication'
	| 'removableStorage'
	| 'sourceCoverage'
	| 'virtualization';
export type ProtectedWorkState = 'failed' | 'notRequired' | 'protected' | 'protecting';
export type CandidateCorrectionCapability = 'browser' | 'submission' | 'workspace';

export interface CandidateSecurityCondition {
	readonly reason: SafeSecurityReason;
	readonly state: 'checking' | 'required';
}
export interface CandidateLiveCorrection {
	readonly correctionId: string;
	readonly revision: number;
	readonly reason: SafeSecurityReason;
	readonly state: 'acknowledgementRequired' | 'notice';
	readonly affectedCapabilities: readonly CandidateCorrectionCapability[];
}

export interface CandidateSecurityProjection {
	readonly revision: number;
	readonly attemptState: AuthoritativeAttemptState;
	readonly attemptRevision: number;
	readonly posture: SecureExamPosture;
	readonly safeReason?: SafeSecurityReason;
	readonly participationGeneration: number;
	readonly leasePhase: ParticipationLeasePhase;
	readonly paused: boolean;
	readonly protectedWork: ProtectedWorkState;
	readonly canJoin: boolean;
	readonly canRetryChecks: boolean;
	readonly canWorkspaceMutate: boolean;
	readonly canUseBrowser: boolean;
	readonly canSubmit: boolean;
	readonly activeSecurityConditions: readonly CandidateSecurityCondition[];
	readonly activeCorrections: readonly CandidateLiveCorrection[];
	readonly authoritativeTimeUnixMs: number;
}

const phases = new Set<SecureExamPosture>([
	'uninitialized',
	'checking',
	'compliant',
	'degraded',
	'contained',
	'failed',
	'stopped'
]);
const attempts = new Set<AuthoritativeAttemptState>(['active', 'ready', 'submitted', 'suspended']);
const leases = new Set<ParticipationLeasePhase>(['connected', 'expired', 'reconnecting']);
const protectedStates = new Set<ProtectedWorkState>([
	'failed',
	'notRequired',
	'protected',
	'protecting'
]);
const reasons = new Set<SafeSecurityReason>([
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
const capabilities = new Set<CandidateCorrectionCapability>(['browser', 'submission', 'workspace']);
const allowed = new Set([
	'revision',
	'attemptState',
	'attemptRevision',
	'posture',
	'safeReason',
	'participationGeneration',
	'leasePhase',
	'paused',
	'protectedWork',
	'canJoin',
	'canRetryChecks',
	'canWorkspaceMutate',
	'canUseBrowser',
	'canSubmit',
	'activeSecurityConditions',
	'activeCorrections',
	'authoritativeTimeUnixMs'
]);
export type CandidateSecurityIntent =
	| { readonly kind: 'security.retryChecks'; readonly projectionRevision: number }
	| {
			readonly kind: 'security.acknowledgeCorrection';
			readonly projectionRevision: number;
			readonly correctionId: string;
			readonly correctionRevision: number;
	  };

export function validateCandidateSecurityIntent(value: unknown): CandidateSecurityIntent {
	if (!isRecord(value) || !integer(value.projectionRevision, 0))
		throw new TypeError('Candidate Security intent is invalid');
	if (value.kind === 'security.retryChecks' && Object.keys(value).length === 2)
		return Object.freeze({ kind: value.kind, projectionRevision: value.projectionRevision });
	if (
		value.kind === 'security.acknowledgeCorrection' &&
		Object.keys(value).length === 4 &&
		identifier(value.correctionId) &&
		integer(value.correctionRevision, 1)
	)
		return Object.freeze({
			kind: value.kind,
			projectionRevision: value.projectionRevision,
			correctionId: value.correctionId,
			correctionRevision: value.correctionRevision
		});
	throw new TypeError('Candidate Security intent is invalid');
}

export function validateCandidateSecurityIntentForProjection(
	value: unknown,
	projection: CandidateSecurityProjection
): CandidateSecurityIntent {
	const intent = validateCandidateSecurityIntent(value);
	if (intent.projectionRevision !== projection.revision)
		throw new TypeError('Candidate Security intent is stale');
	if (intent.kind === 'security.retryChecks' && !projection.canRetryChecks)
		throw new TypeError('Candidate Security checks cannot be retried from this projection');
	if (
		intent.kind === 'security.acknowledgeCorrection' &&
		!projection.activeCorrections.some(
			(correction) =>
				correction.correctionId === intent.correctionId &&
				correction.revision === intent.correctionRevision &&
				correction.state === 'acknowledgementRequired'
		)
	)
		throw new TypeError('Candidate correction acknowledgement is stale or unavailable');
	return intent;
}

export function validateCandidateSecurityProjection(value: unknown): CandidateSecurityProjection {
	if (
		!isRecord(value) ||
		Object.keys(value).some((key) => !allowed.has(key)) ||
		!integer(value.revision, 0) ||
		!stringMember(value.attemptState, attempts) ||
		!integer(value.attemptRevision, 0) ||
		!stringMember(value.posture, phases) ||
		(value.safeReason !== undefined && !stringMember(value.safeReason, reasons)) ||
		!integer(value.participationGeneration, 1) ||
		!stringMember(value.leasePhase, leases) ||
		typeof value.paused !== 'boolean' ||
		!stringMember(value.protectedWork, protectedStates) ||
		!booleans(value, [
			'canJoin',
			'canRetryChecks',
			'canWorkspaceMutate',
			'canUseBrowser',
			'canSubmit'
		]) ||
		!integer(value.authoritativeTimeUnixMs, 0) ||
		!Array.isArray(value.activeSecurityConditions) ||
		value.activeSecurityConditions.length > reasons.size ||
		!Array.isArray(value.activeCorrections) ||
		value.activeCorrections.length > 128
	)
		throw new TypeError('Candidate Security projection is invalid');
	const conditions = value.activeSecurityConditions.map(validateCondition);
	const corrections = value.activeCorrections.map(validateCorrection);
	if (
		new Set(conditions.map((condition) => `${condition.reason}:${condition.state}`)).size !==
			conditions.length ||
		new Set(corrections.map((correction) => correction.correctionId)).size !==
			corrections.length
	)
		throw new TypeError(
			'Candidate Security projection contains duplicate conditions or corrections'
		);
	const baseAllowed =
		value.attemptState === 'active' &&
		!value.paused &&
		value.leasePhase === 'connected' &&
		(value.posture === 'compliant' || value.posture === 'degraded');
	const expected = (capability: CandidateCorrectionCapability): boolean =>
		baseAllowed &&
		!corrections.some(
			(correction) =>
				correction.state === 'acknowledgementRequired' &&
				correction.affectedCapabilities.includes(capability)
		);
	const expectedJoin =
		value.attemptState === 'ready' &&
		!value.paused &&
		value.leasePhase === 'connected' &&
		(value.posture === 'compliant' || value.posture === 'degraded');
	const expectedRetry =
		value.attemptState !== 'submitted' &&
		(value.posture === 'checking' ||
			value.posture === 'contained' ||
			value.posture === 'failed');
	if (
		value.canWorkspaceMutate !== expected('workspace') ||
		value.canUseBrowser !== expected('browser') ||
		value.canSubmit !== expected('submission') ||
		value.canJoin !== expectedJoin ||
		value.canRetryChecks !== expectedRetry
	)
		throw new TypeError('Candidate Security projection is internally inconsistent');
	return Object.freeze({
		revision: value.revision,
		attemptState: value.attemptState,
		attemptRevision: value.attemptRevision,
		posture: value.posture,
		...(value.safeReason === undefined ? {} : { safeReason: value.safeReason }),
		participationGeneration: value.participationGeneration,
		leasePhase: value.leasePhase,
		paused: value.paused,
		protectedWork: value.protectedWork,
		canJoin: value.canJoin as boolean,
		canRetryChecks: value.canRetryChecks as boolean,
		canWorkspaceMutate: value.canWorkspaceMutate as boolean,
		canUseBrowser: value.canUseBrowser as boolean,
		canSubmit: value.canSubmit as boolean,
		activeSecurityConditions: Object.freeze(conditions),
		activeCorrections: Object.freeze(corrections),
		authoritativeTimeUnixMs: value.authoritativeTimeUnixMs
	});
}

function validateCondition(value: unknown): CandidateSecurityCondition {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== 2 ||
		!reasons.has(value.reason as SafeSecurityReason) ||
		(value.state !== 'checking' && value.state !== 'required')
	)
		throw new TypeError('Candidate Security condition is invalid');
	return Object.freeze({ reason: value.reason as SafeSecurityReason, state: value.state });
}
function validateCorrection(value: unknown): CandidateLiveCorrection {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== 5 ||
		!identifier(value.correctionId) ||
		!integer(value.revision, 1) ||
		!reasons.has(value.reason as SafeSecurityReason) ||
		(value.state !== 'acknowledgementRequired' && value.state !== 'notice') ||
		!Array.isArray(value.affectedCapabilities) ||
		value.affectedCapabilities.length === 0 ||
		value.affectedCapabilities.length > capabilities.size
	)
		throw new TypeError('Candidate live correction is invalid');
	const affected = value.affectedCapabilities.map((capability) => {
		if (!capabilities.has(capability as CandidateCorrectionCapability))
			throw new TypeError('Candidate live correction capability is invalid');
		return capability as CandidateCorrectionCapability;
	});
	if (new Set(affected).size !== affected.length)
		throw new TypeError('Candidate live correction capabilities are duplicated');
	return Object.freeze({
		correctionId: value.correctionId,
		revision: value.revision,
		reason: value.reason as SafeSecurityReason,
		state: value.state,
		affectedCapabilities: Object.freeze(affected)
	});
}
function identifier(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
function booleans(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return keys.every((key) => typeof value[key] === 'boolean');
}
function integer(value: unknown, minimum: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function stringMember<T extends string>(value: unknown, values: ReadonlySet<T>): value is T {
	return typeof value === 'string' && values.has(value as T);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
