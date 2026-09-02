/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	NATIVE_CAPABILITY_REGISTRY,
	NATIVE_CAPABILITY_REGISTRY_VERSION,
	type NativeCapabilityMatrix,
	type NativeCapabilityMode
} from '../../../../platform/native/common/nativeCapabilityRegistry.js';
import {
	NATIVE_SOURCE_MANIFEST,
	NATIVE_SOURCE_CATEGORY_ORDER,
	type NativeSourceCategory
} from '../../../../platform/native/common/nativeObservation.generated.js';
import type { NativeSourceId } from '../../../../platform/native/common/securityUtilityProtocol.js';

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_POLICY_LIFETIME_MS = 86_400_000;
const MAX_CATALOG_IDS = 256;

export type ProcessApplicationPolicy = {
	readonly id: 'process_application';
	readonly mode: NativeCapabilityMode;
	readonly allowedApplicationIds: readonly string[];
};
export type InteractiveSessionPolicy = {
	readonly id: 'interactive_session';
	readonly mode: NativeCapabilityMode;
};
export type ClipboardPolicy = {
	readonly id: 'clipboard';
	readonly mode: NativeCapabilityMode;
	readonly strategy: 'disabled' | 'private_attempt';
	readonly observeOsClipboardChanges: boolean;
};
export type PrintingPolicy = {
	readonly id: 'printing';
	readonly mode: NativeCapabilityMode;
	readonly candidatePrintCommands: 'deny' | 'not_applied';
	readonly monitoredSpooler: 'required' | 'not_required';
};
export type RemovableStoragePolicy = {
	readonly id: 'removable_storage';
	readonly mode: NativeCapabilityMode;
	readonly enabledSubCapabilities: readonly ('portable_mtp' | 'removable_block_storage')[];
	readonly allowedStorageFunctionClassIds: readonly string[];
};
export type VirtualizationPolicy = {
	readonly id: 'virtualization';
	readonly mode: NativeCapabilityMode;
	readonly rule:
		'block_recognized_guest' | 'not_applied' | 'require_certified_physical_environment';
};
export type NetworkConfigurationPolicy = {
	readonly id: 'network_configuration';
	readonly mode: NativeCapabilityMode;
	readonly enabledSubCapabilities: readonly (
		| 'network_source_health'
		| 'os_managed_vpn_state'
		| 'route_change'
		| 'system_proxy_state'
		| 'tunnel_interface_state'
	)[];
	readonly allowedManagedProfileIds: readonly string[];
	readonly allowedAdapterClassIds: readonly string[];
	readonly allowedTunnelClassIds: readonly string[];
};
export type MediaDevicePolicy = {
	readonly id: 'camera' | 'microphone';
	readonly mode: NativeCapabilityMode;
	readonly requireReady: boolean;
	readonly concurrentUseCheck: 'not_required' | 'supported_required';
};
export type ExternalCapturePolicy = { readonly id: 'external_capture'; readonly mode: 'disabled' };
export type NativeFamilyPolicy =
	| ProcessApplicationPolicy
	| InteractiveSessionPolicy
	| ClipboardPolicy
	| PrintingPolicy
	| RemovableStoragePolicy
	| VirtualizationPolicy
	| NetworkConfigurationPolicy
	| MediaDevicePolicy
	| ExternalCapturePolicy;

export type EffectivePolicyScope =
	| { readonly kind: 'attempt'; readonly attemptId: string }
	| { readonly kind: 'admission'; readonly admissionScopeId: string };
export interface EffectiveExamSecurityPolicy {
	readonly schemaVersion: 1;
	readonly policyId: string;
	readonly revision: string;
	readonly ordinal: number;
	readonly digest: string;
	readonly institutionId: string;
	readonly examRevisionId: string;
	readonly sittingId: string;
	readonly scope: EffectivePolicyScope;
	readonly issuedAtUnixMs: number;
	readonly activeFromUnixMs: number;
	readonly expiresAtUnixMs: number;
	readonly applicationReleaseId: string;
	readonly matrixId: string;
	readonly targetTuple: string;
	readonly registryVersion: number;
	readonly focusLossMode: NativeCapabilityMode;
	readonly connectionLossMode: 'enforce';
	readonly resolvedExceptionRefs: readonly string[];
	readonly evidenceClassId: string;
	readonly visibilityClassId: string;
	readonly retentionClassId: string;
	readonly capabilities: readonly NativeFamilyPolicy[];
}

export interface ExamSecurityNativeSelection {
	readonly selectedSources: readonly NativeSourceId[];
	readonly selectedSourceCategories: readonly NativeSourceCategory[];
	readonly requiredCoverageKeys: readonly string[];
	readonly enforcedSourceIds: readonly NativeSourceId[];
	readonly observeSourceIds: readonly NativeSourceId[];
	readonly closedEffects: readonly (
		| 'candidate_content_protection'
		| 'candidate_private_clipboard'
		| 'candidate_print_command_denial'
	)[];
}

export function validateEffectiveExamSecurityPolicy(value: unknown): EffectiveExamSecurityPolicy {
	if (
		!isRecord(value) ||
		!hasOnly(value, [
			'schemaVersion',
			'policyId',
			'revision',
			'ordinal',
			'digest',
			'institutionId',
			'examRevisionId',
			'sittingId',
			'scope',
			'issuedAtUnixMs',
			'activeFromUnixMs',
			'expiresAtUnixMs',
			'applicationReleaseId',
			'matrixId',
			'targetTuple',
			'registryVersion',
			'focusLossMode',
			'connectionLossMode',
			'resolvedExceptionRefs',
			'evidenceClassId',
			'visibilityClassId',
			'retentionClassId',
			'capabilities'
		])
	)
		throw new TypeError('Effective Exam Security Policy envelope is invalid');
	if (
		value.schemaVersion !== 1 ||
		!identifiers(value, [
			'policyId',
			'revision',
			'institutionId',
			'examRevisionId',
			'sittingId',
			'applicationReleaseId',
			'matrixId',
			'targetTuple',
			'evidenceClassId',
			'visibilityClassId',
			'retentionClassId'
		]) ||
		typeof value.digest !== 'string' ||
		!DIGEST.test(value.digest)
	)
		throw new TypeError('Effective Exam Security Policy identity is invalid');
	if (
		!integer(value.ordinal, 1) ||
		value.registryVersion !== NATIVE_CAPABILITY_REGISTRY_VERSION ||
		!integer(value.issuedAtUnixMs, 0) ||
		!integer(value.activeFromUnixMs, 0) ||
		!integer(value.expiresAtUnixMs, 1) ||
		value.issuedAtUnixMs > value.activeFromUnixMs ||
		value.activeFromUnixMs >= value.expiresAtUnixMs ||
		value.expiresAtUnixMs - value.activeFromUnixMs > MAX_POLICY_LIFETIME_MS
	)
		throw new TypeError('Effective Exam Security Policy bounds are invalid');
	if (!isMode(value.focusLossMode) || value.connectionLossMode !== 'enforce')
		throw new TypeError('Effective Exam Security Policy connectivity modes are invalid');
	const scope = validateScope(value.scope);
	const resolvedExceptionRefs = identifierArray(
		value.resolvedExceptionRefs,
		32,
		'resolved exception'
	);
	if (
		!Array.isArray(value.capabilities) ||
		value.capabilities.length !== NATIVE_CAPABILITY_REGISTRY.length
	)
		throw new TypeError('Effective Exam Security Policy must declare every native family');
	const capabilities = value.capabilities.map((candidate, index) =>
		validateFamilyPolicy(candidate, NATIVE_CAPABILITY_REGISTRY[index]?.id)
	);
	return deepFreeze({
		...(value as unknown as EffectiveExamSecurityPolicy),
		scope,
		resolvedExceptionRefs,
		capabilities
	});
}

export function resolveExamSecurityNativeSelection(
	policy: EffectiveExamSecurityPolicy,
	matrix: NativeCapabilityMatrix
): ExamSecurityNativeSelection {
	if (
		matrix.registry_version !== policy.registryVersion ||
		matrix.matrix_id !== policy.matrixId ||
		matrix.release_id !== policy.applicationReleaseId ||
		matrix.target_tuple !== policy.targetTuple
	)
		throw new TypeError('Capability matrix does not match the effective policy');
	const coverage = new Map(matrix.entries.map((entry) => [entry.coverage_key, entry]));
	const sources = new Set<NativeSourceId>([
		'display-topology',
		'candidate-window',
		'capture-session'
	]);
	const enforcedSources = new Set<NativeSourceId>([
		'display-topology',
		'candidate-window',
		'capture-session'
	]);
	const observedSources = new Set<NativeSourceId>();
	const categories = new Set<NativeSourceCategory>();
	const requiredCoverage = new Set<string>();
	const effects = new Set<ExamSecurityNativeSelection['closedEffects'][number]>([
		'candidate_content_protection'
	]);
	for (const familyPolicy of policy.capabilities) {
		const descriptor = NATIVE_CAPABILITY_REGISTRY.find(
			(candidate) => candidate.id === familyPolicy.id
		);
		if (descriptor === undefined)
			throw new TypeError(`Unknown native family ${familyPolicy.id}`);
		if (familyPolicy.mode === 'disabled') continue;
		const required = requiredClaims(familyPolicy);
		for (const item of required) {
			const sub = descriptor.subCapabilities.find((candidate) => candidate.id === item.id);
			if (sub === undefined)
				throw new TypeError(`Unknown native sub-capability ${familyPolicy.id}.${item.id}`);
			const entry = coverage.get(sub.coverageKey);
			if (
				entry === undefined ||
				entry.verification !== 'passed' ||
				(item.claim === 'enforce'
					? entry.claim !== 'enforce'
					: entry.claim === 'unavailable')
			)
				throw new TypeError(
					`Capability matrix cannot satisfy ${familyPolicy.id}.${item.id} as ${item.claim}`
				);
			requiredCoverage.add(sub.coverageKey);
		}
		const sourceClaims = required.filter((item) => item.sourceBacked);
		if (descriptor.sourceId !== undefined && sourceClaims.length > 0) {
			const source = descriptor.sourceId as NativeSourceId;
			sources.add(source);
			if (sourceClaims.some((item) => item.claim === 'enforce')) enforcedSources.add(source);
			else observedSources.add(source);
		}
		if (familyPolicy.id === 'clipboard') {
			if (familyPolicy.observeOsClipboardChanges) categories.add('os-clipboard-change');
			if (familyPolicy.strategy === 'private_attempt')
				effects.add('candidate_private_clipboard');
		} else if (familyPolicy.id === 'printing' && familyPolicy.candidatePrintCommands === 'deny')
			effects.add('candidate_print_command_denial');
		else if (familyPolicy.id === 'removable_storage')
			for (const id of familyPolicy.enabledSubCapabilities)
				categories.add(id === 'portable_mtp' ? 'portable-mtp' : 'removable-block-storage');
		else if (familyPolicy.id === 'network_configuration')
			for (const id of familyPolicy.enabledSubCapabilities)
				categories.add(id.replaceAll('_', '-') as NativeSourceCategory);
		else if (familyPolicy.id === 'camera' && sourceClaims.length > 0) categories.add('camera');
		else if (familyPolicy.id === 'microphone' && sourceClaims.length > 0)
			categories.add('microphone');
	}
	for (const source of enforcedSources) observedSources.delete(source);
	const sourceOrder = NATIVE_SOURCE_MANIFEST.map((entry) => entry.source_id as NativeSourceId);
	const categoryOrder = [...NATIVE_SOURCE_CATEGORY_ORDER];
	return deepFreeze({
		selectedSources: sourceOrder.filter((source) => sources.has(source)),
		selectedSourceCategories: categoryOrder.filter((category) => categories.has(category)),
		requiredCoverageKeys: [...requiredCoverage].sort(),
		enforcedSourceIds: sourceOrder.filter((source) => enforcedSources.has(source)),
		observeSourceIds: sourceOrder.filter((source) => observedSources.has(source)),
		closedEffects: [...effects].sort()
	});
}

function requiredClaims(policy: NativeFamilyPolicy): readonly {
	readonly id: string;
	readonly claim: 'enforce' | 'observe';
	readonly sourceBacked: boolean;
}[] {
	const claim: 'enforce' | 'observe' = policy.mode === 'enforce' ? 'enforce' : 'observe';
	switch (policy.id) {
		case 'process_application':
			return [{ id: 'process_application_lifecycle', claim, sourceBacked: true }];
		case 'interactive_session':
			return [{ id: 'single_interactive_session', claim, sourceBacked: true }];
		case 'clipboard':
			return [
				...(policy.strategy === 'private_attempt'
					? [
							{
								id: 'candidate_private_clipboard',
								claim: 'enforce' as const,
								sourceBacked: false
							}
						]
					: []),
				...(policy.observeOsClipboardChanges
					? [{ id: 'os_clipboard_change', claim: 'observe' as const, sourceBacked: true }]
					: [])
			];
		case 'printing':
			return [
				...(policy.candidatePrintCommands === 'deny'
					? [
							{
								id: 'candidate_print_commands',
								claim: 'enforce' as const,
								sourceBacked: false
							}
						]
					: []),
				...(policy.monitoredSpooler === 'required'
					? [{ id: 'monitored_spooler_job', claim, sourceBacked: true }]
					: [])
			];
		case 'removable_storage':
			return policy.enabledSubCapabilities.map((id) => ({ id, claim, sourceBacked: true }));
		case 'virtualization':
			return [
				{
					id:
						policy.rule === 'require_certified_physical_environment'
							? 'certified_physical_environment'
							: 'recognized_guest',
					claim,
					sourceBacked: true
				}
			];
		case 'network_configuration':
			return policy.enabledSubCapabilities.map((id) => ({
				id,
				claim: id === 'route_change' ? ('observe' as const) : claim,
				sourceBacked: true
			}));
		case 'camera':
			return [
				...(policy.requireReady ? [{ id: 'camera_ready', claim, sourceBacked: true }] : []),
				...(policy.concurrentUseCheck === 'supported_required'
					? [{ id: 'camera_other_application_use', claim, sourceBacked: true }]
					: [])
			];
		case 'microphone':
			return [
				...(policy.requireReady
					? [{ id: 'microphone_ready', claim, sourceBacked: true }]
					: []),
				...(policy.concurrentUseCheck === 'supported_required'
					? [{ id: 'microphone_other_stream_running', claim, sourceBacked: true }]
					: [])
			];
		case 'external_capture':
			return [];
	}
}

function validateFamilyPolicy(value: unknown, expectedId: string | undefined): NativeFamilyPolicy {
	if (!isRecord(value) || value.id !== expectedId || !isMode(value.mode))
		throw new TypeError(`Native family policy ${expectedId ?? 'unknown'} is invalid`);
	const id = value.id as NativeFamilyPolicy['id'];
	switch (id) {
		case 'process_application':
			exact(value, ['id', 'mode', 'allowedApplicationIds']);
			return deepFreeze({
				id,
				mode: value.mode,
				allowedApplicationIds: identifierArray(
					value.allowedApplicationIds,
					MAX_CATALOG_IDS,
					id
				)
			});
		case 'interactive_session':
			exact(value, ['id', 'mode']);
			return deepFreeze({ id, mode: value.mode });
		case 'clipboard':
			exact(value, ['id', 'mode', 'strategy', 'observeOsClipboardChanges']);
			if (
				!isOneOf(value.strategy, ['disabled', 'private_attempt'] as const) ||
				typeof value.observeOsClipboardChanges !== 'boolean' ||
				(value.mode === 'disabled' &&
					(value.strategy !== 'disabled' || value.observeOsClipboardChanges)) ||
				(value.mode === 'observe' &&
					(value.strategy !== 'disabled' || !value.observeOsClipboardChanges)) ||
				(value.mode === 'enforce' && value.strategy !== 'private_attempt')
			)
				invalid(id);
			return deepFreeze({
				id,
				mode: value.mode,
				strategy: value.strategy,
				observeOsClipboardChanges: value.observeOsClipboardChanges
			} as ClipboardPolicy);
		case 'printing':
			exact(value, ['id', 'mode', 'candidatePrintCommands', 'monitoredSpooler']);
			if (
				!isOneOf(value.candidatePrintCommands, ['deny', 'not_applied'] as const) ||
				!isOneOf(value.monitoredSpooler, ['required', 'not_required'] as const) ||
				(value.mode === 'disabled' &&
					(value.candidatePrintCommands !== 'not_applied' ||
						value.monitoredSpooler !== 'not_required')) ||
				(value.mode === 'observe' &&
					(value.candidatePrintCommands !== 'not_applied' ||
						value.monitoredSpooler !== 'required')) ||
				(value.mode === 'enforce' && value.candidatePrintCommands !== 'deny')
			)
				invalid(id);
			return deepFreeze({
				id,
				mode: value.mode,
				candidatePrintCommands: value.candidatePrintCommands,
				monitoredSpooler: value.monitoredSpooler
			} as PrintingPolicy);
		case 'removable_storage':
			exact(value, [
				'id',
				'mode',
				'enabledSubCapabilities',
				'allowedStorageFunctionClassIds'
			]);
			{
				const enabled = enumArray(
					value.enabledSubCapabilities,
					['removable_block_storage', 'portable_mtp'] as const,
					2,
					id
				);
				const allowed = identifierArray(
					value.allowedStorageFunctionClassIds,
					MAX_CATALOG_IDS,
					id
				);
				if (
					(value.mode === 'disabled') !== (enabled.length === 0) ||
					(value.mode === 'disabled' && allowed.length !== 0)
				)
					invalid(id);
				return deepFreeze({
					id,
					mode: value.mode,
					enabledSubCapabilities: enabled,
					allowedStorageFunctionClassIds: allowed
				});
			}
		case 'virtualization':
			exact(value, ['id', 'mode', 'rule']);
			if (
				!isOneOf(value.rule, [
					'block_recognized_guest',
					'require_certified_physical_environment',
					'not_applied'
				] as const) ||
				(value.mode === 'disabled') !== (value.rule === 'not_applied')
			)
				invalid(id);
			return deepFreeze({ id, mode: value.mode, rule: value.rule } as VirtualizationPolicy);
		case 'network_configuration':
			exact(value, [
				'id',
				'mode',
				'enabledSubCapabilities',
				'allowedManagedProfileIds',
				'allowedAdapterClassIds',
				'allowedTunnelClassIds'
			]);
			{
				const enabled = enumArray(
					value.enabledSubCapabilities,
					[
						'system_proxy_state',
						'os_managed_vpn_state',
						'tunnel_interface_state',
						'route_change',
						'network_source_health'
					] as const,
					5,
					id
				);
				const managed = identifierArray(
					value.allowedManagedProfileIds,
					MAX_CATALOG_IDS,
					id
				);
				const adapters = identifierArray(value.allowedAdapterClassIds, MAX_CATALOG_IDS, id);
				const tunnels = identifierArray(value.allowedTunnelClassIds, MAX_CATALOG_IDS, id);
				if (
					(value.mode === 'disabled') !== (enabled.length === 0) ||
					(value.mode === 'disabled' &&
						managed.length + adapters.length + tunnels.length !== 0)
				)
					invalid(id);
				return deepFreeze({
					id,
					mode: value.mode,
					enabledSubCapabilities: enabled,
					allowedManagedProfileIds: managed,
					allowedAdapterClassIds: adapters,
					allowedTunnelClassIds: tunnels
				});
			}
		case 'camera':
		case 'microphone':
			exact(value, ['id', 'mode', 'requireReady', 'concurrentUseCheck']);
			if (
				typeof value.requireReady !== 'boolean' ||
				!isOneOf(value.concurrentUseCheck, [
					'not_required',
					'supported_required'
				] as const) ||
				(value.mode === 'disabled' &&
					(value.requireReady || value.concurrentUseCheck !== 'not_required'))
			)
				invalid(id);
			return deepFreeze({
				id,
				mode: value.mode,
				requireReady: value.requireReady,
				concurrentUseCheck: value.concurrentUseCheck
			} as MediaDevicePolicy);
		case 'external_capture':
			exact(value, ['id', 'mode']);
			if (value.mode !== 'disabled') invalid(id);
			return deepFreeze({ id, mode: 'disabled' });
	}
}

function validateScope(value: unknown): EffectivePolicyScope {
	if (
		isRecord(value) &&
		value.kind === 'attempt' &&
		hasOnly(value, ['kind', 'attemptId']) &&
		typeof value.attemptId === 'string' &&
		IDENTIFIER.test(value.attemptId)
	)
		return deepFreeze({ kind: 'attempt', attemptId: value.attemptId });
	if (
		isRecord(value) &&
		value.kind === 'admission' &&
		hasOnly(value, ['kind', 'admissionScopeId']) &&
		typeof value.admissionScopeId === 'string' &&
		IDENTIFIER.test(value.admissionScopeId)
	)
		return deepFreeze({ kind: 'admission', admissionScopeId: value.admissionScopeId });
	throw new TypeError('Effective Exam Security Policy scope is invalid');
}
function isMode(value: unknown): value is NativeCapabilityMode {
	return value === 'disabled' || value === 'observe' || value === 'enforce';
}
function isOneOf<const T extends readonly string[]>(
	value: unknown,
	choices: T
): value is T[number] {
	return typeof value === 'string' && choices.includes(value as T[number]);
}
function identifiers(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return keys.every((key) => typeof value[key] === 'string' && IDENTIFIER.test(value[key]));
}
function identifierArray(value: unknown, maximum: number, label: string): readonly string[] {
	if (
		!Array.isArray(value) ||
		value.length > maximum ||
		value.some((item) => typeof item !== 'string' || !IDENTIFIER.test(item)) ||
		new Set(value).size !== value.length
	)
		throw new TypeError(`${label} identifiers are invalid`);
	return Object.freeze([...value]);
}
function enumArray<const T extends readonly string[]>(
	value: unknown,
	choices: T,
	maximum: number,
	label: string
): readonly T[number][] {
	if (
		!Array.isArray(value) ||
		value.length > maximum ||
		value.some((item) => typeof item !== 'string' || !choices.includes(item)) ||
		new Set(value).size !== value.length
	)
		throw new TypeError(`${label} selection is invalid`);
	return Object.freeze([...value] as T[number][]);
}
function integer(value: unknown, minimum: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
	if (!hasOnly(value, keys))
		throw new TypeError(`Native family policy ${String(value.id)} contains unknown fields`);
}
function invalid(id: string): never {
	throw new TypeError(`Native family policy ${id} is contradictory`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return (
		Object.keys(value).length === keys.length &&
		Object.keys(value).every((key) => keys.includes(key))
	);
}
function deepFreeze<T>(value: T): T {
	if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
	return Object.freeze(value);
}
