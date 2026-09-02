import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Repository } from '../checks/types.ts';
import type { Generator } from './registry.ts';

const AUTHORITY = 'native/schemas/native-capability-registry.json';
const POLICY_AUTHORITY = 'native/schemas/native-capability-policy.schema.json';
const JAVASCRIPT_OUTPUT = 'src/prctr/platform/native/common/nativeCapabilityRegistry.generated.js';
const TYPESCRIPT_OUTPUT = 'src/prctr/platform/native/common/nativeCapabilityRegistry.generated.ts';

type RegistryAuthority = {
	readonly registry_version: number;
	readonly family_modes: Readonly<Record<string, unknown>>;
	readonly families: readonly Record<string, unknown>[];
};

type PolicyAuthority = {
	readonly $defs?: Readonly<Record<string, unknown>>;
};

export const nativeCapabilityRegistryGenerator: Generator = {
	id: 'native-capability.registry',
	inputs: [AUTHORITY, POLICY_AUTHORITY],
	committedOutputs: [JAVASCRIPT_OUTPUT, TYPESCRIPT_OUTPUT],
	buildOutputs: [],
	generate(repository: Repository, outputRoot: string): void {
		const authority = JSON.parse(repository.read(AUTHORITY)) as RegistryAuthority;
		const policy = JSON.parse(repository.read(POLICY_AUTHORITY)) as PolicyAuthority;
		if (
			!Number.isSafeInteger(authority.registry_version) ||
			authority.registry_version < 1 ||
			typeof authority.family_modes !== 'object' ||
			authority.family_modes === null ||
			!Array.isArray(authority.families) ||
			authority.families.length === 0
		) {
			throw new Error(`${AUTHORITY} is not a bounded capability registry`);
		}
		const familyIds = new Set<string>();
		const outputFamilies = authority.families.map((raw) =>
			normalizeFamily(raw, familyIds, authority.family_modes, policy.$defs ?? {})
		);
		if (
			Object.keys(authority.family_modes).length !== familyIds.size ||
			Object.keys(authority.family_modes).some((id) => !familyIds.has(id))
		) {
			throw new Error(`${AUTHORITY} family mode authority does not match its families`);
		}
		const header = `// @${'generated'} by native-capability.registry from ${AUTHORITY} and ${POLICY_AUTHORITY}.`;
		const serializedFamilies = JSON.stringify(outputFamilies, null, 2);
		const javascript = [
			header,
			'',
			'function deepFreeze(value) {',
			"  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {",
			'    for (const nested of Object.values(value)) deepFreeze(nested);',
			'    Object.freeze(value);',
			'  }',
			'  return value;',
			'}',
			'',
			`export const NATIVE_CAPABILITY_REGISTRY_VERSION = ${authority.registry_version};`,
			`export const NATIVE_CAPABILITY_REGISTRY_DATA = deepFreeze(${serializedFamilies});`,
			''
		].join('\n');
		write(outputRoot, JAVASCRIPT_OUTPUT, javascript);
		const typescript = [
			header,
			'',
			'function deepFreeze<const T>(value: T): T {',
			"  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {",
			'    for (const nested of Object.values(value)) deepFreeze(nested);',
			'    Object.freeze(value);',
			'  }',
			'  return value;',
			'}',
			'',
			`export const NATIVE_CAPABILITY_REGISTRY_VERSION = ${authority.registry_version} as const;`,
			`export const NATIVE_CAPABILITY_REGISTRY_DATA = deepFreeze(${serializedFamilies} as const);`,
			''
		].join('\n');
		write(outputRoot, TYPESCRIPT_OUTPUT, typescript);
	}
};

function write(outputRoot: string, output: string, content: string): void {
	const path = join(outputRoot, output);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function normalizeFamily(
	raw: Record<string, unknown>,
	familyIds: Set<string>,
	familyModes: Readonly<Record<string, unknown>>,
	policyDefinitions: Readonly<Record<string, unknown>>
): object {
	const id = requiredIdentifier(raw.id, 'family id');
	if (familyIds.has(id)) throw new Error(`${AUTHORITY} duplicates family ${id}`);
	familyIds.add(id);
	const sourceId = requiredIdentifier(raw.source_id, `${id} source`);
	const factSchema = requiredPath(raw.fact_schema, `${id} fact schema`);
	const configurationSchema = requiredPath(
		raw.configuration_schema,
		`${id} configuration schema`
	);
	const modes = requiredModes(familyModes[id], id);
	const policyModes = modesFromPolicy(configurationSchema, policyDefinitions);
	if (
		modes.length !== policyModes.length ||
		!modes.every((mode, index) => policyModes[index] === mode)
	) {
		throw new Error(`${AUTHORITY} modes disagree with ${configurationSchema}`);
	}
	const permissions = requiredPlatformPermissions(raw.permissions, id);
	const effects = requiredStringArray(raw.effects, `${id} effects`, 8);
	if (
		!Array.isArray(raw.sub_capabilities) ||
		raw.sub_capabilities.length === 0 ||
		raw.sub_capabilities.length > 16
	) {
		throw new Error(`${AUTHORITY} has invalid sub-capabilities for ${id}`);
	}
	const subIds = new Set<string>();
	const subCapabilities = raw.sub_capabilities.map((candidate) => {
		if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
			throw new Error(`${AUTHORITY} has invalid sub-capability for ${id}`);
		}
		const sub = candidate as Record<string, unknown>;
		const subId = requiredIdentifier(sub.id, `${id} sub-capability`);
		if (subIds.has(subId)) throw new Error(`${AUTHORITY} duplicates sub-capability ${subId}`);
		subIds.add(subId);
		const claims = requiredStringArray(sub.claims, `${subId} claims`, 2);
		if (!claims.every((claim) => claim === 'observe' || claim === 'enforce')) {
			throw new Error(`${AUTHORITY} has invalid claims for ${subId}`);
		}
		const coverageKey = `native.${subId}.v1`;
		return {
			id: subId,
			schemaVersion: 1,
			coverageKey,
			permittedClaims: [...claims, 'unavailable'],
			platformCoverageKeys: {
				windows: coverageKey,
				macos: coverageKey,
				linux: coverageKey
			}
		};
	});
	validatePolicySubCapabilities(configurationSchema, policyDefinitions, subIds);
	return {
		id,
		sourceId,
		modes,
		factSchema,
		configurationSchema,
		permissions,
		effects,
		privacy: 'mechanical_state_no_content',
		subCapabilities
	};
}

function validatePolicySubCapabilities(
	configurationSchema: string,
	definitions: Readonly<Record<string, unknown>>,
	registrySubCapabilities: ReadonlySet<string>
): void {
	const prefix = `${POLICY_AUTHORITY}#/$defs/`;
	if (!configurationSchema.startsWith(prefix)) return;
	const definition = definitions[configurationSchema.slice(prefix.length)];
	if (!isRecord(definition) || !isRecord(definition.properties)) return;
	const selection = definition.properties.enabled_sub_capabilities;
	if (selection === undefined) return;
	if (
		!isRecord(selection) ||
		!isRecord(selection.items) ||
		!Array.isArray(selection.items.enum) ||
		!selection.items.enum.every((value) => typeof value === 'string')
	) {
		throw new Error(`${configurationSchema} has no closed sub-capability selection`);
	}
	const selected = new Set(selection.items.enum);
	if (
		selected.size !== registrySubCapabilities.size ||
		[...registrySubCapabilities].some((id) => !selected.has(id))
	) {
		throw new Error(`${configurationSchema} sub-capabilities disagree with ${AUTHORITY}`);
	}
}

function requiredPlatformPermissions(value: unknown, familyId: string): object {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== 3 ||
		!['windows', 'macos', 'linux'].every((platform) => Object.hasOwn(value, platform))
	) {
		throw new Error(`${AUTHORITY} has invalid platform permissions for ${familyId}`);
	}
	const allowed = new Set([
		'accessibility',
		'full_disk_access',
		'endpoint_security',
		'camera',
		'microphone'
	]);
	const output: Record<string, string[]> = {};
	for (const platform of ['windows', 'macos', 'linux']) {
		const permissions = requiredStringArray(
			value[platform],
			`${familyId} ${platform} permissions`,
			8
		);
		if (!permissions.every((permission) => allowed.has(permission))) {
			throw new Error(`${AUTHORITY} has invalid ${platform} permissions for ${familyId}`);
		}
		output[platform] = permissions;
	}
	return output;
}

function requiredModes(value: unknown, familyId: string): string[] {
	const canonical = ['disabled', 'observe', 'enforce'];
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > canonical.length ||
		!value.every((mode) => typeof mode === 'string' && canonical.includes(mode))
	) {
		throw new Error(`${AUTHORITY} has invalid modes for ${familyId}`);
	}
	const normalized = canonical.filter((mode) => value.includes(mode));
	if (
		normalized.length !== value.length ||
		!normalized.every((mode, index) => value[index] === mode)
	) {
		throw new Error(`${AUTHORITY} modes are not canonical for ${familyId}`);
	}
	return normalized;
}

function modesFromPolicy(
	configurationSchema: string,
	definitions: Readonly<Record<string, unknown>>
): string[] {
	const prefix = `${POLICY_AUTHORITY}#/$defs/`;
	if (!configurationSchema.startsWith(prefix)) {
		throw new Error(`${AUTHORITY} configuration is outside ${POLICY_AUTHORITY}`);
	}
	const definition = definitions[configurationSchema.slice(prefix.length)];
	if (
		!isRecord(definition) ||
		!isRecord(definition.properties) ||
		!isRecord(definition.properties.mode)
	) {
		throw new Error(`${configurationSchema} has no closed mode authority`);
	}
	const mode = definition.properties.mode;
	if (typeof mode.const === 'string') return [mode.const];
	if (Array.isArray(mode.enum) && mode.enum.every((value) => typeof value === 'string')) {
		return mode.enum;
	}
	if (mode.$ref === '#/$defs/Mode') {
		const shared = definitions.Mode;
		if (
			isRecord(shared) &&
			Array.isArray(shared.enum) &&
			shared.enum.every((value) => typeof value === 'string')
		)
			return shared.enum;
	}
	throw new Error(`${configurationSchema} does not close its accepted modes`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,127}$/u.test(value)) {
		throw new Error(`${AUTHORITY} has invalid ${label}`);
	}
	return value;
}

function requiredPath(value: unknown, label: string): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 256 ||
		value.startsWith('/') ||
		value.includes('..')
	) {
		throw new Error(`${AUTHORITY} has invalid ${label}`);
	}
	return value;
}

function requiredStringArray(value: unknown, label: string, maximum: number): string[] {
	if (
		!Array.isArray(value) ||
		value.length > maximum ||
		!value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 128) ||
		new Set(value).size !== value.length
	) {
		throw new Error(`${AUTHORITY} has invalid ${label}`);
	}
	return value as string[];
}
