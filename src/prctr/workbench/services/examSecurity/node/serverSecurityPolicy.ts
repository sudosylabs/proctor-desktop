/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import {
	resolveContract,
	validateApiValue,
	type ApiSchema
} from '../../../../platform/serverApi/node/apiContract.js';
import {
	canonicalContractDigest,
	parseStrictContractJson
} from '../../../../platform/serverApi/node/canonicalContract.js';
import type { NativeCapabilityMatrix } from '../../../../platform/native/common/nativeCapabilityRegistry.js';
import {
	resolveExamSecurityNativeSelection,
	validateEffectiveExamSecurityPolicy,
	type EffectiveExamSecurityPolicy,
	type EffectivePolicyScope,
	type ExamSecurityNativeSelection,
	type NativeFamilyPolicy
} from '../common/effectivePolicy.js';

type PolicyWire = components['schemas']['EffectiveExamSecurityPolicy'];
type ResponseWire = components['schemas']['SecurityPolicyResponse'];
type CatalogBinding = components['schemas']['SecurityCatalogBinding'];

/** Immutable catalog bytes must have been authenticated before this projection is constructed. */
export interface VerifiedSecurityCatalog {
	readonly binding: CatalogBinding;
	readonly entryIds: ReadonlySet<string>;
}
export interface SecurityPolicyExpectation {
	readonly institutionId: string;
	readonly examRevisionId: string;
	readonly sittingId: string;
	readonly scope: EffectivePolicyScope;
	/** Supplied by the packaged signature verifier, never selected by the response. */
	readonly matrix: NativeCapabilityMatrix;
	readonly matrixDigest: string;
	readonly catalogs: readonly VerifiedSecurityCatalog[];
}
export interface DecodedSecurityPolicy {
	readonly policy: EffectiveExamSecurityPolicy;
	readonly selection: ExamSecurityNativeSelection;
	readonly serverTimeUnixMs: number;
	readonly policyContentDigest: string;
	readonly preflightChallenge: ResponseWire['preflight_challenge'];
	readonly frozenAttemptConfiguration: ResponseWire['frozen_attempt_configuration'];
	readonly browserActivityDisclosure: ResponseWire['browser_activity_disclosure'];
	readonly catalogBindings: ResponseWire['catalog_bindings'];
}

/**
 * Privileged contract adapter, after authenticated same-origin API transport.
 * Digests establish consistency with packaged trust; they do not authenticate a
 * response or extend a Participation lease. No independent policy expiry exists.
 */
export function decodeServerSecurityPolicy(
	bytes: Uint8Array,
	expectation: SecurityPolicyExpectation
): DecodedSecurityPolicy {
	const value = parseStrictContractJson(bytes, {
		maxBytes: 128 * 1024,
		integerNumbersOnly: true
	});
	validateApiValue({ $ref: '#/components/schemas/SecurityPolicyResponse' }, value);
	const wire = value as ResponseWire;
	// The server's current prefixItems constrain order only. Apply the full
	// family schema too; JSON Schema items does not intersect prefixItems.
	const capabilitySchema = resolveContract<ApiSchema>({
		$ref: '#/components/schemas/EffectiveExamSecurityPolicy'
	}).properties?.capabilities?.items;
	if (capabilitySchema === undefined)
		throw new TypeError('Packaged native policy schema is unavailable');
	for (const family of wire.policy.capabilities) validateApiValue(capabilitySchema, family);
	const { digest, ...unsigned } = wire.policy;
	if (canonicalContractDigest(unsigned, 64 * 1024) !== digest) invalid('policy digest');
	const { scope: _scope, issued_at: _issued, active_from: _active, ...content } = unsigned;
	const bindings = wire.catalog_bindings;
	for (let index = 0; index < bindings.length; index++) {
		const binding = bindings[index]!;
		const previous = bindings[index - 1];
		if (
			previous !== undefined &&
			(previous.kind > binding.kind ||
				(previous.kind === binding.kind && previous.catalog_id >= binding.catalog_id))
		)
			invalid('catalog ordering');
		const trusted = expectation.catalogs.find(
			(catalog) =>
				catalog.binding.kind === binding.kind &&
				catalog.binding.catalog_id === binding.catalog_id
		);
		if (
			trusted === undefined ||
			trusted.binding.revision !== binding.revision ||
			trusted.binding.digest !== binding.digest
		)
			invalid('catalog trust');
	}
	if (
		wire.capability_matrix_digest !== expectation.matrixDigest ||
		canonicalContractDigest(
			{
				policy: content,
				catalog_bindings: bindings,
				capability_matrix_digest: wire.capability_matrix_digest
			},
			128 * 1024
		) !== wire.policy_content_digest
	)
		invalid('policy content digest');
	const policy = mapPolicy(wire.policy);
	if (
		policy.institutionId !== expectation.institutionId ||
		policy.examRevisionId !== expectation.examRevisionId ||
		policy.sittingId !== expectation.sittingId ||
		!sameScope(policy.scope, expectation.scope)
	)
		invalid('scope');
	verifyCatalogSelections(policy, bindings, expectation.catalogs);
	const serverTimeUnixMs = instant(wire.server_time);
	const challengeIssued = instant(wire.preflight_challenge.issued_at);
	const challengeExpires = instant(wire.preflight_challenge.expires_at);
	if (
		policy.activeFromUnixMs > serverTimeUnixMs ||
		challengeIssued > serverTimeUnixMs ||
		challengeExpires <= serverTimeUnixMs ||
		challengeExpires - challengeIssued > 120_000
	)
		invalid('preflight time');
	return freeze({
		policy,
		selection: resolveExamSecurityNativeSelection(policy, expectation.matrix),
		serverTimeUnixMs,
		policyContentDigest: wire.policy_content_digest,
		preflightChallenge: wire.preflight_challenge,
		frozenAttemptConfiguration: wire.frozen_attempt_configuration,
		browserActivityDisclosure: wire.browser_activity_disclosure,
		catalogBindings: bindings
	});
}

function mapPolicy(wire: PolicyWire): EffectiveExamSecurityPolicy {
	return validateEffectiveExamSecurityPolicy({
		schemaVersion: 1,
		policyId: wire.policy_id,
		revision: wire.revision,
		ordinal: wire.ordinal,
		digest: wire.digest,
		institutionId: wire.institution_id,
		examRevisionId: wire.exam_revision_id,
		sittingId: wire.sitting_id,
		scope:
			wire.scope.kind === 'attempt'
				? { kind: 'attempt', attemptId: wire.scope.attempt_id }
				: { kind: 'admission', admissionScopeId: wire.scope.admission_scope_id },
		issuedAtUnixMs: instant(wire.issued_at),
		activeFromUnixMs: instant(wire.active_from),
		applicationReleaseId: wire.application_release_id,
		matrixId: wire.matrix_id,
		targetTuple: wire.target_tuple,
		registryDigest: wire.registry_digest,
		focusLossMode: wire.focus_loss_mode,
		connectionLossMode: wire.connection_loss_mode,
		resolvedExceptionRefs: wire.resolved_exception_refs,
		evidenceClassId: wire.evidence_class_id,
		visibilityClassId: wire.visibility_class_id,
		retentionClassId: wire.retention_class_id,
		capabilities: wire.capabilities.map(mapFamily)
	});
}
function mapFamily(wire: PolicyWire['capabilities'][number]): NativeFamilyPolicy {
	switch (wire.id) {
		case 'process_application':
			return {
				id: wire.id,
				mode: wire.mode,
				allowedApplicationIds: wire.allowed_application_ids
			};
		case 'interactive_session':
			return wire;
		case 'clipboard':
			return {
				id: wire.id,
				mode: wire.mode,
				strategy: wire.strategy,
				observeOsClipboardChanges: wire.observe_os_clipboard_changes
			};
		case 'printing':
			return {
				id: wire.id,
				mode: wire.mode,
				candidatePrintCommands: wire.candidate_print_commands,
				monitoredSpooler: wire.monitored_spooler
			};
		case 'removable_storage':
			return {
				id: wire.id,
				mode: wire.mode,
				enabledSubCapabilities: wire.enabled_sub_capabilities,
				allowedStorageFunctionClassIds: wire.allowed_storage_function_class_ids
			};
		case 'virtualization':
			return wire;
		case 'network_configuration':
			return {
				id: wire.id,
				mode: wire.mode,
				enabledSubCapabilities: wire.enabled_sub_capabilities,
				allowedManagedProfileIds: wire.allowed_managed_profile_ids,
				allowedAdapterClassIds: wire.allowed_adapter_class_ids,
				allowedTunnelClassIds: wire.allowed_tunnel_class_ids
			};
		case 'camera':
		case 'microphone':
			return {
				id: wire.id,
				mode: wire.mode,
				requireReady: wire.require_ready,
				concurrentUseCheck: wire.concurrent_use_check
			};
		case 'external_capture':
			return wire;
	}
}
function verifyCatalogSelections(
	policy: EffectiveExamSecurityPolicy,
	bindings: readonly CatalogBinding[],
	catalogs: readonly VerifiedSecurityCatalog[]
): void {
	const requireIds = (kind: CatalogBinding['kind'], ids: readonly string[]): void => {
		const admitted = catalogs.filter((catalog) =>
			bindings.some(
				(binding) =>
					binding.kind === kind &&
					binding.kind === catalog.binding.kind &&
					binding.catalog_id === catalog.binding.catalog_id
			)
		);
		if (ids.some((id) => !admitted.some((catalog) => catalog.entryIds.has(id))))
			invalid('unresolved catalog entry');
	};
	for (const family of policy.capabilities) {
		switch (family.id) {
			case 'process_application':
				requireIds('application', family.allowedApplicationIds);
				break;
			case 'removable_storage':
				requireIds('storage_function', family.allowedStorageFunctionClassIds);
				break;
			case 'network_configuration':
				requireIds('managed_network_profile', family.allowedManagedProfileIds);
				requireIds('network_adapter_class', family.allowedAdapterClassIds);
				requireIds('tunnel_class', family.allowedTunnelClassIds);
				break;
		}
	}
}
function sameScope(left: EffectivePolicyScope, right: EffectivePolicyScope): boolean {
	return left.kind === 'attempt'
		? right.kind === 'attempt' && left.attemptId === right.attemptId
		: right.kind === 'admission' && left.admissionScopeId === right.admissionScopeId;
}
function instant(value: string): number {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value))
		invalid('timestamp precision');
	const parsed = Date.parse(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) invalid('timestamp');
	const canonical = value.includes('.')
		? value.replace(
				/\.(\d{1,3})Z$/u,
				(_all, fraction: string) => `.${fraction.padEnd(3, '0')}Z`
			)
		: value.replace('Z', '.000Z');
	if (new Date(parsed).toISOString() !== canonical) invalid('timestamp');
	return parsed;
}
function freeze<T>(value: T): T {
	if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function invalid(field: string): never {
	throw new TypeError(`Invalid server security policy ${field}`);
}
