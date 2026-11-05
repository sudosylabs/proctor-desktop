import {
	NATIVE_BASELINE_CAPABILITIES_DATA,
	NATIVE_CAPABILITY_REGISTRY_DATA,
	NATIVE_CAPABILITY_REGISTRY_DIGEST,
	NATIVE_CAPABILITY_REGISTRY_VERSION
} from './nativeCapabilityRegistry.generated.js';

export { NATIVE_CAPABILITY_REGISTRY_VERSION, NATIVE_CAPABILITY_REGISTRY_DIGEST };

export type NativeCapabilityMode = 'disabled' | 'observe' | 'enforce';
export type NativeCapabilityClaim = 'observe' | 'enforce' | 'unavailable';
export type NativePermissionKind =
	'none' | 'accessibility' | 'full_disk_access' | 'endpoint_security' | 'camera' | 'microphone';
export type NativeClosedEffect =
	| 'candidate_interaction_gate'
	| 'candidate_private_clipboard'
	| 'candidate_print_command_denial'
	| 'candidate_content_protection';

export type NativeSubCapabilityDescriptor = {
	readonly id: string;
	readonly sourceSchemaDigest: string;
	readonly coverageKey: string;
	readonly permittedClaims: readonly NativeCapabilityClaim[];
	readonly platformCoverageKeys: Readonly<Record<'windows' | 'macos' | 'linux', string>>;
};

export type NativeCapabilityDescriptor = {
	readonly id: string;
	readonly sourceId?: string;
	readonly modes: readonly NativeCapabilityMode[];
	readonly factSchema?: string;
	readonly configurationSchema: string;
	readonly permissions: Readonly<
		Record<'windows' | 'macos' | 'linux', readonly Exclude<NativePermissionKind, 'none'>[]>
	>;
	readonly effects: readonly NativeClosedEffect[];
	readonly privacy: 'mechanical_state_no_content';
	readonly subCapabilities: readonly NativeSubCapabilityDescriptor[];
};

export const NATIVE_CAPABILITY_REGISTRY =
	NATIVE_CAPABILITY_REGISTRY_DATA satisfies readonly NativeCapabilityDescriptor[];

export type NativeBaselineCapabilityDescriptor = NativeSubCapabilityDescriptor & {
	readonly sourceId?: string;
	readonly permissions: NativeCapabilityDescriptor['permissions'];
};

export const NATIVE_BASELINE_CAPABILITIES =
	NATIVE_BASELINE_CAPABILITIES_DATA satisfies readonly NativeBaselineCapabilityDescriptor[];

const registryById = new Map<string, NativeCapabilityDescriptor>(
	NATIVE_CAPABILITY_REGISTRY.map((descriptor) => [descriptor.id, descriptor])
);
const subCapabilityByCoverageKey = new Map<string, NativeSubCapabilityDescriptor>();
for (const descriptor of NATIVE_BASELINE_CAPABILITIES) {
	subCapabilityByCoverageKey.set(descriptor.coverageKey, descriptor);
}
for (const descriptor of NATIVE_CAPABILITY_REGISTRY) {
	for (const subCapabilityDescriptor of descriptor.subCapabilities) {
		if (subCapabilityByCoverageKey.has(subCapabilityDescriptor.coverageKey)) {
			throw new Error(`duplicate native coverage key ${subCapabilityDescriptor.coverageKey}`);
		}
		subCapabilityByCoverageKey.set(
			subCapabilityDescriptor.coverageKey,
			subCapabilityDescriptor
		);
	}
}

export function getNativeCapability(id: string): NativeCapabilityDescriptor | undefined {
	return registryById.get(id);
}

export function getNativeSubCapabilityByCoverageKey(
	coverageKey: string
): NativeSubCapabilityDescriptor | undefined {
	return subCapabilityByCoverageKey.get(coverageKey);
}

export function nativeCoverageKeys(): readonly string[] {
	return [...subCapabilityByCoverageKey.keys()];
}

export const MAX_NATIVE_CAPABILITY_MATRIX_BYTES = 65_536;
const MAX_SIGNATURE_LENGTH = 4_096;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u;

export type NativeCapabilityMatrixEntry = {
	readonly coverage_key: string;
	readonly source_schema_digest: string;
	readonly claim: NativeCapabilityClaim;
	readonly component_id: string;
	readonly adapter_version: string;
	readonly helper_build_id?: string;
	readonly required_permissions: readonly Exclude<NativePermissionKind, 'none'>[];
	readonly limitations: readonly string[];
	readonly verification: 'passed' | 'unavailable';
};

export type NativeCapabilityMatrix = {
	readonly registry_digest: string;
	readonly matrix_id: string;
	readonly release_id: string;
	readonly target_tuple: string;
	readonly entries: readonly NativeCapabilityMatrixEntry[];
};

export type SignedNativeCapabilityMatrix = {
	readonly payload: string;
	readonly signature: string;
	readonly key_id: string;
};

export type NativeCapabilityMatrixExpectation = {
	readonly releaseId: string;
	readonly targetTuple: string;
	readonly runtimeIdentities: readonly NativeCapabilityRuntimeIdentity[];
};

export type NativeCapabilityRuntimeIdentity = Pick<
	NativeCapabilityMatrixEntry,
	'coverage_key' | 'component_id' | 'adapter_version' | 'helper_build_id'
>;

export type NativeCapabilityMatrixSignatureVerifier = (
	payload: string,
	signature: string,
	keyId: string
) => boolean;

export type NativeCapabilityMatrixErrorCode =
	| 'matrix_envelope_invalid'
	| 'matrix_signature_invalid'
	| 'matrix_payload_invalid'
	| 'matrix_identity_mismatch';

export class NativeCapabilityMatrixError extends Error {
	readonly code: NativeCapabilityMatrixErrorCode;

	constructor(code: NativeCapabilityMatrixErrorCode, options?: ErrorOptions) {
		super(code, options);
		this.name = 'NativeCapabilityMatrixError';
		this.code = code;
	}
}

/** Verifies exact signed bytes before accepting any packaged coverage claim. */
export function verifyNativeCapabilityMatrix(
	envelope: SignedNativeCapabilityMatrix,
	expectation: NativeCapabilityMatrixExpectation,
	verifySignature: NativeCapabilityMatrixSignatureVerifier
): NativeCapabilityMatrix {
	if (!isSignedEnvelope(envelope)) {
		throw new NativeCapabilityMatrixError('matrix_envelope_invalid');
	}
	if (!verifySignature(envelope.payload, envelope.signature, envelope.key_id)) {
		throw new NativeCapabilityMatrixError('matrix_signature_invalid');
	}

	let decoded: unknown;
	try {
		decoded = JSON.parse(envelope.payload);
	} catch (error) {
		throw new NativeCapabilityMatrixError('matrix_payload_invalid', { cause: error });
	}
	if (!isNativeCapabilityMatrix(decoded)) {
		throw new NativeCapabilityMatrixError('matrix_payload_invalid');
	}
	if (
		decoded.release_id !== expectation.releaseId ||
		decoded.target_tuple !== expectation.targetTuple
	) {
		throw new NativeCapabilityMatrixError('matrix_identity_mismatch');
	}
	const runtimeIdentities = new Map(
		expectation.runtimeIdentities.map((identity) => [identity.coverage_key, identity])
	);
	if (
		runtimeIdentities.size !== nativeCoverageKeys().length ||
		expectation.runtimeIdentities.length !== runtimeIdentities.size ||
		!decoded.entries.every((entry) =>
			runtimeIdentityMatches(entry, runtimeIdentities.get(entry.coverage_key))
		)
	) {
		throw new NativeCapabilityMatrixError('matrix_identity_mismatch');
	}
	return deepFreeze(decoded);
}

export function isNativeCapabilityMatrix(value: unknown): value is NativeCapabilityMatrix {
	if (
		!isObject(value) ||
		!hasOnlyKeys(value, [
			'registry_digest',
			'matrix_id',
			'release_id',
			'target_tuple',
			'entries'
		]) ||
		value.registry_digest !== NATIVE_CAPABILITY_REGISTRY_DIGEST ||
		!isIdentifier(value.matrix_id) ||
		!isIdentifier(value.release_id) ||
		!isIdentifier(value.target_tuple) ||
		!Array.isArray(value.entries) ||
		value.entries.length !== nativeCoverageKeys().length
	)
		return false;

	const coverageKeys = new Set<string>();
	let previousCoverageKey = '';
	for (const candidate of value.entries) {
		if (
			!isMatrixEntry(candidate, targetPlatform(value.target_tuple)) ||
			coverageKeys.has(candidate.coverage_key) ||
			candidate.coverage_key <= previousCoverageKey
		)
			return false;
		const descriptor = getNativeSubCapabilityByCoverageKey(candidate.coverage_key);
		if (
			descriptor === undefined ||
			descriptor.sourceSchemaDigest !== candidate.source_schema_digest ||
			!descriptor.permittedClaims.includes(candidate.claim)
		)
			return false;
		coverageKeys.add(candidate.coverage_key);
		previousCoverageKey = candidate.coverage_key;
	}
	return nativeCoverageKeys().every((key) => coverageKeys.has(key));
}

function isSignedEnvelope(value: unknown): value is SignedNativeCapabilityMatrix {
	return (
		isObject(value) &&
		hasOnlyKeys(value, ['payload', 'signature', 'key_id']) &&
		typeof value.payload === 'string' &&
		boundedUtf8ByteLength(value.payload, MAX_NATIVE_CAPABILITY_MATRIX_BYTES) <=
			MAX_NATIVE_CAPABILITY_MATRIX_BYTES &&
		typeof value.signature === 'string' &&
		value.signature.length >= 1 &&
		value.signature.length <= MAX_SIGNATURE_LENGTH &&
		isIdentifier(value.key_id)
	);
}

function isMatrixEntry(
	value: unknown,
	platform: 'windows' | 'macos' | 'linux' | undefined
): value is NativeCapabilityMatrixEntry {
	return (
		isObject(value) &&
		platform !== undefined &&
		hasOnlyKeys(value, [
			'coverage_key',
			'source_schema_digest',
			'claim',
			'component_id',
			'adapter_version',
			...(Object.hasOwn(value, 'helper_build_id') ? ['helper_build_id'] : []),
			'required_permissions',
			'limitations',
			'verification'
		]) &&
		typeof value.coverage_key === 'string' &&
		getNativeSubCapabilityByCoverageKey(value.coverage_key) !== undefined &&
		typeof value.source_schema_digest === 'string' &&
		/^sha256:[a-f0-9]{64}$/u.test(value.source_schema_digest) &&
		(value.claim === 'observe' || value.claim === 'enforce' || value.claim === 'unavailable') &&
		isIdentifier(value.component_id) &&
		isIdentifier(value.adapter_version) &&
		(!Object.hasOwn(value, 'helper_build_id') || isIdentifier(value.helper_build_id)) &&
		isRequiredPermissions(value.required_permissions, value.coverage_key, platform) &&
		isBoundedIdentifierArray(value.limitations, 16) &&
		(value.verification === 'passed' || value.verification === 'unavailable') &&
		(value.claim === 'unavailable'
			? value.verification === 'unavailable'
			: value.verification === 'passed')
	);
}

function isRequiredPermissions(
	value: unknown,
	coverageKey: string,
	platform: 'windows' | 'macos' | 'linux'
): value is readonly Exclude<NativePermissionKind, 'none'>[] {
	if (!Array.isArray(value) || value.length > 8) return false;
	const capability =
		NATIVE_BASELINE_CAPABILITIES.find((entry) => entry.coverageKey === coverageKey) ??
		capabilityForCoverageKey(coverageKey);
	if (capability === undefined) return false;
	const expected = capability.permissions[platform];
	if (value.length !== expected.length) return false;
	return value.every((candidate, index) => candidate === expected[index]);
}

function capabilityForCoverageKey(coverageKey: string): NativeCapabilityDescriptor | undefined {
	return NATIVE_CAPABILITY_REGISTRY.find((capability) =>
		capability.subCapabilities.some(
			(subCapability) => subCapability.coverageKey === coverageKey
		)
	);
}

function isBoundedIdentifierArray(value: unknown, maximum: number): value is readonly string[] {
	return (
		Array.isArray(value) &&
		value.length <= maximum &&
		new Set(value).size === value.length &&
		value.every(isIdentifier)
	);
}

function runtimeIdentityMatches(
	matrix: NativeCapabilityMatrixEntry,
	runtime: NativeCapabilityRuntimeIdentity | undefined
): boolean {
	return (
		runtime !== undefined &&
		runtime.coverage_key === matrix.coverage_key &&
		runtime.component_id === matrix.component_id &&
		runtime.adapter_version === matrix.adapter_version &&
		runtime.helper_build_id === matrix.helper_build_id
	);
}

function targetPlatform(value: string): 'windows' | 'macos' | 'linux' | undefined {
	if (value.startsWith('windows-')) return 'windows';
	if (value.startsWith('macos-')) return 'macos';
	if (value.startsWith('linux-')) return 'linux';
	return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const ownKeys = Object.keys(value);
	return ownKeys.length === keys.length && ownKeys.every((key) => keys.includes(key));
}

function isIdentifier(value: unknown): value is string {
	return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function boundedUtf8ByteLength(value: string, maximum: number): number {
	let length = 0;
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0xfffd;
		length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
		if (length > maximum) return maximum + 1;
	}
	return length;
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}
