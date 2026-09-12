import assert from 'node:assert';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import {
	errorHandler,
	setUnexpectedErrorHandler
} from '../../../../../src/prctr/base/common/errors.ts';
import {
	NATIVE_BASELINE_CAPABILITIES,
	NATIVE_CAPABILITY_REGISTRY,
	NATIVE_CAPABILITY_REGISTRY_DIGEST,
	type NativeCapabilityMatrix
} from '../../../../../src/prctr/platform/native/common/nativeCapabilityRegistry.ts';
import type { NativeSourceId } from '../../../../../src/prctr/platform/native/common/securityUtilityProtocol.ts';
import type {
	AuthoritativeSecurityState,
	CandidateSecurityProjection,
	ExamSecurityPorts,
	MinimizedIntegrityOccurrence,
	SecurityReconciliation
} from '../../../../../src/prctr/workbench/services/examSecurity/common/examSecurity.ts';
import {
	resolveExamSecurityNativeSelection,
	validateEffectiveExamSecurityPolicy,
	type EffectiveExamSecurityPolicy
} from '../../../../../src/prctr/workbench/services/examSecurity/common/effectivePolicy.ts';
import {
	validateCandidateSecurityIntent,
	validateCandidateSecurityIntentForProjection,
	validateCandidateSecurityProjection
} from '../../../../../src/prctr/workbench/services/examSecurity/common/securityProjectionProtocol.ts';
import { createExamSecurityCoordinator } from '../../../../../src/prctr/workbench/services/examSecurity/electron-utility/examSecurityCoordinator.ts';

function policyFixture(): EffectiveExamSecurityPolicy {
	return validateEffectiveExamSecurityPolicy({
		schemaVersion: 1,
		policyId: 'policy:one',
		revision: 'policy:revision:one',
		ordinal: 1,
		digest: `sha256:${'a'.repeat(64)}`,
		institutionId: 'institution:one',
		examRevisionId: 'exam:revision:one',
		sittingId: 'sitting:one',
		scope: { kind: 'attempt', attemptId: 'attempt:one' },
		issuedAtUnixMs: 900,
		activeFromUnixMs: 1_000,
		applicationReleaseId: 'desktop-test-v1',
		matrixId: 'development-matrix-v1',
		targetTuple: 'macos-arm64-test',
		registryDigest: NATIVE_CAPABILITY_REGISTRY_DIGEST,
		focusLossMode: 'enforce',
		connectionLossMode: 'enforce',
		resolvedExceptionRefs: [],
		evidenceClassId: 'native_integrity',
		visibilityClassId: 'examiner_restricted',
		retentionClassId: 'native_minimized',
		capabilities: [
			{
				id: 'process_application',
				mode: 'enforce',
				allowedApplicationIds: ['application:proctor']
			},
			{ id: 'interactive_session', mode: 'observe' },
			{
				id: 'clipboard',
				mode: 'enforce',
				strategy: 'private_attempt',
				observeOsClipboardChanges: true
			},
			{
				id: 'printing',
				mode: 'enforce',
				candidatePrintCommands: 'deny',
				monitoredSpooler: 'required'
			},
			{
				id: 'removable_storage',
				mode: 'observe',
				enabledSubCapabilities: ['removable_block_storage'],
				allowedStorageFunctionClassIds: []
			},
			{ id: 'virtualization', mode: 'enforce', rule: 'block_recognized_guest' },
			{
				id: 'network_configuration',
				mode: 'enforce',
				enabledSubCapabilities: ['system_proxy_state', 'route_change'],
				allowedManagedProfileIds: [],
				allowedAdapterClassIds: [],
				allowedTunnelClassIds: []
			},
			{
				id: 'camera',
				mode: 'enforce',
				requireReady: true,
				concurrentUseCheck: 'not_required'
			},
			{
				id: 'microphone',
				mode: 'observe',
				requireReady: true,
				concurrentUseCheck: 'not_required'
			},
			{ id: 'external_capture', mode: 'disabled' }
		]
	});
}

function matrixFixture(): NativeCapabilityMatrix {
	return {
		registry_digest: NATIVE_CAPABILITY_REGISTRY_DIGEST,
		matrix_id: 'development-matrix-v1',
		release_id: 'desktop-test-v1',
		target_tuple: 'macos-arm64-test',
		entries: [
			...NATIVE_CAPABILITY_REGISTRY,
			...NATIVE_BASELINE_CAPABILITIES.map((baseline) => ({
				id: baseline.id,
				permissions: baseline.permissions,
				subCapabilities: [baseline]
			}))
		]
			.flatMap((family) =>
				family.subCapabilities.map((sub) => {
					const permitted: readonly string[] = sub.permittedClaims;
					const claim = permitted.includes('enforce')
						? ('enforce' as const)
						: permitted.includes('observe')
							? ('observe' as const)
							: ('unavailable' as const);
					return {
						coverage_key: sub.coverageKey,
						source_schema_digest: sub.sourceSchemaDigest,
						claim,
						component_id: `component-${family.id}`,
						adapter_version: 'adapter-v1',
						required_permissions: family.permissions.macos,
						limitations: [],
						verification:
							claim === 'unavailable' ? ('unavailable' as const) : ('passed' as const)
					};
				})
			)
			.sort((a, b) =>
				a.coverage_key < b.coverage_key ? -1 : a.coverage_key > b.coverage_key ? 1 : 0
			)
	};
}

class PortsHarness {
	readonly log: string[] = [];
	readonly records: MinimizedIntegrityOccurrence[] = [];
	readonly projections: CandidateSecurityProjection[] = [];
	nextId = 0;
	authorityAccepted = true;
	protectionSucceeds = true;
	effectSucceeds = true;
	releaseSucceeds = true;
	sourceStopSucceeds = true;
	deliverySucceeds = true;
	sealSucceeds = true;
	protectionBarrier: Promise<void> | undefined;
	readonly ports: ExamSecurityPorts = {
		policyAuthority: {
			verify: () => ({
				authenticated: this.authorityAccepted,
				antiRollbackAccepted: this.authorityAccepted
			})
		},
		gates: {
			denyAll: (reason) => {
				this.log.push(`deny:${reason}`);
			},
			allowAll: (generation) => {
				this.log.push(`allow:${generation}`);
			}
		},
		undispatched: {
			cancelProvenUndispatched: async () => {
				this.log.push('cancel');
			}
		},
		workspace: {
			protectAcceptedAndUnknown: async () => {
				this.log.push('protect');
				await this.protectionBarrier;
				return {
					protected: this.protectionSucceeds,
					unknownOutcomesRetained: this.protectionSucceeds
				};
			}
		},
		enforcement: {
			apply: async (effects) => {
				this.log.push(`effects:${[...effects].sort().join(',')}`);
				return { verified: this.effectSucceeds };
			},
			release: async () => {
				this.log.push('effects:release');
				if (!this.releaseSucceeds) throw new Error('release unavailable');
			}
		},
		sources: {
			stopAndDrain: async () => {
				this.log.push('sources:stop');
				return { clean: this.sourceStopSucceeds };
			}
		},
		delivery: {
			enqueue: async (records) => {
				this.log.push(`delivery:${records.map((record) => record.status).join(',')}`);
				if (!this.deliverySucceeds) throw new Error('delivery unavailable');
				this.records.push(...records);
			},
			seal: async () => {
				this.log.push('delivery:seal');
				if (!this.sealSucceeds) throw new Error('seal unavailable');
			}
		},
		ids: { nextOccurrenceId: () => `occurrence:${++this.nextId}` }
	};
}

function authoritative(
	overrides: Partial<AuthoritativeSecurityState> = {}
): AuthoritativeSecurityState {
	return {
		attemptState: 'active',
		attemptRevision: 1,
		paused: false,
		leasePhase: 'connected',
		activeCorrections: [],
		authoritativeTimeUnixMs: 2_000,
		...overrides
	};
}
function coverage(source: NativeSourceId) {
	return {
		source,
		sourceInstanceId: `${source}:instance:00000001`,
		sequence: 1,
		health: 'healthy' as const,
		permission: 'granted' as const,
		complete: true,
		gapCount: 0
	};
}
function coverageAt(sources: readonly NativeSourceId[], sequence: number) {
	return sources.map((source) => ({ ...coverage(source), sequence }));
}
function cleanReconciliation(
	sources: readonly NativeSourceId[],
	overrides: Partial<SecurityReconciliation> = {}
): SecurityReconciliation {
	return {
		participationGeneration: 7,
		complete: true,
		sources: sources.map(coverage),
		sourceResets: [],
		findings: [],
		...overrides
	};
}
function coordinatorHarness(state = authoritative()) {
	const policy = policyFixture();
	const selection = resolveExamSecurityNativeSelection(policy, matrixFixture());
	const harness = new PortsHarness();
	const coordinator = createExamSecurityCoordinator({
		binding: {
			attemptId: 'attempt:one',
			sessionId: 'session:one',
			connectionId: 'connection:one',
			participationGeneration: 7,
			securitySessionId: 'security:one'
		},
		authoritative: state,
		policy,
		selection,
		ports: harness.ports
	});
	coordinator.observe().onDidChange((projection) => {
		harness.projections.push(projection);
		harness.log.push(`publish:${projection.posture}`);
	});
	return { policy, selection, harness, coordinator };
}

test('effective policy is canonical, registry-closed, matrix-bound and selects no disabled source', () => {
	const policy = policyFixture();
	const matrix = matrixFixture();
	const selection = resolveExamSecurityNativeSelection(policy, matrix);
	assert.deepStrictEqual(selection.selectedSources, [
		'display-topology',
		'candidate-window',
		'capture-session',
		'process-application',
		'interactive-session',
		'clipboard',
		'print-spooler',
		'removable-storage',
		'virtualization',
		'network-configuration',
		'media-device'
	]);
	assert.deepStrictEqual(selection.selectedSourceCategories, [
		'os-clipboard-change',
		'removable-block-storage',
		'system-proxy-state',
		'route-change',
		'camera',
		'microphone'
	]);
	assert.deepStrictEqual(selection.closedEffects, [
		'candidate_content_protection',
		'candidate_print_command_denial',
		'candidate_private_clipboard'
	]);
	assert.equal(
		selection.requiredCoverageKeys.includes('native.external_capture_detection.v1'),
		false
	);
	assert.throws(
		() =>
			validateEffectiveExamSecurityPolicy({
				...policy,
				capabilities: [...policy.capabilities].reverse()
			}),
		/Native family/u
	);
	for (const capabilities of [
		policy.capabilities.map((family) =>
			family.id === 'virtualization'
				? { ...family, rule: new String('require_certified_physical_environment') }
				: family
		),
		policy.capabilities.map((family) =>
			family.id === 'camera'
				? { ...family, concurrentUseCheck: new String('supported_required') }
				: family
		)
	])
		assert.throws(
			() => validateEffectiveExamSecurityPolicy({ ...policy, capabilities }),
			/Native family/u
		);
	const unavailable = {
		...matrix,
		entries: matrix.entries.map((entry) =>
			entry.coverage_key === 'native.camera_ready.v1'
				? { ...entry, claim: 'unavailable' as const, verification: 'unavailable' as const }
				: entry
		)
	};
	assert.throws(() => resolveExamSecurityNativeSelection(policy, unavailable), /cannot satisfy/u);
});

test('effect-only clipboard and printing policy does not start an observation source', () => {
	const matrix = matrixFixture();
	const base = policyFixture();
	const clipboardPolicy = validateEffectiveExamSecurityPolicy({
		...base,
		capabilities: base.capabilities.map((family) =>
			family.id === 'clipboard' ? { ...family, observeOsClipboardChanges: false } : family
		)
	});
	const clipboardSelection = resolveExamSecurityNativeSelection(clipboardPolicy, matrix);
	assert.strictEqual(clipboardSelection.selectedSources.includes('clipboard'), false);
	assert.strictEqual(
		clipboardSelection.selectedSourceCategories.includes('os-clipboard-change'),
		false
	);
	assert.strictEqual(clipboardSelection.enforcedSourceIds.includes('clipboard'), false);
	assert.strictEqual(clipboardSelection.observeSourceIds.includes('clipboard'), false);
	assert.strictEqual(
		clipboardSelection.closedEffects.includes('candidate_private_clipboard'),
		true
	);
	const printingPolicy = validateEffectiveExamSecurityPolicy({
		...base,
		capabilities: base.capabilities.map((family) =>
			family.id === 'printing' ? { ...family, monitoredSpooler: 'not_required' } : family
		)
	});
	const printingSelection = resolveExamSecurityNativeSelection(printingPolicy, matrix);
	assert.strictEqual(printingSelection.selectedSources.includes('print-spooler'), false);
	assert.strictEqual(printingSelection.enforcedSourceIds.includes('print-spooler'), false);
	assert.strictEqual(printingSelection.observeSourceIds.includes('print-spooler'), false);
	assert.strictEqual(
		printingSelection.closedEffects.includes('candidate_print_command_denial'),
		true
	);
});

test('disabled media policy does not open or widen the shared media source', () => {
	const matrix = matrixFixture();
	const base = policyFixture();
	const noClaimMedia = (family: EffectiveExamSecurityPolicy['capabilities'][number]) =>
		family.id === 'camera' || family.id === 'microphone'
			? {
					...family,
					mode: 'disabled' as const,
					requireReady: false,
					concurrentUseCheck: 'not_required' as const
				}
			: family;
	const isolatedPolicy = validateEffectiveExamSecurityPolicy({
		...base,
		capabilities: base.capabilities.map(noClaimMedia)
	});
	const isolatedSelection = resolveExamSecurityNativeSelection(isolatedPolicy, matrix);
	assert.strictEqual(isolatedSelection.selectedSources.includes('media-device'), false);
	assert.strictEqual(isolatedSelection.enforcedSourceIds.includes('media-device'), false);
	assert.strictEqual(isolatedSelection.observeSourceIds.includes('media-device'), false);
	assert.strictEqual(isolatedSelection.selectedSourceCategories.includes('camera'), false);
	assert.strictEqual(isolatedSelection.selectedSourceCategories.includes('microphone'), false);
	const mixedPolicy = validateEffectiveExamSecurityPolicy({
		...base,
		capabilities: base.capabilities.map((family) =>
			family.id === 'camera'
				? {
						...family,
						mode: 'disabled' as const,
						requireReady: false,
						concurrentUseCheck: 'not_required' as const
					}
				: family
		)
	});
	const mixedSelection = resolveExamSecurityNativeSelection(mixedPolicy, matrix);
	assert.strictEqual(mixedSelection.selectedSources.includes('media-device'), true);
	assert.strictEqual(mixedSelection.selectedSourceCategories.includes('camera'), false);
	assert.strictEqual(mixedSelection.selectedSourceCategories.includes('microphone'), true);
	assert.strictEqual(mixedSelection.enforcedSourceIds.includes('media-device'), false);
	assert.strictEqual(mixedSelection.observeSourceIds.includes('media-device'), true);
});

test('coordinator rejects unauthenticated, rolled-back, stale and wrong-scope policy before effects', () => {
	const policy = policyFixture();
	const selection = resolveExamSecurityNativeSelection(policy, matrixFixture());
	const ports = new PortsHarness();
	ports.authorityAccepted = false;
	const create = (candidatePolicy: EffectiveExamSecurityPolicy, state = authoritative()) =>
		createExamSecurityCoordinator({
			binding: {
				attemptId: 'attempt:one',
				sessionId: 'session:one',
				connectionId: 'connection:one',
				participationGeneration: 7,
				securitySessionId: 'security:one'
			},
			authoritative: state,
			policy: candidatePolicy,
			selection,
			ports: ports.ports
		});
	assert.throws(() => create(policy), /authenticity/u);
	ports.authorityAccepted = true;
	assert.throws(
		() =>
			create(policy, authoritative({ authoritativeTimeUnixMs: policy.activeFromUnixMs - 1 })),
		/not current/u
	);
	assert.throws(
		() => create({ ...policy, scope: { kind: 'attempt', attemptId: 'attempt:other' } }),
		/Attempt binding/u
	);
	assert.deepStrictEqual(ports.log, []);
});

test('a one-use admission policy never authorizes active Attempt operations', async () => {
	const policy = validateEffectiveExamSecurityPolicy({
		...policyFixture(),
		scope: { kind: 'admission', admissionScopeId: 'admission:one' }
	});
	const selection = resolveExamSecurityNativeSelection(policy, matrixFixture());
	const harness = new PortsHarness();
	const coordinator = createExamSecurityCoordinator({
		binding: {
			attemptId: 'attempt:one',
			sessionId: 'session:one',
			connectionId: 'connection:one',
			participationGeneration: 7,
			securitySessionId: 'security:one'
		},
		authoritative: authoritative({ attemptState: 'ready' }),
		policy,
		selection,
		ports: harness.ports
	});
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	const projection = coordinator.observe().current;
	assert.strictEqual(projection.canJoin, true);
	assert.deepStrictEqual(
		[
			projection.canWorkspaceMutate,
			projection.canUseBrowser,
			projection.canUseTerminal,
			projection.canSubmit
		],
		[false, false, false, false]
	);
	assert.throws(
		() =>
			coordinator.updateAuthoritativeState(
				authoritative({ attemptRevision: 2, authoritativeTimeUnixMs: 3_000 })
			),
		/admission policy/u
	);
	assert.strictEqual(coordinator.observe().current.attemptState, 'ready');
	coordinator.dispose();
});

test('clean complete preflight verifies closed effects before publishing and opens gates only when active', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	assert.deepStrictEqual(harness.log.slice(0, 5), [
		'deny:policy',
		`effects:${selection.closedEffects.join(',')}`,
		'publish:checking',
		'publish:compliant',
		'allow:7'
	]);
	assert.equal(coordinator.observe().current.canWorkspaceMutate, true);
	assert.equal(coordinator.observe().current.canUseBrowser, true);
	assert.equal(coordinator.observe().current.canUseTerminal, true);
	coordinator.dispose();
});

test('high-confidence checking gates synchronously and creates no occurrence before deterministic confirmation', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	harness.log.length = 0;
	coordinator.signalHighConfidence('processApplication');
	assert.deepStrictEqual(harness.log, ['deny:processApplication', 'publish:checking']);
	assert.deepStrictEqual(harness.records, []);
	coordinator.dispose();
});

test('a high-confidence signal invalidates an older queued clean reconciliation', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	let releaseProtection = () => {};
	harness.protectionBarrier = new Promise<void>((resolve) => {
		releaseProtection = resolve;
	});
	const containment = coordinator.failClosed('sourceCoverage');
	const staleClean = coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	coordinator.signalHighConfidence('display');
	releaseProtection();
	await Promise.all([containment, staleClean]);
	assert.strictEqual(harness.log.includes('allow:7'), false);
	assert.notStrictEqual(coordinator.observe().current.posture, 'compliant');
	coordinator.dispose();
});

test('reconciliation input is validated and deeply frozen before queued security work', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	let releaseProtection = () => {};
	harness.protectionBarrier = new Promise<void>((resolve) => {
		releaseProtection = resolve;
	});
	const containment = coordinator.failClosed('sourceCoverage');
	await Promise.resolve();
	await Promise.resolve();
	const range = {
		source: 'process-application' as const,
		sourceInstanceId: 'process-application:instance:00000001',
		firstSequence: 1,
		lastSequence: 1
	};
	const finding = {
		conditionId: 'condition:process:frozen',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: [range]
	};
	const input = cleanReconciliation(selection.selectedSources, { findings: [finding] });
	const queued = coordinator.reconcile(input);
	finding.conditionId = 'condition:mutated';
	range.sourceInstanceId = 'process-application:instance:99999999';
	(input.sources[0] as { sequence: number }).sequence = 999;
	releaseProtection();
	await Promise.all([containment, queued]);
	assert.strictEqual(harness.records.at(-1)?.conditionId, 'condition:process:frozen');
	assert.strictEqual(
		harness.records.at(-1)?.sourceRanges[0]?.sourceInstanceId,
		'process-application:instance:00000001'
	);
	coordinator.dispose();
});

test('authoritative loss and stop deny candidate gates before stalled serial work completes', async () => {
	const authoritativeUpdate = coordinatorHarness();
	await authoritativeUpdate.coordinator.start();
	await authoritativeUpdate.coordinator.reconcile(
		cleanReconciliation(authoritativeUpdate.selection.selectedSources)
	);
	let releaseUpdateProtection = () => {};
	authoritativeUpdate.harness.protectionBarrier = new Promise<void>((resolve) => {
		releaseUpdateProtection = resolve;
	});
	const blockedUpdate = authoritativeUpdate.coordinator.failClosed('sourceCoverage');
	await Promise.resolve();
	await Promise.resolve();
	authoritativeUpdate.harness.log.length = 0;
	const update = authoritativeUpdate.coordinator.updateAuthoritativeState(
		authoritative({ attemptRevision: 2, paused: true, authoritativeTimeUnixMs: 3_000 })
	);
	assert.deepStrictEqual(authoritativeUpdate.harness.log, ['deny:pause']);
	releaseUpdateProtection();
	await Promise.all([blockedUpdate, update]);
	authoritativeUpdate.coordinator.dispose();
	const stopping = coordinatorHarness();
	await stopping.coordinator.start();
	await stopping.coordinator.reconcile(cleanReconciliation(stopping.selection.selectedSources));
	let releaseStopProtection = () => {};
	stopping.harness.protectionBarrier = new Promise<void>((resolve) => {
		releaseStopProtection = resolve;
	});
	const blockedStop = stopping.coordinator.failClosed('sourceCoverage');
	await Promise.resolve();
	await Promise.resolve();
	stopping.harness.log.length = 0;
	const stop = stopping.coordinator.stop();
	assert.deepStrictEqual(stopping.harness.log, ['deny:policy']);
	releaseStopProtection();
	await Promise.all([blockedStop, stop]);
	stopping.coordinator.dispose();
});

test('superseded authoritative updates never publish against a newer shared state', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	let releaseProtection = () => {};
	harness.protectionBarrier = new Promise<void>((resolve) => {
		releaseProtection = resolve;
	});
	const blocked = coordinator.failClosed('sourceCoverage');
	await Promise.resolve();
	await Promise.resolve();
	harness.log.length = 0;
	const paused = coordinator.updateAuthoritativeState(
		authoritative({ attemptRevision: 2, paused: true, authoritativeTimeUnixMs: 3_000 })
	);
	const resumed = coordinator.updateAuthoritativeState(
		authoritative({ attemptRevision: 3, authoritativeTimeUnixMs: 4_000 })
	);
	const duplicate = coordinator.updateAuthoritativeState(
		authoritative({ attemptRevision: 3, authoritativeTimeUnixMs: 4_000 })
	);
	assert.deepStrictEqual(harness.log, ['deny:pause', 'deny:policy']);
	releaseProtection();
	await Promise.all([blocked, paused, resumed, duplicate]);
	assert.equal(coordinator.observe().current.attemptRevision, 3);
	assert.equal(coordinator.observe().current.paused, false);
	assert.equal(coordinator.observe().current.posture, 'checking');
	assert.equal(harness.log.filter((value) => value === 'publish:compliant').length, 0);
	coordinator.dispose();
});

test('authoritative time cannot roll back under a higher Attempt revision', async () => {
	const { coordinator } = coordinatorHarness();
	await coordinator.start();
	await coordinator.updateAuthoritativeState(
		authoritative({ attemptRevision: 2, authoritativeTimeUnixMs: 3_000 })
	);
	assert.throws(
		() =>
			coordinator.updateAuthoritativeState(
				authoritative({ attemptRevision: 3, authoritativeTimeUnixMs: 2_999 })
			),
		/time cannot move backward/u
	);
	assert.strictEqual(coordinator.observe().current.attemptRevision, 2);
	assert.strictEqual(coordinator.observe().current.authoritativeTimeUnixMs, 3_000);
	coordinator.dispose();
});

test('confirmed enforced condition follows containment order and recovery closes the same minimized occurrence', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	harness.log.length = 0;
	const finding = {
		conditionId: 'condition:process:blocked',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: [
			{
				source: 'process-application' as const,
				sourceInstanceId: 'process-application:instance:00000001',
				firstSequence: 1,
				lastSequence: 1
			}
		]
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [finding] })
	);
	assert.deepStrictEqual(harness.log, [
		'deny:processApplication',
		'cancel',
		'protect',
		`effects:${selection.closedEffects.join(',')}`,
		'publish:contained',
		'delivery:opened'
	]);
	assert.equal(coordinator.observe().current.canWorkspaceMutate, false);
	assert.equal(harness.records[0]?.occurrenceId, 'occurrence:1');
	harness.log.length = 0;
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: selection.selectedSources.map((source) => ({
				...coverage(source),
				sequence: 2
			})),
			findings: [
				{
					...finding,
					status: 'clear',
					sourceRanges: [
						{ ...finding.sourceRanges[0], firstSequence: 2, lastSequence: 2 }
					]
				}
			]
		})
	);
	assert.deepStrictEqual(harness.log, ['publish:compliant', 'allow:7', 'delivery:recovered']);
	assert.equal(harness.records[1]?.occurrenceId, 'occurrence:1');
	coordinator.dispose();
});

test('each new containment episode checkpoints work accepted after the preceding recovery', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	const finding = {
		conditionId: 'condition:process:repeat-containment',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: []
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [finding] })
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: coverageAt(selection.selectedSources, 2),
			findings: [{ ...finding, status: 'clear' }]
		})
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: coverageAt(selection.selectedSources, 3),
			findings: [finding]
		})
	);
	assert.strictEqual(harness.log.filter((value) => value === 'protect').length, 2);
	coordinator.dispose();
});

test('identical detector callbacks coalesce without incrementing or redelivering an occurrence', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	const finding = {
		conditionId: 'condition:process:coalesced',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: []
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [finding] })
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [finding] })
	);
	assert.deepStrictEqual(
		harness.records.map((record) => [record.status, record.repeatCount]),
		[['opened', 1]]
	);
	coordinator.dispose();
});

test('a condition identity cannot be reassigned while active or after it clears', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	const processFinding = {
		conditionId: 'condition:stable-identity',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: []
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [processFinding] })
	);
	const reassigned = { ...processFinding, capabilityId: 'clipboard', reason: 'policy' as const };
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, { findings: [reassigned] })
		),
		/identity cannot be reassigned/u
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: coverageAt(selection.selectedSources, 2),
			findings: [{ ...processFinding, status: 'clear' }]
		})
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				sources: coverageAt(selection.selectedSources, 3),
				findings: [reassigned]
			})
		),
		/identity cannot be reassigned/u
	);
	assert.deepStrictEqual(
		harness.records.map((record) => [record.status, record.capabilityId]),
		[
			['opened', 'process_application'],
			['recovered', 'process_application']
		]
	);
	coordinator.dispose();
});

test('a complete reconciliation clears omitted prior conditions and closes their occurrence', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	harness.log.length = 0;
	const finding = {
		conditionId: 'condition:process:omitted',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: [
			{
				source: 'process-application' as const,
				sourceInstanceId: 'process-application:instance:00000001',
				firstSequence: 1,
				lastSequence: 1
			}
		]
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [finding] })
	);
	harness.log.length = 0;
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: selection.selectedSources.map((source) => ({
				...coverage(source),
				sequence: 2
			}))
		})
	);
	assert.deepStrictEqual(harness.log, ['publish:compliant', 'allow:7', 'delivery:recovered']);
	assert.strictEqual(coordinator.observe().current.activeSecurityConditions.length, 0);
	assert.strictEqual(harness.records.at(-1)?.occurrenceId, 'occurrence:1');
	coordinator.dispose();
});

test('failed integrity delivery remains fail-closed and retries retained occurrence records', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	harness.log.length = 0;
	harness.deliverySucceeds = false;
	const finding = {
		conditionId: 'condition:process:delivery',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: []
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [finding] })
	);
	assert.strictEqual(coordinator.observe().current.posture, 'failed');
	assert.deepStrictEqual(harness.records, []);
	harness.deliverySucceeds = true;
	harness.log.length = 0;
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: coverageAt(selection.selectedSources, 2),
			findings: [{ ...finding, status: 'clear' }]
		})
	);
	assert.strictEqual(coordinator.observe().current.posture, 'compliant');
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened', 'recovered']
	);
	coordinator.dispose();
});

test('containment failure retains an opened occurrence before any awaited effect', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	harness.protectionSucceeds = false;
	const finding = {
		conditionId: 'condition:process:protection',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: []
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [finding] })
	);
	assert.strictEqual(coordinator.observe().current.posture, 'failed');
	assert.deepStrictEqual(harness.records, []);
	harness.protectionSucceeds = true;
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: coverageAt(selection.selectedSources, 2),
			findings: [{ ...finding, status: 'clear' }]
		})
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened', 'recovered']
	);
	coordinator.dispose();
});

test('observe-only condition degrades without containment while enforced source gaps fail closed', async () => {
	const first = coordinatorHarness();
	await first.coordinator.start();
	await first.coordinator.reconcile(cleanReconciliation(first.selection.selectedSources));
	first.harness.log.length = 0;
	await first.coordinator.reconcile(
		cleanReconciliation(first.selection.selectedSources, {
			findings: [
				{
					conditionId: 'condition:storage:seen',
					capabilityId: 'removable_storage',
					mode: 'observe',
					status: 'present',
					reason: 'removableStorage',
					certainty: 'complete',
					gaps: 0,
					sourceRanges: []
				}
			]
		})
	);
	assert.deepStrictEqual(first.harness.log, ['publish:degraded', 'allow:7', 'delivery:opened']);
	first.coordinator.dispose();
	const second = coordinatorHarness();
	await second.coordinator.start();
	const sources = second.selection.selectedSources.map((source) =>
		source === 'display-topology' ? { ...coverage(source), gapCount: 1 } : coverage(source)
	);
	await second.coordinator.reconcile(
		cleanReconciliation(second.selection.selectedSources, { sources })
	);
	assert.equal(second.coordinator.observe().current.posture, 'failed');
	assert.equal(second.coordinator.observe().current.safeReason, 'sourceCoverage');
	second.coordinator.dispose();
});

test('pause and transport continuity remain independent authoritative gates and require fresh reconciliation', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	harness.log.length = 0;
	await coordinator.updateAuthoritativeState(
		authoritative({ attemptRevision: 2, paused: true, authoritativeTimeUnixMs: 3_000 })
	);
	assert.equal(coordinator.observe().current.paused, true);
	assert.equal(coordinator.observe().current.posture, 'compliant');
	assert.equal(coordinator.observe().current.canUseTerminal, false);
	assert.ok(harness.log.indexOf('deny:pause') < harness.log.indexOf('publish:compliant'));
	await coordinator.updateAuthoritativeState(
		authoritative({ attemptRevision: 3, authoritativeTimeUnixMs: 4_000 })
	);
	assert.equal(coordinator.observe().current.posture, 'checking');
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	assert.equal(coordinator.observe().current.canWorkspaceMutate, true);
	await coordinator.updateAuthoritativeState(
		authoritative({
			attemptRevision: 4,
			leasePhase: 'reconnecting',
			authoritativeTimeUnixMs: 5_000
		})
	);
	assert.equal(coordinator.observe().current.safeReason, 'connection');
	assert.equal(coordinator.observe().current.canUseBrowser, false);
	coordinator.dispose();
});

test('live correction acknowledgement is exact and gates only affected mutations', async () => {
	const { coordinator, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	const correction = {
		correctionId: 'correction:browser-policy',
		revision: 3,
		reason: 'policy' as const,
		requiresAcknowledgement: true,
		acknowledged: false,
		affectedCapabilities: ['workspace', 'submission'] as const
	};
	await coordinator.updateAuthoritativeState(
		authoritative({
			attemptRevision: 2,
			activeCorrections: [correction],
			authoritativeTimeUnixMs: 3_000
		})
	);
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	const gated = validateCandidateSecurityProjection(coordinator.observe().current);
	assert.equal(gated.canWorkspaceMutate, false);
	assert.equal(gated.canSubmit, false);
	assert.equal(gated.canUseBrowser, true);
	assert.equal(gated.canUseTerminal, true);
	assert.deepStrictEqual(gated.activeCorrections, [
		{
			correctionId: correction.correctionId,
			revision: correction.revision,
			reason: correction.reason,
			state: 'acknowledgementRequired',
			affectedCapabilities: ['workspace', 'submission']
		}
	]);
	const acknowledgement = {
		kind: 'security.acknowledgeCorrection' as const,
		projectionRevision: gated.revision,
		correctionId: correction.correctionId,
		correctionRevision: correction.revision
	};
	assert.deepStrictEqual(
		validateCandidateSecurityIntentForProjection(acknowledgement, gated),
		acknowledgement
	);
	assert.throws(
		() =>
			validateCandidateSecurityIntentForProjection(
				{ ...acknowledgement, correctionRevision: correction.revision + 1 },
				gated
			),
		/stale/u
	);
	assert.throws(
		() =>
			validateCandidateSecurityIntent({
				kind: 'security.acknowledgeCorrection',
				projectionRevision: gated.revision,
				correctionId: correction.correctionId
			}),
		/invalid/u
	);
	await coordinator.updateAuthoritativeState(
		authoritative({
			attemptRevision: 3,
			activeCorrections: [{ ...correction, acknowledged: true }],
			authoritativeTimeUnixMs: 4_000
		})
	);
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	assert.equal(coordinator.observe().current.canWorkspaceMutate, true);
	assert.equal(coordinator.observe().current.canSubmit, true);
	coordinator.dispose();
});

test('normal departure seals delivery before releasing effects while abnormal loss never releases them', async () => {
	const normal = coordinatorHarness();
	await normal.coordinator.start();
	await normal.coordinator.reconcile(cleanReconciliation(normal.selection.selectedSources));
	normal.harness.log.length = 0;
	await normal.coordinator.stop();
	assert.deepStrictEqual(normal.harness.log, [
		'deny:policy',
		'cancel',
		'protect',
		'sources:stop',
		'delivery:seal',
		'effects:release',
		'publish:stopped'
	]);
	normal.coordinator.dispose();
	const abnormal = coordinatorHarness();
	await abnormal.coordinator.start();
	abnormal.harness.log.length = 0;
	await abnormal.coordinator.failClosed('sourceCoverage');
	assert.equal(abnormal.coordinator.observe().current.posture, 'failed');
	assert.equal(abnormal.harness.log.includes('effects:release'), false);
	abnormal.coordinator.dispose();
});

test('normal departure reports failure and retries only unfinished shutdown phases', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	harness.log.length = 0;
	harness.sealSucceeds = false;
	await assert.rejects(coordinator.stop(), /seal unavailable/u);
	assert.strictEqual(coordinator.observe().current.posture, 'failed');
	assert.strictEqual(harness.log.includes('effects:release'), false);
	harness.sealSucceeds = true;
	harness.releaseSucceeds = false;
	await assert.rejects(coordinator.stop(), /release unavailable/u);
	harness.releaseSucceeds = true;
	await coordinator.stop();
	assert.deepStrictEqual(
		harness.log.filter((value) => value === 'cancel'),
		['cancel']
	);
	assert.deepStrictEqual(
		harness.log.filter((value) => value === 'protect'),
		['protect']
	);
	assert.deepStrictEqual(
		harness.log.filter((value) => value === 'sources:stop'),
		['sources:stop']
	);
	assert.strictEqual(harness.log.filter((value) => value === 'delivery:seal').length, 2);
	assert.strictEqual(harness.log.filter((value) => value === 'effects:release').length, 2);
	assert.strictEqual(coordinator.observe().current.posture, 'stopped');
	coordinator.dispose();
});

test('stop is terminal and later observations cannot republish or reopen candidate gates', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	await coordinator.stop();
	harness.log.length = 0;
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	await coordinator.updateAuthoritativeState(
		authoritative({ attemptRevision: 2, authoritativeTimeUnixMs: 3_000 })
	);
	await coordinator.failClosed('connection');
	coordinator.signalHighConfidence('display');
	await coordinator.stop();
	assert.deepStrictEqual(harness.log, []);
	assert.equal(coordinator.observe().current.posture, 'stopped');
	coordinator.dispose();
});

test('disposal fences queued reconciliation before it can reopen candidate gates', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	let releaseProtection = () => {};
	harness.protectionBarrier = new Promise<void>((resolve) => {
		releaseProtection = resolve;
	});
	const containment = coordinator.failClosed('sourceCoverage');
	const queuedRecovery = coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	await Promise.resolve();
	await Promise.resolve();
	coordinator.dispose();
	const disposalDeny = harness.log.lastIndexOf('deny:policy');
	releaseProtection();
	await Promise.all([containment, queuedRecovery]);
	assert.deepStrictEqual(harness.log.slice(disposalDeny + 1), []);
});

test('disposal cannot turn a queued normal shutdown into a false success', async () => {
	const { coordinator, harness } = coordinatorHarness();
	await coordinator.start();
	let releaseProtection = () => {};
	harness.protectionBarrier = new Promise<void>((resolve) => {
		releaseProtection = resolve;
	});
	const containment = coordinator.failClosed('sourceCoverage');
	await Promise.resolve();
	await Promise.resolve();
	const stopping = coordinator.stop();
	coordinator.dispose();
	const disposalDeny = harness.log.lastIndexOf('deny:policy');
	releaseProtection();
	await containment;
	await assert.rejects(stopping, /disposed before shutdown completed/u);
	assert.deepStrictEqual(harness.log.slice(disposalDeny + 1), []);
});

test('candidate protocol rejects privileged fields and accepts only revision-fenced closed intents', () => {
	const { coordinator } = coordinatorHarness();
	const safe = validateCandidateSecurityProjection(coordinator.observe().current);
	assert.equal(safe.posture, 'uninitialized');
	assert.throws(
		() => validateCandidateSecurityProjection({ ...safe, policyDigest: 'secret' }),
		/invalid/u
	);
	assert.throws(
		() =>
			validateCandidateSecurityProjection({ ...safe, posture: new String('uninitialized') }),
		/invalid/u
	);
	assert.throws(
		() => validateCandidateSecurityProjection({ ...safe, canRetryChecks: true }),
		/inconsistent/u
	);
	const retry = { kind: 'security.retryChecks' as const, projectionRevision: safe.revision };
	assert.deepStrictEqual(validateCandidateSecurityIntent(retry), retry);
	assert.throws(
		() => validateCandidateSecurityIntentForProjection(retry, safe),
		/cannot be retried/u
	);
	const checking = validateCandidateSecurityProjection({
		...safe,
		posture: 'checking',
		canRetryChecks: true
	});
	assert.deepStrictEqual(
		validateCandidateSecurityIntentForProjection(
			{ ...retry, projectionRevision: checking.revision },
			checking
		),
		retry
	);
	assert.throws(
		() =>
			validateCandidateSecurityIntent({
				kind: 'security.retryChecks',
				projectionRevision: 2,
				attemptId: 'attempt:one'
			}),
		/invalid/u
	);
	coordinator.dispose();
});

test('reconciliation cannot invent a disabled or unknown capability', async () => {
	const { coordinator, selection } = coordinatorHarness();
	await coordinator.start();
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [
					{
						conditionId: 'condition:invented',
						capabilityId: 'external_capture',
						mode: 'enforce',
						status: 'present',
						reason: 'policy',
						certainty: 'complete',
						gaps: 0,
						sourceRanges: []
					}
				]
			})
		),
		/finding is invalid/u
	);
	coordinator.dispose();
});

test('reconciliation findings must exactly match the policy mode for baseline and admitted families', async () => {
	const { coordinator, selection } = coordinatorHarness();
	await coordinator.start();
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [
					{
						conditionId: 'condition:downgraded',
						capabilityId: 'process_application',
						mode: 'observe',
						status: 'present',
						reason: 'processApplication',
						certainty: 'complete',
						gaps: 0,
						sourceRanges: []
					}
				]
			})
		),
		/finding is invalid/u
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [
					{
						conditionId: 'condition:upgraded',
						capabilityId: 'interactive_session',
						mode: 'enforce',
						status: 'present',
						reason: 'interactiveSession',
						certainty: 'complete',
						gaps: 0,
						sourceRanges: []
					}
				]
			})
		),
		/finding is invalid/u
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [
					{
						conditionId: 'condition:baseline-downgraded',
						capabilityId: 'focus_loss',
						mode: 'observe',
						status: 'present',
						reason: 'candidateWindow',
						certainty: 'complete',
						gaps: 0,
						sourceRanges: []
					}
				]
			})
		),
		/finding is invalid/u
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [
					{
						conditionId: 'condition:wrong-reason',
						capabilityId: 'process_application',
						mode: 'enforce',
						status: 'present',
						reason: 'printing',
						certainty: 'complete',
						gaps: 0,
						sourceRanges: []
					}
				]
			})
		),
		/finding is invalid/u
	);
	coordinator.dispose();
});

test('finding source ranges are bounded by the exact reconciled source instance and sequence', async () => {
	const { coordinator, selection } = coordinatorHarness();
	await coordinator.start();
	const finding = {
		conditionId: 'condition:process:bounded-range',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: [
			{
				source: 'process-application' as const,
				sourceInstanceId: 'process-application:instance:00000001',
				firstSequence: 1,
				lastSequence: 1
			}
		]
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [finding] })
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [
					{
						...finding,
						sourceRanges: [
							{
								...finding.sourceRanges[0]!,
								sourceInstanceId: 'process-application:instance:00000002'
							}
						]
					}
				]
			})
		),
		/source range is invalid/u
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [
					{ ...finding, sourceRanges: [{ ...finding.sourceRanges[0]!, lastSequence: 2 }] }
				]
			})
		),
		/source range is invalid/u
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [
					{
						...finding,
						sourceRanges: [
							{
								source: 'display-topology',
								sourceInstanceId: 'display-topology:instance:00000001',
								firstSequence: 1,
								lastSequence: 1
							}
						]
					}
				]
			})
		),
		/source range is invalid/u
	);
	const withoutCoverage = cleanReconciliation(selection.selectedSources, {
		sources: selection.selectedSources
			.filter((source) => source !== 'process-application')
			.map(coverage),
		findings: [finding]
	});
	await assert.rejects(coordinator.reconcile(withoutCoverage), /finding is invalid/u);
	coordinator.dispose();
});

test('source-instance watermarks reject delayed sequence regressions and unproven resets', async () => {
	const { coordinator, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	const source = 'process-application' as const;
	const present = {
		conditionId: 'condition:process:watermark',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: [
			{
				source,
				sourceInstanceId: `${source}:instance:00000001`,
				firstSequence: 10,
				lastSequence: 10
			}
		]
	};
	const sequence = (value: number) =>
		selection.selectedSources.map((candidate) => ({ ...coverage(candidate), sequence: value }));
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: sequence(10),
			findings: [present]
		})
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, { sources: sequence(9) })
		),
		/sequence regressed/u
	);
	assert.strictEqual(coordinator.observe().current.posture, 'failed');
	assert.strictEqual(coordinator.observe().current.canUseTerminal, false);
	assert.strictEqual(
		coordinator
			.observe()
			.current.activeSecurityConditions.some(
				(condition) => condition.reason === 'processApplication'
			),
		true
	);
	const reset = sequence(11).map((candidate) =>
		candidate.source === source
			? { ...candidate, sourceInstanceId: `${source}:instance:00000002` }
			: candidate
	);
	await assert.rejects(
		coordinator.reconcile(cleanReconciliation(selection.selectedSources, { sources: reset })),
		/reset lacks explicit continuity/u
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { sources: sequence(11) })
	);
	assert.strictEqual(coordinator.observe().current.activeSecurityConditions.length, 0);
	coordinator.dispose();
});

test('an exact supervisor reset fences old findings until the replacement has one complete healthy snapshot', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	const source = 'process-application' as const;
	const oldInstance = `${source}:instance:00000001`;
	const newInstance = `${source}:instance:00000002`;
	const present = {
		conditionId: 'condition:process:supervised-reset',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: []
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [present] })
	);
	const replacement = coverageAt(selection.selectedSources, 2).map((candidate) =>
		candidate.source === source
			? {
					...candidate,
					sourceInstanceId: newInstance,
					sequence: 0,
					health: 'recovering' as const,
					complete: false
				}
			: candidate
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: replacement,
			sourceResets: [
				{
					kind: 'restarted',
					source,
					previousSourceInstanceId: oldInstance,
					previousSequence: 1,
					newSourceInstanceId: newInstance,
					attempt: 1
				}
			]
		})
	);
	assert.strictEqual(
		coordinator
			.observe()
			.current.activeSecurityConditions.some(
				(condition) => condition.reason === 'processApplication'
			),
		true
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened']
	);
	const replacementSnapshot = replacement.map((candidate) =>
		candidate.source === source
			? { ...candidate, health: 'healthy' as const, complete: true }
			: candidate
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { sources: replacementSnapshot })
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened', 'recovered']
	);
	const staleOldInstance = coverageAt(selection.selectedSources, 2).map((candidate) =>
		candidate.source === source ? { ...candidate, sourceInstanceId: oldInstance } : candidate
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, { sources: staleOldInstance })
		),
		/reset lacks explicit continuity/u
	);
	coordinator.dispose();
});

test('a source cannot consume a second automatic restart or reuse a retired instance identity', async () => {
	const { coordinator, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	const source = 'process-application' as const;
	const firstInstance = `${source}:instance:00000001`;
	const secondInstance = `${source}:instance:00000002`;
	const thirdInstance = `${source}:instance:00000003`;
	const replacement = coverageAt(selection.selectedSources, 2).map((candidate) =>
		candidate.source === source
			? { ...candidate, sourceInstanceId: secondInstance, sequence: 0 }
			: candidate
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: replacement,
			sourceResets: [
				{
					kind: 'restarted',
					source,
					previousSourceInstanceId: firstInstance,
					previousSequence: 1,
					newSourceInstanceId: secondInstance,
					attempt: 1
				}
			]
		})
	);
	const secondReplacement = coverageAt(selection.selectedSources, 3).map((candidate) =>
		candidate.source === source
			? { ...candidate, sourceInstanceId: thirdInstance, sequence: 0 }
			: candidate
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				sources: secondReplacement,
				sourceResets: [
					{
						kind: 'restarted',
						source,
						previousSourceInstanceId: secondInstance,
						previousSequence: 0,
						newSourceInstanceId: thirdInstance,
						attempt: 1
					}
				]
			})
		),
		/automatic restart was already consumed/u
	);
	const reusedInstance = coverageAt(selection.selectedSources, 3).map((candidate) =>
		candidate.source === source
			? { ...candidate, sourceInstanceId: firstInstance, sequence: 0 }
			: candidate
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				sources: reusedInstance,
				sourceResets: [
					{
						kind: 'restarted',
						source,
						previousSourceInstanceId: secondInstance,
						previousSequence: 0,
						newSourceInstanceId: firstInstance,
						attempt: 1
					}
				]
			})
		),
		/identity cannot be reused/u
	);
	coordinator.dispose();
});

test('a spoofed supervisor reset cannot replace the exact stored source watermark', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	const source = 'process-application' as const;
	const oldInstance = `${source}:instance:00000001`;
	const newInstance = `${source}:instance:00000002`;
	const present = {
		conditionId: 'condition:process:spoofed-reset',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: []
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [present] })
	);
	const replacement = coverageAt(selection.selectedSources, 2).map((candidate) =>
		candidate.source === source
			? { ...candidate, sourceInstanceId: newInstance, sequence: 0 }
			: candidate
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				sources: replacement,
				sourceResets: [
					{
						kind: 'restarted',
						source,
						previousSourceInstanceId: oldInstance,
						previousSequence: 1,
						newSourceInstanceId: newInstance,
						attempt: 2
					}
				]
			})
		),
		/source reset is invalid/u
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				sources: replacement,
				sourceResets: [
					{
						kind: 'restarted',
						source,
						previousSourceInstanceId: oldInstance,
						previousSequence: 0,
						newSourceInstanceId: newInstance,
						attempt: 1
					}
				]
			})
		),
		/exact supervisor continuity edge/u
	);
	assert.strictEqual(
		coordinator
			.observe()
			.current.activeSecurityConditions.some(
				(condition) => condition.reason === 'processApplication'
			),
		true
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened']
	);
	coordinator.dispose();
});

test('malformed reconciliation denies synchronously and serializes source-coverage containment', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	const rejected = coordinator.reconcile({
		...cleanReconciliation(selection.selectedSources),
		extra: true
	} as never);
	assert.strictEqual(harness.log.at(-1), 'deny:sourceCoverage');
	await assert.rejects(rejected, /invalid or stale/u);
	assert.strictEqual(coordinator.observe().current.canUseTerminal, false);
	assert.strictEqual(coordinator.observe().current.posture, 'failed');
	assert.strictEqual(harness.log.includes('protect'), true);
	coordinator.dispose();
});

test('incomplete or failed source coverage cannot synthesize false recovery evidence', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	const source = 'process-application' as const;
	const sequence = (value: number) =>
		selection.selectedSources.map((candidate) => ({ ...coverage(candidate), sequence: value }));
	const present = {
		conditionId: 'condition:process:coverage-recovery',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: [
			{
				source,
				sourceInstanceId: `${source}:instance:00000001`,
				firstSequence: 10,
				lastSequence: 10
			}
		]
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: sequence(10),
			findings: [present]
		})
	);
	const failed = sequence(11).map((candidate) =>
		candidate.source === source
			? { ...candidate, health: 'failed' as const, complete: false, gapCount: 1 }
			: candidate
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { sources: failed })
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened']
	);
	assert.strictEqual(
		coordinator
			.observe()
			.current.activeSecurityConditions.some(
				(condition) => condition.reason === 'processApplication'
			),
		true
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { sources: sequence(11) })
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened', 'recovered']
	);
	coordinator.dispose();
});

test('explicit clear evidence also requires healthy complete and fresh source coverage', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	const source = 'process-application' as const;
	const sequence = (value: number) =>
		selection.selectedSources.map((candidate) => ({ ...coverage(candidate), sequence: value }));
	const present = {
		conditionId: 'condition:process:explicit-recovery',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: [
			{
				source,
				sourceInstanceId: `${source}:instance:00000001`,
				firstSequence: 10,
				lastSequence: 10
			}
		]
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: sequence(10),
			findings: [present]
		})
	);
	const failed = sequence(11).map((candidate) =>
		candidate.source === source
			? { ...candidate, health: 'failed' as const, complete: false, gapCount: 1 }
			: candidate
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				sources: failed,
				findings: [{ ...present, status: 'clear' }]
			})
		),
		/recovery lacks healthy fresh source coverage/u
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened']
	);
	assert.strictEqual(
		coordinator
			.observe()
			.current.activeSecurityConditions.some(
				(condition) => condition.reason === 'processApplication'
			),
		true
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: sequence(11),
			findings: [{ ...present, status: 'clear' }]
		})
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened', 'recovered']
	);
	coordinator.dispose();
});

test('range-less findings still bind recovery to a later healthy observation from their registered source', async () => {
	const { coordinator, harness, selection } = coordinatorHarness();
	await coordinator.start();
	const present = {
		conditionId: 'condition:process:range-less-recovery',
		capabilityId: 'process_application',
		mode: 'enforce' as const,
		status: 'present' as const,
		reason: 'processApplication' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: []
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [present] })
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [{ ...present, status: 'clear' }]
			})
		),
		/recovery lacks healthy fresh source coverage/u
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened']
	);
	assert.strictEqual(
		coordinator
			.observe()
			.current.activeSecurityConditions.some(
				(condition) => condition.reason === 'processApplication'
			),
		true
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: coverageAt(selection.selectedSources, 2),
			findings: [{ ...present, status: 'clear' }]
		})
	);
	assert.deepStrictEqual(
		harness.records.map((record) => record.status),
		['opened', 'recovered']
	);
	coordinator.dispose();
});

test('throwing security observers cannot interrupt containment, recovery, or stop', async () => {
	const originalHandler = errorHandler.getUnexpectedErrorHandler();
	const observerErrors: unknown[] = [];
	setUnexpectedErrorHandler((error) => observerErrors.push(error));
	try {
		const { coordinator, harness, selection } = coordinatorHarness();
		coordinator.observe().onDidChange(() => {
			throw new Error('observer failed');
		});
		await coordinator.start();
		const finding = {
			conditionId: 'condition:process:observer',
			capabilityId: 'process_application',
			mode: 'enforce' as const,
			status: 'present' as const,
			reason: 'processApplication' as const,
			certainty: 'complete' as const,
			gaps: 0,
			sourceRanges: []
		};
		await coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, { findings: [finding] })
		);
		assert.strictEqual(coordinator.observe().current.posture, 'contained');
		await coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				sources: coverageAt(selection.selectedSources, 2),
				findings: [{ ...finding, status: 'clear' }]
			})
		);
		assert.strictEqual(coordinator.observe().current.posture, 'compliant');
		await coordinator.stop();
		assert.strictEqual(coordinator.observe().current.posture, 'stopped');
		assert.deepStrictEqual(
			harness.records.map((record) => record.status),
			['opened', 'recovered']
		);
		assert.strictEqual(observerErrors.length > 0, true);
		coordinator.dispose();
	} finally {
		setUnexpectedErrorHandler(originalHandler);
	}
});

test('privileged reconciliation and authority identities reject coercible non-strings and extra fields', async () => {
	const { coordinator, selection } = coordinatorHarness();
	await coordinator.start();
	const clean = cleanReconciliation(selection.selectedSources);
	const numericCoverage = {
		...clean,
		sources: clean.sources.map((source, index) =>
			index === 0 ? { ...source, sourceInstanceId: 1234567890123456 } : source
		)
	};
	await assert.rejects(coordinator.reconcile(numericCoverage as never), /coverage is invalid/u);
	assert.throws(
		() =>
			coordinator.updateAuthoritativeState(
				authoritative({
					attemptRevision: 2,
					activeCorrections: [
						{
							correctionId: 1234567890123456 as never,
							revision: 1,
							reason: 'policy',
							requiresAcknowledgement: true,
							acknowledged: false,
							affectedCapabilities: ['browser']
						}
					],
					authoritativeTimeUnixMs: 3_000
				})
			),
		/correction is invalid/u
	);
	assert.throws(
		() =>
			coordinator.updateAuthoritativeState({
				...authoritative({ attemptRevision: 2, authoritativeTimeUnixMs: 3_000 }),
				extra: true
			} as never),
		/state is invalid/u
	);
	coordinator.dispose();
});

test('focus-loss findings use the exact frozen focus policy mode without promotion', async () => {
	const policy = validateEffectiveExamSecurityPolicy({
		...policyFixture(),
		focusLossMode: 'observe'
	});
	const selection = resolveExamSecurityNativeSelection(policy, matrixFixture());
	const harness = new PortsHarness();
	const coordinator = createExamSecurityCoordinator({
		binding: {
			attemptId: 'attempt:one',
			sessionId: 'session:one',
			connectionId: 'connection:one',
			participationGeneration: 7,
			securitySessionId: 'security:one'
		},
		authoritative: authoritative(),
		policy,
		selection,
		ports: harness.ports
	});
	await coordinator.start();
	const finding = {
		conditionId: 'condition:focus:observed',
		capabilityId: 'focus_loss',
		mode: 'observe' as const,
		status: 'present' as const,
		reason: 'candidateWindow' as const,
		certainty: 'complete' as const,
		gaps: 0,
		sourceRanges: []
	};
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, { findings: [finding] })
	);
	assert.strictEqual(coordinator.observe().current.posture, 'degraded');
	assert.strictEqual(
		harness.log.some((value) => value === 'protect'),
		false
	);
	await assert.rejects(
		coordinator.reconcile(
			cleanReconciliation(selection.selectedSources, {
				findings: [{ ...finding, mode: 'enforce' }]
			})
		),
		/finding is invalid/u
	);
	coordinator.dispose();
});

void test('native preflight requires certified baseline claims independently of optional family policy', () => {
	const policy = policyFixture();
	const matrix = matrixFixture();
	for (const baseline of NATIVE_BASELINE_CAPABILITIES) {
		assert.throws(
			() =>
				resolveExamSecurityNativeSelection(policy, {
					...matrix,
					entries: matrix.entries.filter(
						(entry) => entry.coverage_key !== baseline.coverageKey
					)
				}),
			/mandatory/
		);
		assert.throws(
			() =>
				resolveExamSecurityNativeSelection(policy, {
					...matrix,
					entries: matrix.entries.map((entry) =>
						entry.coverage_key === baseline.coverageKey
							? { ...entry, claim: 'unavailable', verification: 'unavailable' }
							: entry
					)
				}),
			/mandatory/
		);
	}
});

test('live lease authority remains valid beyond 24 hours without inventing policy expiry', async () => {
	const { coordinator, selection } = coordinatorHarness();
	await coordinator.start();
	await coordinator.reconcile(cleanReconciliation(selection.selectedSources));
	await coordinator.updateAuthoritativeState(
		authoritative({ authoritativeTimeUnixMs: 32 * 24 * 60 * 60 * 1000, attemptRevision: 2 })
	);
	await coordinator.reconcile(
		cleanReconciliation(selection.selectedSources, {
			sources: coverageAt(selection.selectedSources, 2)
		})
	);
	assert.equal(coordinator.observe().current.canWorkspaceMutate, true);
	await coordinator.updateAuthoritativeState(
		authoritative({
			authoritativeTimeUnixMs: 32 * 24 * 60 * 60 * 1000 + 1,
			attemptRevision: 3,
			leasePhase: 'expired'
		})
	);
	assert.equal(coordinator.observe().current.canWorkspaceMutate, false);
	coordinator.dispose();
});
