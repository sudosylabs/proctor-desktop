import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Repository } from '../checks/types.ts';
import type { Generator } from './registry.ts';

const COMMON_AUTHORITY = 'native/schemas/native-observation.schema.json';
const DISPLAY_TOPOLOGY_AUTHORITY = 'native/schemas/display-topology.schema.json';
const CANDIDATE_WINDOW_AUTHORITY = 'native/schemas/candidate-window-state.schema.json';
const CAPTURE_SESSION_AUTHORITY = 'native/schemas/capture-session-state.schema.json';
const PROCESS_APPLICATION_AUTHORITY = 'native/schemas/process-application-state.schema.json';
const INTERACTIVE_SESSION_AUTHORITY = 'native/schemas/interactive-session-state.schema.json';
const CLIPBOARD_AUTHORITY = 'native/schemas/clipboard-state.schema.json';
const PRINT_SPOOLER_AUTHORITY = 'native/schemas/print-spooler-state.schema.json';
const REMOVABLE_STORAGE_AUTHORITY = 'native/schemas/removable-storage-state.schema.json';
const VIRTUALIZATION_AUTHORITY = 'native/schemas/virtualization-state.schema.json';
const NETWORK_CONFIGURATION_AUTHORITY = 'native/schemas/network-configuration-state.schema.json';
const MEDIA_DEVICE_AUTHORITY = 'native/schemas/media-device-state.schema.json';
const NATIVE_HELPER_AUTHORITY = 'native/schemas/native-helper.schema.json';
const RUST_OUTPUT = 'native/crates/prctr-native-protocol/src/generated.rs';
const TYPESCRIPT_OUTPUT = 'src/prctr/platform/native/common/nativeObservation.generated.ts';
const NATIVE_HELPER_RUST_OUTPUT =
	'native/crates/prctr-native-protocol/src/native_helper.generated.rs';

type CapabilityDescriptor = {
	readonly sourceId: string;
	readonly generatorId: string;
	readonly authority: string;
	readonly rustOutput: string;
	readonly drainType: string;
	readonly schemaVersionConstant: string;
	readonly maximumFactsConstant: string;
	readonly typescriptValidator: string;
};

const CAPABILITY_DESCRIPTORS: readonly CapabilityDescriptor[] = [
	capabilityDescriptor('candidate-window', CANDIDATE_WINDOW_AUTHORITY, 'CandidateWindow'),
	capabilityDescriptor('capture-session', CAPTURE_SESSION_AUTHORITY, 'CaptureSession'),
	capabilityDescriptor(
		'process-application',
		PROCESS_APPLICATION_AUTHORITY,
		'ProcessApplication'
	),
	capabilityDescriptor(
		'interactive-session',
		INTERACTIVE_SESSION_AUTHORITY,
		'InteractiveSession'
	),
	capabilityDescriptor('clipboard', CLIPBOARD_AUTHORITY, 'Clipboard'),
	capabilityDescriptor('print-spooler', PRINT_SPOOLER_AUTHORITY, 'PrintSpooler'),
	capabilityDescriptor('removable-storage', REMOVABLE_STORAGE_AUTHORITY, 'RemovableStorage'),
	capabilityDescriptor('virtualization', VIRTUALIZATION_AUTHORITY, 'Virtualization'),
	capabilityDescriptor(
		'network-configuration',
		NETWORK_CONFIGURATION_AUTHORITY,
		'NetworkConfiguration'
	),
	capabilityDescriptor('media-device', MEDIA_DEVICE_AUTHORITY, 'MediaDevice')
];

const GENERATED_MARKER = `// @${'generated'} by native.protocol from ${[
	COMMON_AUTHORITY,
	DISPLAY_TOPOLOGY_AUTHORITY,
	...CAPABILITY_DESCRIPTORS.map((descriptor) => descriptor.authority),
	NATIVE_HELPER_AUTHORITY
].join(', ')}.`;

function capabilityDescriptor(
	sourceId: string,
	authority: string,
	typePrefix: string
): CapabilityDescriptor {
	const snakePrefix = typePrefix.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toUpperCase();
	return {
		sourceId,
		generatorId: `${sourceId}.protocol`,
		authority,
		rustOutput: `native/crates/prctr-native-protocol/src/${sourceId.replaceAll('-', '_')}.generated.rs`,
		drainType: `${typePrefix}Drain`,
		schemaVersionConstant: `${snakePrefix}_SCHEMA_VERSION`,
		maximumFactsConstant: `MAX_${snakePrefix}_FACTS`,
		typescriptValidator: `is${typePrefix}Observation`
	};
}

type JsonSchema = {
	readonly $defs?: Readonly<Record<string, Definition>>;
	readonly properties?: Readonly<Record<string, Property>>;
	readonly ['x-proctor-source-manifest']?: readonly unknown[];
	readonly ['x-proctor-source-manifest-version']?: unknown;
	readonly ['x-proctor-source-lifecycle-deadline-ms']?: unknown;
};

type SourceManifestEntry = {
	readonly source_id: string;
	readonly schema_version: number;
};

type SemanticRule =
	| 'ordered_sequence_gap'
	| 'unique_target_ids'
	| 'valid_mirror_references'
	| 'gap_ends_immediately_before_sequence'
	| 'coherent_source_batch'
	| 'coherent_candidate_window_state'
	| 'coherent_candidate_window_host_event'
	| 'coherent_capture_session_signal'
	| 'coherent_process_executable_identity'
	| 'coherent_process_application_state'
	| 'unique_process_instance_ids'
	| 'coherent_process_application_event'
	| 'coherent_process_capture_time'
	| 'coherent_interactive_session_state'
	| 'coherent_clipboard_state'
	| 'coherent_print_spooler_state'
	| 'coherent_removable_storage_state'
	| 'unique_removable_storage_function_ids'
	| 'coherent_virtualization_state'
	| 'coherent_network_configuration_state'
	| 'unique_network_tunnel_interface_ids'
	| 'coherent_media_endpoint_state'
	| 'valid_helper_channel_nonce'
	| 'unique_helper_capabilities'
	| 'coherent_helper_source_open'
	| 'coherent_helper_source_snapshot'
	| 'coherent_helper_source_failure'
	| 'coherent_helper_observation'
	| 'coherent_helper_client_message'
	| 'coherent_helper_server_message';

type Definition = {
	readonly type?: string;
	readonly enum?: readonly string[];
	readonly properties?: Readonly<Record<string, Property>>;
	readonly required?: readonly string[];
	readonly additionalProperties?: boolean;
	readonly ['x-proctor-rules']?: readonly SemanticRule[];
};

type Property = Definition & {
	readonly $ref?: string;
	readonly items?: Property;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly maxItems?: number;
	readonly const?: string | number | boolean;
	readonly ['x-rust-type']?: string;
};

export const nativeProtocolGenerator: Generator = {
	id: 'native.protocol',
	inputs: [
		COMMON_AUTHORITY,
		DISPLAY_TOPOLOGY_AUTHORITY,
		...CAPABILITY_DESCRIPTORS.map((descriptor) => descriptor.authority),
		NATIVE_HELPER_AUTHORITY
	],
	committedOutputs: [RUST_OUTPUT, TYPESCRIPT_OUTPUT],
	buildOutputs: [],
	generate(repository: Repository, outputRoot: string): void {
		const schema = JSON.parse(repository.read(DISPLAY_TOPOLOGY_AUTHORITY)) as JsonSchema;
		const capabilityDefinitions = schema.$defs;
		if (capabilityDefinitions === undefined)
			throw new Error(`${DISPLAY_TOPOLOGY_AUTHORITY} must define $defs`);
		const commonSchema = JSON.parse(repository.read(COMMON_AUTHORITY)) as JsonSchema;
		const commonDefinitions = commonSchema.$defs;
		if (commonDefinitions === undefined)
			throw new Error(`${COMMON_AUTHORITY} must define $defs`);
		const definitions = mergeDefinitions(commonDefinitions, capabilityDefinitions);
		const capabilities = CAPABILITY_DESCRIPTORS.map((descriptor) => {
			const capabilitySchema = JSON.parse(
				repository.read(descriptor.authority)
			) as JsonSchema;
			const capabilityDefinitions = capabilitySchema.$defs;
			if (capabilityDefinitions === undefined) {
				throw new Error(`${descriptor.authority} must define $defs`);
			}
			const capabilitySchemaVersion = capabilitySchema.properties?.schema_version?.const;
			if (typeof capabilitySchemaVersion !== 'number') {
				throw new Error(
					`${descriptor.authority} must declare numeric schema_version const`
				);
			}
			return {
				descriptor,
				definitions: capabilityDefinitions,
				schemaVersion: capabilitySchemaVersion
			};
		});
		const schemaVersion = schema.properties?.schema_version?.const;
		if (typeof schemaVersion !== 'number')
			throw new Error(
				`${DISPLAY_TOPOLOGY_AUTHORITY} must declare numeric schema_version const`
			);
		const sourceManifest = requiredSourceManifest(
			commonSchema,
			new Map([
				['display-topology', schemaVersion],
				...capabilities.map(
					(capability) =>
						[capability.descriptor.sourceId, capability.schemaVersion] as const
				)
			])
		);
		const sourceManifestVersion = requiredSourceManifestVersion(commonSchema);
		const sourceLifecycleDeadlineMs = requiredSourceLifecycleDeadline(commonSchema);
		const sourceCategories = requiredNativeSourceCategories(commonDefinitions);
		const helperSchema = JSON.parse(repository.read(NATIVE_HELPER_AUTHORITY)) as JsonSchema;
		const helperDefinitions = helperSchema.$defs;
		if (helperDefinitions === undefined) {
			throw new Error(`${NATIVE_HELPER_AUTHORITY} must define $defs`);
		}
		const rustOutput = write(
			outputRoot,
			RUST_OUTPUT,
			renderRust(
				definitions,
				schemaVersion,
				sourceManifest,
				sourceManifestVersion,
				sourceLifecycleDeadlineMs,
				sourceCategories
			)
		);
		execFileSync('rustfmt', ['--edition', '2024', rustOutput]);
		write(
			outputRoot,
			TYPESCRIPT_OUTPUT,
			renderTypeScript(
				capabilities.reduce(
					(merged, capability) => mergeDefinitions(merged, capability.definitions),
					mergeDefinitions(definitions, helperDefinitions)
				),
				sourceManifest,
				sourceManifestVersion,
				sourceLifecycleDeadlineMs,
				sourceCategories
			)
		);
	}
};

export const nativeCapabilityProtocolGenerators: readonly Generator[] = CAPABILITY_DESCRIPTORS.map(
	(descriptor) => ({
		id: descriptor.generatorId,
		inputs: [COMMON_AUTHORITY, descriptor.authority],
		committedOutputs: [descriptor.rustOutput],
		buildOutputs: [],
		generate(repository: Repository, outputRoot: string): void {
			const schema = JSON.parse(repository.read(descriptor.authority)) as JsonSchema;
			const definitions = schema.$defs;
			if (definitions === undefined)
				throw new Error(`${descriptor.authority} must define $defs`);
			const schemaVersion = schema.properties?.schema_version?.const;
			if (typeof schemaVersion !== 'number') {
				throw new Error(
					`${descriptor.authority} must declare numeric schema_version const`
				);
			}
			const rustOutput = write(
				outputRoot,
				descriptor.rustOutput,
				renderCapabilityRust(
					definitions,
					schemaVersion,
					`// @${'generated'} by ${descriptor.generatorId} from ${COMMON_AUTHORITY} and ${descriptor.authority}.`,
					descriptor.drainType,
					descriptor.schemaVersionConstant,
					descriptor.maximumFactsConstant
				)
			);
			execFileSync('rustfmt', ['--edition', '2024', rustOutput]);
		}
	})
);

export const nativeHelperProtocolGenerator: Generator = {
	id: 'native-helper.protocol',
	inputs: [
		COMMON_AUTHORITY,
		PROCESS_APPLICATION_AUTHORITY,
		INTERACTIVE_SESSION_AUTHORITY,
		NATIVE_HELPER_AUTHORITY
	],
	committedOutputs: [NATIVE_HELPER_RUST_OUTPUT],
	buildOutputs: [],
	generate(repository: Repository, outputRoot: string): void {
		const schema = JSON.parse(repository.read(NATIVE_HELPER_AUTHORITY)) as JsonSchema;
		const definitions = schema.$defs;
		if (definitions === undefined)
			throw new Error(`${NATIVE_HELPER_AUTHORITY} must define $defs`);
		const schemaVersion = schema.properties?.schema_version?.const;
		if (typeof schemaVersion !== 'number') {
			throw new Error(`${NATIVE_HELPER_AUTHORITY} must declare numeric schema_version const`);
		}
		const rustOutput = write(
			outputRoot,
			NATIVE_HELPER_RUST_OUTPUT,
			renderHelperRust(definitions, schemaVersion)
		);
		execFileSync('rustfmt', ['--edition', '2024', rustOutput]);
	}
};

function renderRust(
	definitions: Readonly<Record<string, Definition>>,
	schemaVersion: number,
	sourceManifest: readonly SourceManifestEntry[],
	sourceManifestVersion: number,
	sourceLifecycleDeadlineMs: number,
	sourceCategories: readonly string[]
): string {
	const maximumTargets = definitions.DisplayTopologySnapshot?.properties?.targets?.maxItems;
	if (maximumTargets === undefined)
		throw new Error(`${DISPLAY_TOPOLOGY_AUTHORITY} must bound DisplayTopologySnapshot.targets`);
	const maximumFacts = sourceBatchFactLimit(definitions, 'DisplayTopologyDrain');
	const maximumTimestamp = definitions.SourceTimestamp?.properties?.monotonic_time_ns?.maximum;
	if (maximumTimestamp === undefined)
		throw new Error(
			`${DISPLAY_TOPOLOGY_AUTHORITY} must bound SourceTimestamp.monotonic_time_ns`
		);
	const lines = [
		GENERATED_MARKER,
		'// Do not edit by hand.',
		'',
		'use std::fmt;',
		'use serde::{Deserialize, Serialize};',
		'',
		`pub const DISPLAY_TOPOLOGY_SCHEMA_VERSION: u16 = ${rustNumber(schemaVersion)};`,
		`pub const MAX_DISPLAY_TARGETS: usize = ${rustNumber(maximumTargets)};`,
		`pub const MAX_DISPLAY_TOPOLOGY_FACTS: usize = ${rustNumber(maximumFacts)};`,
		`pub const MAX_PROTOCOL_SAFE_INTEGER: u64 = ${rustNumber(maximumTimestamp)};`,
		`pub const NATIVE_SOURCE_COUNT: usize = ${sourceManifest.length};`,
		`pub const NATIVE_SOURCE_CATEGORY_COUNT: usize = ${sourceCategories.length};`,
		`pub const NATIVE_SOURCE_MANIFEST_VERSION: u16 = ${rustNumber(sourceManifestVersion)};`,
		`pub const NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS: u64 = ${rustNumber(sourceLifecycleDeadlineMs)};`,
		'',
		'#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]',
		'pub struct NativeSourceManifestEntry {',
		"    pub source_id: &'static str,",
		'    pub schema_version: u16,',
		'}',
		'',
		'pub const NATIVE_SOURCE_MANIFEST: [NativeSourceManifestEntry; NATIVE_SOURCE_COUNT] = [',
		...sourceManifest
			.map((entry) => [
				'    NativeSourceManifestEntry {',
				`        source_id: ${JSON.stringify(entry.source_id)},`,
				`        schema_version: ${rustNumber(entry.schema_version)},`,
				'    },'
			])
			.flat(),
		'];',
		'',
		'pub const NATIVE_SOURCE_CATEGORY_ORDER: [NativeSourceCategory; NATIVE_SOURCE_CATEGORY_COUNT] = [',
		...sourceCategories.map(
			(category) => `    NativeSourceCategory::${rustVariant(category)},`
		),
		'];',
		'',
		'#[derive(Clone, Debug, Eq, PartialEq)]',
		'pub struct ProtocolValidationError {',
		"    pub type_name: &'static str,",
		"    pub field: &'static str,",
		"    pub rule: &'static str,",
		'}',
		'',
		'impl ProtocolValidationError {',
		"    pub(crate) fn new(type_name: &'static str, field: &'static str, rule: &'static str) -> Self {",
		'        Self { type_name, field, rule }',
		'    }',
		'}',
		'',
		'impl fmt::Display for ProtocolValidationError {',
		"    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {",
		'        write!(formatter, "{}.{} violates {}", self.type_name, self.field, self.rule)',
		'    }',
		'}',
		'',
		'impl std::error::Error for ProtocolValidationError {}',
		'',
		'pub trait ProtocolValidatable {',
		'    /// Validates the generated JSON wire constraints for this value.',
		'    ///',
		'    /// # Errors',
		'    ///',
		'    /// Returns the first field whose value is outside the schema bounds.',
		'    fn validate_protocol(&self) -> Result<(), ProtocolValidationError>;',
		'}',
		''
	];
	lines.push(...renderRustDefinitions(definitions));
	return `${lines.join('\n').trimEnd()}\n`;
}

function renderCapabilityRust(
	definitions: Readonly<Record<string, Definition>>,
	schemaVersion: number,
	marker: string,
	drainType: string,
	schemaVersionConstant: string,
	maximumFactsConstant: string
): string {
	const maximumFacts = sourceBatchFactLimit(definitions, drainType);
	const lines = [
		marker,
		'// Do not edit by hand.',
		'',
		'use serde::{Deserialize, Serialize};',
		'',
		'use crate::{',
		'    PermissionState, PlatformFamily, ProtocolValidatable, ProtocolValidationError,',
		'    SequenceGap, SourceFailureCode, SourceHealth, SourceReset, SourceTimestamp,',
		'};',
		'',
		`pub const ${schemaVersionConstant}: u16 = ${rustNumber(schemaVersion)};`,
		`pub const ${maximumFactsConstant}: usize = ${rustNumber(maximumFacts)};`,
		''
	];
	lines.push(...renderRustDefinitions(definitions));
	return `${lines.join('\n').trimEnd()}\n`;
}

function renderHelperRust(
	definitions: Readonly<Record<string, Definition>>,
	schemaVersion: number
): string {
	const lines = [
		`// @${'generated'} by native-helper.protocol from ${COMMON_AUTHORITY}, ${PROCESS_APPLICATION_AUTHORITY}, ${INTERACTIVE_SESSION_AUTHORITY}, and ${NATIVE_HELPER_AUTHORITY}.`,
		'// Do not edit by hand.',
		'',
		'use serde::{Deserialize, Serialize};',
		'',
		'use crate::{',
		'    INTERACTIVE_SESSION_SCHEMA_VERSION, InteractiveSessionEvent, InteractiveSessionState,',
		'    PROCESS_APPLICATION_SCHEMA_VERSION, ProcessApplicationEvent, ProcessApplicationState,',
		'    ProtocolValidatable, ProtocolValidationError,',
		'};',
		'',
		`pub const NATIVE_HELPER_SCHEMA_VERSION: u16 = ${rustNumber(schemaVersion)};`,
		''
	];
	lines.push(...renderRustDefinitions(definitions));
	return `${lines.join('\n').trimEnd()}\n`;
}

function renderRustDefinitions(definitions: Readonly<Record<string, Definition>>): string[] {
	const lines: string[] = [];
	for (const [name, definition] of Object.entries(definitions)) {
		if (definition.type === 'string' && definition.enum !== undefined) {
			const needsExactRename = definition.enum.some((value) => value.includes('-'));
			lines.push('#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]');
			if (!needsExactRename) lines.push('#[serde(rename_all = "snake_case")]');
			lines.push(`pub enum ${name} {`);
			for (const value of definition.enum) {
				if (needsExactRename) lines.push(`    #[serde(rename = ${JSON.stringify(value)})]`);
				lines.push(`    ${rustVariant(value)},`);
			}
			lines.push('}', '');
			lines.push(`impl ProtocolValidatable for ${name} {`);
			lines.push('    fn validate_protocol(&self) -> Result<(), ProtocolValidationError> {');
			lines.push('        Ok(())');
			lines.push('    }');
			lines.push('}', '');
			continue;
		}
		if (definition.type === 'object' && definition.properties !== undefined) {
			const required = new Set(definition.required ?? []);
			const booleanCount = Object.values(definition.properties).filter(
				(property) => property.type === 'boolean'
			).length;
			if (booleanCount > 3) {
				lines.push(
					'// These independent mechanical facts are intentionally not one state machine.'
				);
				lines.push('#[allow(clippy::struct_excessive_bools)]');
			}
			lines.push('#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]');
			if (definition.additionalProperties === false) {
				lines.push('#[serde(deny_unknown_fields)]');
			}
			lines.push(`pub struct ${name} {`);
			for (const [propertyName, property] of Object.entries(definition.properties)) {
				const type = rustType(property);
				const optional = !required.has(propertyName);
				if (optional && property['x-rust-type'] !== 'u64') {
					lines.push('    #[serde(skip_serializing_if = "Option::is_none")]');
				}
				if (property['x-rust-type'] === 'u64') {
					lines.push('    #[serde(');
					if (optional) {
						lines.push('        default,');
						lines.push('        skip_serializing_if = "Option::is_none",');
						lines.push(
							'        serialize_with = "crate::serialize_protocol_safe_optional_u64",'
						);
						lines.push(
							'        deserialize_with = "crate::deserialize_protocol_safe_optional_u64"'
						);
					} else {
						lines.push(
							'        serialize_with = "crate::serialize_protocol_safe_u64",'
						);
						lines.push(
							'        deserialize_with = "crate::deserialize_protocol_safe_u64"'
						);
					}
					lines.push('    )]');
				}
				lines.push(`    pub ${propertyName}: ${optional ? `Option<${type}>` : type},`);
			}
			lines.push('}', '');
			if (Object.keys(definition.properties).length > 8) {
				lines.push(
					'// Validation remains generated next to the complete bounded wire shape.'
				);
				lines.push('#[allow(clippy::too_many_lines)]');
			}
			lines.push(`impl ProtocolValidatable for ${name} {`);
			lines.push('    fn validate_protocol(&self) -> Result<(), ProtocolValidationError> {');
			for (const [propertyName, property] of Object.entries(definition.properties)) {
				lines.push(
					...rustValidation(name, propertyName, property, required.has(propertyName))
				);
			}
			lines.push(...rustSemanticValidation(name, definition['x-proctor-rules'] ?? []));
			lines.push('        Ok(())');
			lines.push('    }');
			lines.push('}', '');
			lines.push(...rustSemanticHelpers(name, definition['x-proctor-rules'] ?? []));
			continue;
		}
		throw new Error(`Unsupported definition ${name}`);
	}
	return lines;
}

function renderTypeScript(
	definitions: Readonly<Record<string, Definition>>,
	sourceManifest: readonly SourceManifestEntry[],
	sourceManifestVersion: number,
	sourceLifecycleDeadlineMs: number,
	sourceCategories: readonly string[]
): string {
	const maximumTargets = definitions.DisplayTopologySnapshot?.properties?.targets?.maxItems;
	if (maximumTargets === undefined)
		throw new Error(`${DISPLAY_TOPOLOGY_AUTHORITY} must bound DisplayTopologySnapshot.targets`);
	const maximumDisplayFacts = sourceBatchFactLimit(definitions, 'DisplayTopologyDrain');
	const lines = [
		GENERATED_MARKER,
		'// Do not edit by hand.',
		'',
		`export const NATIVE_SOURCE_MANIFEST = ${JSON.stringify(sourceManifest)} as const;`,
		'export type NativeSourceManifest = typeof NATIVE_SOURCE_MANIFEST;',
		`export const NATIVE_SOURCE_MANIFEST_VERSION = ${sourceManifestVersion};`,
		`export const NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS = ${sourceLifecycleDeadlineMs};`,
		`export const NATIVE_SOURCE_CATEGORY_ORDER = ${JSON.stringify(sourceCategories)} as const;`,
		'',
		`const MAX_DISPLAY_TOPOLOGY_FACTS = ${maximumDisplayFacts};`,
		...CAPABILITY_DESCRIPTORS.map(
			(descriptor) =>
				`const ${descriptor.maximumFactsConstant} = ${sourceBatchFactLimit(definitions, descriptor.drainType)};`
		),
		'',
		'type JsonObject = Record<string, unknown>;',
		'',
		'function isJsonObject(value: unknown): value is JsonObject {',
		"  return typeof value === 'object' && value !== null && !Array.isArray(value);",
		'}',
		'',
		'function hasOnlyKeys(value: JsonObject, keys: readonly string[]): boolean {',
		'  let count = 0;',
		'  for (const key in value) {',
		'    if (!Object.hasOwn(value, key)) continue;',
		'    count += 1;',
		'    if (count > keys.length || !keys.includes(key)) return false;',
		'  }',
		'  return true;',
		'}',
		'',
		'function hasCodePointLength(value: unknown, minimum: number, maximum: number): value is string {',
		"  if (typeof value !== 'string') return false;",
		'  let length = 0;',
		'  for (const _codePoint of value) {',
		'    length += 1;',
		'    if (length > maximum) return false;',
		'  }',
		'  return length >= minimum;',
		'}',
		'',
		'function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {',
		"  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;",
		'}',
		'',
		'function isBoundedArray<T>(value: unknown, maximum: number, validate: (item: unknown) => item is T): value is readonly T[] {',
		'  if (!Array.isArray(value) || value.length > maximum) return false;',
		'  let ownEnumerableKeys = 0;',
		'  for (const key in value) {',
		'    if (!Object.hasOwn(value, key)) continue;',
		'    ownEnumerableKeys += 1;',
		'    const index = Number(key);',
		'    if (ownEnumerableKeys > value.length || !Number.isInteger(index)',
		'      || index < 0 || index >= value.length || String(index) !== key) return false;',
		'  }',
		'  if (ownEnumerableKeys !== value.length) return false;',
		'  for (let index = 0; index < value.length; index += 1) {',
		'    if (!Object.hasOwn(value, index) || !validate(value[index])) return false;',
		'  }',
		'  return true;',
		'}',
		'',
		'function hasUniqueDisplayTargetIds(value: unknown): boolean {',
		`  if (!isBoundedArray(value, ${maximumTargets}, isDisplayTarget)) return false;`,
		'  return value.every((target, index) => value.findIndex(candidate => candidate.target_id === target.target_id) === index);',
		'}',
		'',
		'function hasValidMirrorReferences(value: unknown): boolean {',
		`  if (!isBoundedArray(value, ${maximumTargets}, isDisplayTarget)) return false;`,
		'  return value.every(target => target.mirror_primary_id === undefined',
		'    || (target.mirror_primary_id !== target.target_id',
		'      && value.some(candidate => candidate.target_id === target.mirror_primary_id)));',
		'}',
		'',
		'function gapEndsImmediatelyBeforeSequence(gap: unknown, sequence: unknown): boolean {',
		'  return gap === undefined || (isSequenceGap(gap) && isBoundedInteger(sequence, 1, Number.MAX_SAFE_INTEGER)',
		'    && gap.last_missing === sequence - 1);',
		'}',
		'',
		'function hasStrictlyIncreasingSequence(facts: readonly { readonly sequence: number }[]): boolean {',
		'  return facts.every((fact, index) => index === 0 || (facts[index - 1]?.sequence ?? fact.sequence) < fact.sequence);',
		'}',
		'',
		'function hasCoherentSourceBatch<T extends { readonly source_instance_id: string; readonly sequence: number; readonly gap?: SequenceGap }>(',
		'  sourceInstanceId: unknown, health: unknown, observations: unknown, resets: unknown,',
		'  terminalError: unknown, maximumFacts: number, validateObservation: (value: unknown) => value is T',
		'): boolean {',
		"  if (typeof sourceInstanceId !== 'string' || !Array.isArray(observations) || !Array.isArray(resets)) return false;",
		'  if (observations.length + resets.length > maximumFacts || resets.length > 1) return false;',
		"  if ((health === 'failed') !== (terminalError !== undefined) || health === 'starting') return false;",
		'  if (!observations.every(validateObservation) || !resets.every(isSourceReset)) return false;',
		'  if (!observations.every(fact => fact.source_instance_id === sourceInstanceId)',
		'    || !resets.every(fact => fact.source_instance_id === sourceInstanceId)) return false;',
		'  if (!hasStrictlyIncreasingSequence(observations) || !hasStrictlyIncreasingSequence(resets)) return false;',
		'  const sequences = [...observations, ...resets].map(fact => fact.sequence);',
		'  if (new Set(sequences).size !== sequences.length) return false;',
		'  const facts = [...observations, ...resets].sort((left, right) => left.sequence - right.sequence);',
		'  if (!facts.every((fact, index) => {',
		'    const previous = facts[index - 1];',
		'    if (previous === undefined) return true;',
		'    return fact.gap === undefined',
		'      ? fact.sequence === previous.sequence + 1',
		'      : fact.gap.first_missing === previous.sequence + 1;',
		'  })) return false;',
		'  const reset = resets[0];',
		'  return reset === undefined || observations.every(fact => reset.sequence < fact.sequence);',
		'}',
		'',
		'function hasCoherentCandidateWindowState(value: JsonObject): boolean {',
		"  if (value.presence === 'absent') return value.focus !== 'focused'",
		"    && value.visibility !== 'visible' && value.placement === 'unknown'",
		'    && value.bounds === undefined && value.display_target_id === undefined',
		"    && (value.certainty !== 'complete'",
		"      || (value.focus === 'not_focused' && value.visibility === 'not_visible'));",
		"  if (value.focus === 'focused' && (value.presence !== 'present' || value.visibility !== 'visible')) return false;",
		"  if ((value.visibility === 'visible' || value.placement !== 'unknown'",
		'    || value.bounds !== undefined || value.display_target_id !== undefined)',
		"    && value.presence !== 'present') return false;",
		"  return value.certainty !== 'complete' || (value.presence === 'present'",
		"    && value.focus !== 'unknown' && value.visibility !== 'unknown'",
		"    && value.placement !== 'unknown' && value.bounds !== undefined",
		'    && value.display_target_id !== undefined);',
		'}',
		'',
		'function hasCoherentCandidateWindowHostEvent(value: JsonObject): boolean {',
		"  return value.kind === 'close_attempt' ? value.window === undefined : value.window !== undefined;",
		'}',
		'',
		'function hasCoherentCaptureSessionSignal(value: JsonObject): boolean {',
		"  if (value.support === 'unsupported') return value.activity === 'unknown' && value.certainty === 'unknown';",
		"  if (value.certainty === 'complete') return value.activity !== 'unknown';",
		"  return value.certainty !== 'unknown' || value.activity === 'unknown';",
		'}',
		'',
		'function hasCoherentProcessExecutableIdentity(value: JsonObject): boolean {',
		"  const identityKeys = ['signer_chain_id', 'publisher_id', 'product_id', 'signing_id',",
		"    'team_id', 'designated_requirement', 'bundle_id', 'package_id', 'version', 'digest_sha256'] as const;",
		'  if (value.digest_sha256 !== undefined',
		"    && (typeof value.digest_sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.digest_sha256))) return false;",
		"  if (value.status === 'pending' || value.status === 'unavailable') {",
		'    return identityKeys.every(key => value[key] === undefined);',
		'  }',
		"  if (value.status === 'unsigned') {",
		"    return typeof value.digest_sha256 === 'string'",
		"      && identityKeys.every(key => key === 'digest_sha256' || value[key] === undefined);",
		'  }',
		"  const windowsIdentity = typeof value.signer_chain_id === 'string'",
		"    && typeof value.publisher_id === 'string' && typeof value.product_id === 'string'",
		"    && typeof value.version === 'string' && value.signing_id === undefined",
		'    && value.team_id === undefined && value.designated_requirement === undefined',
		'    && value.bundle_id === undefined && value.package_id === undefined;',
		"  const macosIdentity = typeof value.signing_id === 'string' && typeof value.team_id === 'string'",
		"    && typeof value.designated_requirement === 'string' && typeof value.bundle_id === 'string'",
		"    && typeof value.version === 'string' && value.signer_chain_id === undefined",
		'    && value.publisher_id === undefined && value.product_id === undefined',
		'    && value.package_id === undefined;',
		"  const linuxIdentity = typeof value.package_id === 'string'",
		"    && typeof value.version === 'string' && typeof value.digest_sha256 === 'string'",
		'    && value.signer_chain_id === undefined && value.publisher_id === undefined',
		'    && value.product_id === undefined && value.signing_id === undefined',
		'    && value.team_id === undefined && value.designated_requirement === undefined',
		'    && value.bundle_id === undefined;',
		'  return windowsIdentity || macosIdentity || linuxIdentity;',
		'}',
		'',
		'function hasCoherentProcessApplicationState(value: JsonObject): boolean {',
		"  return value.coverage !== 'unavailable'",
		"    || (value.certainty === 'unknown' && Array.isArray(value.processes) && value.processes.length === 0);",
		'}',
		'',
		'function hasUniqueProcessInstanceIds(value: unknown): boolean {',
		'  if (!Array.isArray(value)) return false;',
		'  return value.every((process, index) => isProcessApplicationProcess(process)',
		'    && value.findIndex(candidate => isProcessApplicationProcess(candidate)',
		'      && candidate.process_instance_id === process.process_instance_id) === index);',
		'}',
		'',
		'function hasCoherentProcessApplicationEvent(value: JsonObject): boolean {',
		"  if (value.kind === 'reconciled') return value.process_instance_id === undefined",
		'    && value.process === undefined && isProcessApplicationState(value.state);',
		"  if (value.kind === 'exited') return typeof value.process_instance_id === 'string'",
		'    && value.process === undefined && value.state === undefined;',
		"  return typeof value.process_instance_id === 'string' && value.state === undefined",
		'    && isProcessApplicationProcess(value.process)',
		'    && value.process.process_instance_id === value.process_instance_id;',
		'}',
		'',
		'function hasCoherentProcessCaptureTime(event: unknown, timestamp: unknown): boolean {',
		'  return isProcessApplicationEvent(event) && typeof timestamp === "number"',
		'    && (event.capture_delay_ns ?? 0) <= timestamp;',
		'}',
		'',
		'function hasCoherentInteractiveSessionState(value: JsonObject): boolean {',
		"  if (value.coverage === 'unavailable') return value.certainty === 'unknown'",
		"    && value.console_ownership === 'unknown' && value.lock_state === 'unknown'",
		"    && value.remote_attachment === 'unknown' && value.other_human_session_count === 0;",
		"  return value.certainty !== 'complete' || (value.console_ownership !== 'unknown'",
		"    && value.lock_state !== 'unknown' && value.remote_attachment !== 'unknown');",
		'}',
		'',
		'function hasCoherentClipboardState(value: JsonObject): boolean {',
		"  return value.coverage !== 'unavailable'",
		"    || (value.certainty === 'unknown' && value.change_generation === 0);",
		'}',
		'',
		'function hasCoherentPrintSpoolerState(value: JsonObject): boolean {',
		"  if (value.coverage === 'unavailable') return value.certainty === 'unknown'",
		'    && value.candidate_job_count === 0 && value.other_job_count === 0',
		'    && value.unknown_job_count === 0;',
		"  return value.certainty !== 'complete' || value.unknown_job_count === 0;",
		'}',
		'',
		'function hasCoherentRemovableStorageState(value: JsonObject): boolean {',
		"  if (value.coverage === 'unavailable') return value.certainty === 'unknown'",
		'    && Array.isArray(value.attached_functions) && value.attached_functions.length === 0;',
		"  return value.coverage !== 'block_only' || (Array.isArray(value.attached_functions)",
		"    && value.attached_functions.every(entry => isRemovableStorageFunction(entry) && entry.kind === 'block_storage'));",
		'}',
		'',
		'function hasUniqueRemovableStorageFunctionIds(value: unknown): boolean {',
		'  if (!Array.isArray(value)) return false;',
		'  return value.every((entry, index) => isRemovableStorageFunction(entry)',
		'    && value.findIndex(candidate => isRemovableStorageFunction(candidate)',
		'      && candidate.function_instance_id === entry.function_instance_id) === index);',
		'}',
		'',
		'function hasCoherentVirtualizationState(value: JsonObject): boolean {',
		"  return value.coverage !== 'unavailable' || (value.certainty === 'unknown'",
		"    && value.classification === 'unknown');",
		'}',
		'',
		'function hasCoherentNetworkConfigurationState(value: JsonObject): boolean {',
		"  if (value.coverage === 'unavailable') return value.certainty === 'unknown'",
		"    && value.system_proxy === 'unknown' && value.managed_vpn === 'unknown'",
		'    && Array.isArray(value.tunnel_interfaces) && value.tunnel_interfaces.length === 0',
		'    && value.route_generation === 0;',
		"  return value.coverage !== 'full_configuration' || value.certainty !== 'complete'",
		"    || (value.system_proxy !== 'unknown' && value.managed_vpn !== 'unknown');",
		'}',
		'',
		'function hasUniqueNetworkTunnelInterfaceIds(value: unknown): boolean {',
		'  if (!Array.isArray(value)) return false;',
		'  return value.every((entry, index) => isNetworkTunnelInterface(entry)',
		'    && value.findIndex(candidate => isNetworkTunnelInterface(candidate)',
		'      && candidate.interface_instance_id === entry.interface_instance_id) === index);',
		'}',
		'',
		'function hasCoherentMediaEndpointState(value: JsonObject): boolean {',
		"  if (value.coverage === 'not_collected') return value.certainty === 'unknown'",
		"    && value.permission === 'not_determined' && value.readiness === 'unknown'",
		"    && value.endpoint_count === 0 && value.other_application_use === 'unknown';",
		"  if (value.coverage === 'unavailable') return value.certainty === 'unknown'",
		"    && value.permission === 'unavailable' && value.readiness === 'unknown'",
		"    && value.endpoint_count === 0 && value.other_application_use === 'unknown';",
		"  if (value.coverage === 'readiness_only' && value.other_application_use !== 'unknown') return false;",
		"  return value.certainty !== 'complete' || (value.readiness !== 'unknown'",
		"    && (value.coverage !== 'readiness_and_concurrent_use' || value.other_application_use !== 'unknown'));",
		'}',
		'',
		'function hasValidHelperChannelNonce(value: JsonObject): boolean {',
		"  return typeof value.channel_nonce === 'string'",
		'    && /^[0-9a-f]{64}$/u.test(value.channel_nonce);',
		'}',
		'',
		'function hasUniqueHelperCapabilities(value: JsonObject): boolean {',
		'  return Array.isArray(value.capabilities) && value.capabilities.length > 0',
		'    && new Set(value.capabilities).size === value.capabilities.length;',
		'}',
		'',
		'function hasCoherentHelperSourceOpen(value: JsonObject): boolean {',
		'  if (!Array.isArray(value.event_classes)) return false;',
		"  const schemaMatches = value.source_kind === 'process_application'",
		'    ? value.schema_version === 1',
		"    : value.source_kind === 'interactive_session' && value.schema_version === 1;",
		'  if (!schemaMatches) return false;',
		"  return value.source_kind === 'process_application'",
		'    ? value.event_classes.length === 2',
		"      && value.event_classes.includes('process_lifecycle')",
		"      && value.event_classes.includes('process_identity')",
		"    : value.source_kind === 'interactive_session'",
		'      && value.event_classes.length === 1',
		"      && value.event_classes[0] === 'interactive_session_lifecycle';",
		'}',
		'',
		'function hasCoherentHelperObservation(value: JsonObject): boolean {',
		"  return value.source_kind === 'process_application'",
		'    ? isProcessApplicationEvent(value.process_event)',
		'      && hasCoherentProcessCaptureTime(value.process_event, value.monotonic_time_ns)',
		'      && value.interactive_session_event === undefined',
		"    : value.source_kind === 'interactive_session'",
		'      && isInteractiveSessionEvent(value.interactive_session_event)',
		'      && value.process_event === undefined;',
		'}',
		'',
		'function hasCoherentHelperSourceSnapshot(value: JsonObject): boolean {',
		"  const schemaMatches = value.source_kind === 'process_application'",
		'    ? value.schema_version === 1',
		"    : value.source_kind === 'interactive_session' && value.schema_version === 1;",
		'  if (!schemaMatches) return false;',
		"  return value.source_kind === 'process_application'",
		'    ? isProcessApplicationState(value.process_state)',
		'      && value.interactive_session_state === undefined',
		"    : value.source_kind === 'interactive_session'",
		'      && isInteractiveSessionState(value.interactive_session_state)',
		'      && value.process_state === undefined;',
		'}',
		'',
		'function hasCoherentHelperSourceFailure(value: JsonObject): boolean {',
		"  const reportsLoss = value.failure_code === 'native_event_loss'",
		"    || value.failure_code === 'queue_overflow';",
		"  return reportsLoss === (typeof value.lost_event_count === 'number');",
		'}',
		'',
		'function hasCoherentHelperClientMessage(value: JsonObject): boolean {',
		"  if (value.kind === 'open') return isHelperSourceOpen(value.open)",
		'    && value.close === undefined;',
		"  return value.kind === 'close' && value.open === undefined",
		'    && isHelperSourceClose(value.close);',
		'}',
		'',
		'function hasCoherentHelperServerMessage(value: JsonObject): boolean {',
		"  if (value.kind === 'snapshot') return isHelperSourceSnapshot(value.snapshot)",
		'    && value.observation === undefined && value.failure === undefined;',
		"  if (value.kind === 'observation') return value.snapshot === undefined",
		'    && isHelperObservation(value.observation) && value.failure === undefined;',
		"  return value.kind === 'failure' && value.snapshot === undefined",
		'    && value.observation === undefined && isHelperSourceFailure(value.failure);',
		'}',
		''
	];
	lines.push(...renderTypeScriptDefinitions(definitions));
	return `${lines.join('\n').trimEnd()}\n`;
}

function requiredSourceManifest(
	schema: JsonSchema,
	schemaVersions: ReadonlyMap<string, number>
): readonly SourceManifestEntry[] {
	const manifest = schema['x-proctor-source-manifest'];
	if (manifest === undefined || manifest.length === 0) {
		throw new Error(`${COMMON_AUTHORITY} must declare a non-empty x-proctor-source-manifest`);
	}
	const sourceIds = new Set<string>();
	const result = manifest.map((sourceId, index) => {
		if (typeof sourceId !== 'string' || !/^[a-z]+(?:-[a-z]+)*$/u.test(sourceId)) {
			throw new Error(
				`${COMMON_AUTHORITY} source manifest entry ${index} has an invalid source_id`
			);
		}
		if (sourceIds.has(sourceId)) {
			throw new Error(`${COMMON_AUTHORITY} source manifest repeats ${sourceId}`);
		}
		const schemaVersion = schemaVersions.get(sourceId);
		if (schemaVersion === undefined) {
			throw new Error(
				`${COMMON_AUTHORITY} source manifest names unsupported source ${sourceId}`
			);
		}
		sourceIds.add(sourceId);
		return { source_id: sourceId, schema_version: schemaVersion };
	});
	if (sourceIds.size !== schemaVersions.size) {
		throw new Error(
			`${COMMON_AUTHORITY} source manifest must name every generated source exactly once`
		);
	}
	return result;
}

function requiredSourceLifecycleDeadline(schema: JsonSchema): number {
	const deadline = schema['x-proctor-source-lifecycle-deadline-ms'];
	if (
		typeof deadline !== 'number' ||
		!Number.isSafeInteger(deadline) ||
		deadline < 1 ||
		deadline > 60_000
	) {
		throw new Error(
			`${COMMON_AUTHORITY} must declare a bounded x-proctor-source-lifecycle-deadline-ms`
		);
	}
	return deadline;
}

function requiredSourceManifestVersion(schema: JsonSchema): number {
	const version = schema['x-proctor-source-manifest-version'];
	if (
		typeof version !== 'number' ||
		!Number.isInteger(version) ||
		version < 1 ||
		version > 65_535
	) {
		throw new Error(
			`${COMMON_AUTHORITY} must declare a bounded x-proctor-source-manifest-version`
		);
	}
	return version;
}

function requiredNativeSourceCategories(
	definitions: Readonly<Record<string, Definition>>
): readonly string[] {
	const categories = definitions.NativeSourceCategory?.enum;
	if (categories === undefined || categories.length === 0) {
		throw new Error(`${COMMON_AUTHORITY} must define a non-empty NativeSourceCategory enum`);
	}
	const unique = new Set(categories);
	if (
		unique.size !== categories.length ||
		categories.some((category) => !/^[a-z]+(?:-[a-z]+)*$/u.test(category))
	) {
		throw new Error(
			`${COMMON_AUTHORITY} NativeSourceCategory entries must be unique kebab-case`
		);
	}
	return categories;
}

function renderTypeScriptDefinitions(definitions: Readonly<Record<string, Definition>>): string[] {
	const lines: string[] = [];
	for (const [name, definition] of Object.entries(definitions)) {
		if (definition.type === 'string' && definition.enum !== undefined) {
			lines.push(
				`export type ${name} = ${definition.enum.map((value) => JSON.stringify(value)).join(' | ')};`
			);
			lines.push('');
			lines.push(`export function is${name}(value: unknown): value is ${name} {`);
			lines.push(
				`  return ${definition.enum.map((value) => `value === ${JSON.stringify(value)}`).join(' || ')};`
			);
			lines.push('}', '');
			continue;
		}
		if (definition.type === 'object' && definition.properties !== undefined) {
			const required = new Set(definition.required ?? []);
			lines.push(`export interface ${name} {`);
			for (const [propertyName, property] of Object.entries(definition.properties)) {
				lines.push(
					`  readonly ${propertyName}${required.has(propertyName) ? '' : '?'}: ${typescriptType(property)};`
				);
			}
			lines.push('}', '');
			const propertyNames = Object.keys(definition.properties);
			lines.push(`export function is${name}(value: unknown): value is ${name} {`);
			lines.push('  return isJsonObject(value)');
			if (definition.additionalProperties === false) {
				lines.push(
					`    && hasOnlyKeys(value, [${propertyNames.map((value) => JSON.stringify(value)).join(', ')}])`
				);
			}
			for (const [propertyName, property] of Object.entries(definition.properties)) {
				const validation = typescriptValidation(`value.${propertyName}`, property);
				lines.push(
					`    && ${required.has(propertyName) ? `Object.hasOwn(value, ${JSON.stringify(propertyName)}) && ${validation}` : `(!Object.hasOwn(value, ${JSON.stringify(propertyName)}) || ${validation})`}`
				);
			}
			for (const validation of typescriptSemanticValidation(
				name,
				definition['x-proctor-rules'] ?? []
			)) {
				lines.push(`    && ${validation}`);
			}
			lines.push('}', '');
			continue;
		}
		throw new Error(`Unsupported definition ${name}`);
	}
	return lines;
}

type SemanticRuleEmitter = {
	readonly rust: (typeName: string) => readonly string[];
	readonly rustHelpers?: (typeName: string) => readonly string[];
	readonly typescript: (typeName: string) => string;
};

const semanticRuleEmitters = {
	ordered_sequence_gap: {
		rust: (typeName) => [
			'        if self.first_missing > self.last_missing {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "last_missing", "not before first_missing"));`,
			'        }'
		],
		typescript: () => 'value.first_missing <= value.last_missing'
	},
	unique_target_ids: {
		rust: (typeName) => [
			'        for (index, target) in self.targets.iter().enumerate() {',
			'            if self.targets[..index].iter().any(|existing| existing.target_id == target.target_id) {',
			`                return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "targets", "unique target_id"));`,
			'            }',
			'        }'
		],
		typescript: () => 'hasUniqueDisplayTargetIds(value.targets)'
	},
	valid_mirror_references: {
		rust: (typeName) => [
			'        for target in &self.targets {',
			'            if target.mirror_primary_id.as_ref().is_some_and(|primary| primary == &target.target_id || !self.targets.iter().any(|candidate| &candidate.target_id == primary)) {',
			`                return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "targets", "valid mirror_primary_id"));`,
			'            }',
			'        }'
		],
		typescript: () => 'hasValidMirrorReferences(value.targets)'
	},
	gap_ends_immediately_before_sequence: {
		rust: (typeName) => [
			'        if self.gap.as_ref().is_some_and(|gap| gap.last_missing != self.sequence - 1) {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "gap", "last_missing immediately before sequence"));`,
			'        }'
		],
		typescript: () => 'gapEndsImmediatelyBeforeSequence(value.gap, value.sequence)'
	},
	coherent_source_batch: {
		rust: () => ['        self.validate_coherent_source_batch()?;'],
		rustHelpers: (typeName) => [
			`impl ${typeName} {`,
			'    fn validate_coherent_source_batch(&self) -> Result<(), ProtocolValidationError> {',
			`        if self.observations.len() + self.resets.len() > ${sourceBatchDescriptor(typeName).rustLimit} || self.resets.len() > 1 {`,
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "observations", "bounded single-reset source batch"));`,
			'        }',
			'        if matches!(self.health, SourceHealth::Failed) != self.terminal_error.is_some() || matches!(self.health, SourceHealth::Starting) {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "health", "terminal health/error consistency"));`,
			'        }',
			'        if self.observations.iter().any(|fact| fact.source_instance_id != self.source_instance_id) || self.resets.iter().any(|fact| fact.source_instance_id != self.source_instance_id) {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "source_instance_id", "matches every fact"));`,
			'        }',
			'        if self.observations.windows(2).any(|facts| facts[0].sequence >= facts[1].sequence) || self.resets.windows(2).any(|facts| facts[0].sequence >= facts[1].sequence) {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "observations", "strict sequence order"));`,
			'        }',
			'        let mut sequences: Vec<_> = self.observations.iter().map(|fact| fact.sequence).chain(self.resets.iter().map(|fact| fact.sequence)).collect();',
			'        sequences.sort_unstable();',
			'        if sequences.windows(2).any(|values| values[0] == values[1]) {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "observations", "unique cross-kind sequence"));`,
			'        }',
			'        let mut facts: Vec<_> = self.observations.iter().map(|fact| (fact.sequence, fact.gap.as_ref())).chain(self.resets.iter().map(|fact| (fact.sequence, fact.gap.as_ref()))).collect();',
			'        facts.sort_unstable_by_key(|fact| fact.0);',
			'        if facts.windows(2).any(|pair| pair[1].1.map_or(pair[1].0 != pair[0].0 + 1, |gap| gap.first_missing != pair[0].0 + 1)) {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "observations", "adjacent sequence or exact missing range"));`,
			'        }',
			'        if self.resets.first().is_some_and(|reset| self.observations.iter().any(|fact| fact.sequence <= reset.sequence)) {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "resets", "reset precedes observations"));`,
			'        }',
			'        Ok(())',
			'    }',
			'}',
			''
		],
		typescript: (typeName) =>
			`hasCoherentSourceBatch(value.source_instance_id, value.health, value.observations, value.resets, value.terminal_error, ${sourceBatchDescriptor(typeName).typescriptLimit}, ${sourceBatchDescriptor(typeName).typescriptValidator})`
	},
	coherent_candidate_window_state: {
		rust: (typeName) => [
			'        if matches!(self.presence, CandidateWindowPresence::Absent)',
			'            && (matches!(self.focus, CandidateWindowFocus::Focused)',
			'                || matches!(self.visibility, CandidateWindowVisibility::Visible)',
			'                || !matches!(self.placement, CandidateWindowPlacement::Unknown)',
			'                || self.bounds.is_some()',
			'                || self.display_target_id.is_some())',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "presence", "absent state has no present-window facts"));`,
			'        }',
			'        if matches!(self.focus, CandidateWindowFocus::Focused)',
			'            && (!matches!(self.presence, CandidateWindowPresence::Present)',
			'                || !matches!(self.visibility, CandidateWindowVisibility::Visible))',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "focus", "focused window is present and visible"));`,
			'        }',
			'        if (matches!(self.visibility, CandidateWindowVisibility::Visible)',
			'            || !matches!(self.placement, CandidateWindowPlacement::Unknown)',
			'            || self.bounds.is_some()',
			'            || self.display_target_id.is_some())',
			'            && !matches!(self.presence, CandidateWindowPresence::Present)',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "presence", "present-window facts require present window"));`,
			'        }',
			'        if matches!(self.certainty, CandidateWindowCertainty::Complete)',
			'            && match self.presence {',
			'                CandidateWindowPresence::Present => {',
			'                    matches!(self.focus, CandidateWindowFocus::Unknown)',
			'                        || matches!(self.visibility, CandidateWindowVisibility::Unknown)',
			'                        || matches!(self.placement, CandidateWindowPlacement::Unknown)',
			'                        || self.bounds.is_none()',
			'                        || self.display_target_id.is_none()',
			'                }',
			'                CandidateWindowPresence::Absent => {',
			'                    !matches!(self.focus, CandidateWindowFocus::NotFocused)',
			'                        || !matches!(self.visibility, CandidateWindowVisibility::NotVisible)',
			'                }',
			'                CandidateWindowPresence::Unknown => true,',
			'            }',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "certainty", "complete state contains every applicable fact"));`,
			'        }'
		],
		typescript: () => 'hasCoherentCandidateWindowState(value)'
	},
	coherent_candidate_window_host_event: {
		rust: (typeName) => [
			'        if matches!(self.kind, CandidateWindowHostEventKind::CloseAttempt) != self.window.is_none() {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "window", "state events carry state and close attempts do not"));`,
			'        }'
		],
		typescript: () => 'hasCoherentCandidateWindowHostEvent(value)'
	},
	coherent_capture_session_signal: {
		rust: (typeName) => [
			'        if matches!(self.support, CaptureSessionSupport::Unsupported)',
			'            && (!matches!(self.activity, CaptureSessionActivity::Unknown)',
			'                || !matches!(self.certainty, CaptureSessionCertainty::Unknown))',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "support", "unsupported signal has unknown activity and certainty"));`,
			'        }',
			'        if matches!(self.support, CaptureSessionSupport::Supported)',
			'            && matches!(self.certainty, CaptureSessionCertainty::Complete)',
			'            && matches!(self.activity, CaptureSessionActivity::Unknown)',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "activity", "complete supported signal has known activity"));`,
			'        }',
			'        if matches!(self.support, CaptureSessionSupport::Supported)',
			'            && matches!(self.certainty, CaptureSessionCertainty::Unknown)',
			'            && !matches!(self.activity, CaptureSessionActivity::Unknown)',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "certainty", "unknown certainty has unknown activity"));`,
			'        }'
		],
		typescript: () => 'hasCoherentCaptureSessionSignal(value)'
	},
	coherent_process_executable_identity: {
		rust: (typeName) => [
			'        let has_any_identity = self.signer_chain_id.is_some()',
			'            || self.publisher_id.is_some()',
			'            || self.product_id.is_some()',
			'            || self.signing_id.is_some()',
			'            || self.team_id.is_some()',
			'            || self.designated_requirement.is_some()',
			'            || self.bundle_id.is_some()',
			'            || self.package_id.is_some()',
			'            || self.version.is_some()',
			'            || self.digest_sha256.is_some();',
			'        let digest_is_valid = self.digest_sha256.as_ref().is_none_or(|digest| {',
			'            digest.len() == 64',
			'                && digest',
			'                    .bytes()',
			"                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))",
			'        });',
			'        let coherent = match self.status {',
			'            ProcessExecutableIdentityStatus::Pending | ProcessExecutableIdentityStatus::Unavailable => !has_any_identity,',
			'            ProcessExecutableIdentityStatus::Unsigned => self.digest_sha256.is_some()',
			'                && self.signer_chain_id.is_none()',
			'                && self.publisher_id.is_none()',
			'                && self.product_id.is_none()',
			'                && self.signing_id.is_none()',
			'                && self.team_id.is_none()',
			'                && self.designated_requirement.is_none()',
			'                && self.bundle_id.is_none()',
			'                && self.package_id.is_none()',
			'                && self.version.is_none(),',
			'            ProcessExecutableIdentityStatus::Verified => {',
			'                let windows_identity = self.signer_chain_id.is_some()',
			'                    && self.publisher_id.is_some()',
			'                    && self.product_id.is_some()',
			'                    && self.version.is_some()',
			'                    && self.signing_id.is_none()',
			'                    && self.team_id.is_none()',
			'                    && self.designated_requirement.is_none()',
			'                    && self.bundle_id.is_none()',
			'                    && self.package_id.is_none();',
			'                let macos_identity = self.signing_id.is_some()',
			'                    && self.team_id.is_some()',
			'                    && self.designated_requirement.is_some()',
			'                    && self.bundle_id.is_some()',
			'                    && self.version.is_some()',
			'                    && self.signer_chain_id.is_none()',
			'                    && self.publisher_id.is_none()',
			'                    && self.product_id.is_none()',
			'                    && self.package_id.is_none();',
			'                let linux_identity = self.package_id.is_some()',
			'                    && self.version.is_some()',
			'                    && self.digest_sha256.is_some()',
			'                    && self.signer_chain_id.is_none()',
			'                    && self.publisher_id.is_none()',
			'                    && self.product_id.is_none()',
			'                    && self.signing_id.is_none()',
			'                    && self.team_id.is_none()',
			'                    && self.designated_requirement.is_none()',
			'                    && self.bundle_id.is_none();',
			'                windows_identity || macos_identity || linux_identity',
			'            }',
			'        };',
			'        if !coherent || !digest_is_valid {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "status", "identity fields match one bounded platform form"));`,
			'        }'
		],
		typescript: () => 'hasCoherentProcessExecutableIdentity(value)'
	},
	coherent_process_application_state: {
		rust: (typeName) => [
			'        if matches!(self.coverage, ProcessApplicationCoverage::Unavailable)',
			'            && (!matches!(self.certainty, ProcessApplicationCertainty::Unknown)',
			'                || !self.processes.is_empty())',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "coverage", "unavailable coverage has unknown certainty and no inventory"));`,
			'        }'
		],
		typescript: () => 'hasCoherentProcessApplicationState(value)'
	},
	unique_process_instance_ids: {
		rust: (typeName) => [
			'        for (index, process) in self.processes.iter().enumerate() {',
			'            if self.processes[..index].iter().any(|existing| existing.process_instance_id == process.process_instance_id) {',
			`                return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "processes", "unique process_instance_id"));`,
			'            }',
			'        }'
		],
		typescript: () => 'hasUniqueProcessInstanceIds(value.processes)'
	},
	coherent_process_application_event: {
		rust: (typeName) => [
			'        let coherent = match self.kind {',
			'            ProcessApplicationEventKind::Reconciled => self.process_instance_id.is_none()',
			'                && self.process.is_none()',
			'                && self.state.is_some(),',
			'            ProcessApplicationEventKind::Exited => self.process_instance_id.is_some()',
			'                && self.process.is_none()',
			'                && self.state.is_none(),',
			'            ProcessApplicationEventKind::Started | ProcessApplicationEventKind::IdentityChanged => self',
			'                .process',
			'                .as_ref()',
			'                .zip(self.process_instance_id.as_ref())',
			'                .is_some_and(|(process, process_instance_id)| &process.process_instance_id == process_instance_id)',
			'                && self.state.is_none(),',
			'        };',
			'        if !coherent {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "process", "event payload matches kind and process_instance_id"));`,
			'        }'
		],
		typescript: () => 'hasCoherentProcessApplicationEvent(value)'
	},
	coherent_process_capture_time: {
		rust: (typeName) => [
			'        if self.event.capture_delay_ns.is_some_and(|delay| delay > self.observed_at.monotonic_time_ns) {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "event", "capture delay cannot precede the source time origin"));`,
			'        }'
		],
		typescript: () =>
			'isSourceTimestamp(value.observed_at) && hasCoherentProcessCaptureTime(value.event, value.observed_at.monotonic_time_ns)'
	},
	coherent_interactive_session_state: {
		rust: (typeName) => [
			'        if matches!(self.coverage, InteractiveSessionCoverage::Unavailable)',
			'            && (!matches!(self.certainty, InteractiveSessionCertainty::Unknown)',
			'                || !matches!(self.console_ownership, InteractiveConsoleOwnership::Unknown)',
			'                || !matches!(self.lock_state, InteractiveLockState::Unknown)',
			'                || !matches!(self.remote_attachment, InteractiveRemoteAttachment::Unknown)',
			'                || self.other_human_session_count != 0)',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "coverage", "unavailable coverage carries no session facts"));`,
			'        }',
			'        if matches!(self.certainty, InteractiveSessionCertainty::Complete)',
			'            && (matches!(self.console_ownership, InteractiveConsoleOwnership::Unknown)',
			'                || matches!(self.lock_state, InteractiveLockState::Unknown)',
			'                || matches!(self.remote_attachment, InteractiveRemoteAttachment::Unknown))',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "certainty", "complete state contains known session facts"));`,
			'        }'
		],
		typescript: () => 'hasCoherentInteractiveSessionState(value)'
	},
	coherent_clipboard_state: {
		rust: (typeName) => [
			'        if matches!(self.coverage, ClipboardCoverage::Unavailable)',
			'            && (!matches!(self.certainty, ClipboardCertainty::Unknown)',
			'                || self.change_generation != 0)',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "coverage", "unavailable coverage carries no clipboard fact"));`,
			'        }'
		],
		typescript: () => 'hasCoherentClipboardState(value)'
	},
	coherent_print_spooler_state: {
		rust: (typeName) => [
			'        if matches!(self.coverage, PrintSpoolerCoverage::Unavailable)',
			'            && (!matches!(self.certainty, PrintSpoolerCertainty::Unknown)',
			'                || self.candidate_job_count != 0',
			'                || self.other_job_count != 0',
			'                || self.unknown_job_count != 0)',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "coverage", "unavailable coverage carries no print jobs"));`,
			'        }',
			'        if matches!(self.certainty, PrintSpoolerCertainty::Complete)',
			'            && self.unknown_job_count != 0',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "certainty", "complete state has no unknown attribution"));`,
			'        }'
		],
		typescript: () => 'hasCoherentPrintSpoolerState(value)'
	},
	coherent_removable_storage_state: {
		rust: (typeName) => [
			'        if matches!(self.coverage, RemovableStorageCoverage::Unavailable)',
			'            && (!matches!(self.certainty, RemovableStorageCertainty::Unknown)',
			'                || !self.attached_functions.is_empty())',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "coverage", "unavailable coverage carries no storage inventory"));`,
			'        }',
			'        if matches!(self.coverage, RemovableStorageCoverage::BlockOnly)',
			'            && self.attached_functions.iter().any(|entry| !matches!(entry.kind, RemovableStorageFunctionKind::BlockStorage))',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "attached_functions", "block-only coverage carries only block storage"));`,
			'        }'
		],
		typescript: () => 'hasCoherentRemovableStorageState(value)'
	},
	unique_removable_storage_function_ids: {
		rust: (typeName) => [
			'        for (index, entry) in self.attached_functions.iter().enumerate() {',
			'            if self.attached_functions[..index].iter().any(|existing| existing.function_instance_id == entry.function_instance_id) {',
			`                return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "attached_functions", "unique function_instance_id"));`,
			'            }',
			'        }'
		],
		typescript: () => 'hasUniqueRemovableStorageFunctionIds(value.attached_functions)'
	},
	coherent_virtualization_state: {
		rust: (typeName) => [
			'        if matches!(self.coverage, VirtualizationCoverage::Unavailable)',
			'            && (!matches!(self.certainty, VirtualizationCertainty::Unknown)',
			'                || !matches!(self.classification, VirtualizationClassification::Unknown))',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "coverage", "unavailable coverage has unknown classification"));`,
			'        }'
		],
		typescript: () => 'hasCoherentVirtualizationState(value)'
	},
	coherent_network_configuration_state: {
		rust: (typeName) => [
			'        if matches!(self.coverage, NetworkConfigurationCoverage::Unavailable)',
			'            && (!matches!(self.certainty, NetworkConfigurationCertainty::Unknown)',
			'                || !matches!(self.system_proxy, NetworkActivityState::Unknown)',
			'                || !matches!(self.managed_vpn, NetworkActivityState::Unknown)',
			'                || !self.tunnel_interfaces.is_empty()',
			'                || self.route_generation != 0)',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "coverage", "unavailable coverage carries no network facts"));`,
			'        }',
			'        if matches!(self.coverage, NetworkConfigurationCoverage::FullConfiguration)',
			'            && matches!(self.certainty, NetworkConfigurationCertainty::Complete)',
			'            && (matches!(self.system_proxy, NetworkActivityState::Unknown)',
			'                || matches!(self.managed_vpn, NetworkActivityState::Unknown))',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "certainty", "complete full coverage contains known network states"));`,
			'        }'
		],
		typescript: () => 'hasCoherentNetworkConfigurationState(value)'
	},
	unique_network_tunnel_interface_ids: {
		rust: (typeName) => [
			'        for (index, entry) in self.tunnel_interfaces.iter().enumerate() {',
			'            if self.tunnel_interfaces[..index].iter().any(|existing| existing.interface_instance_id == entry.interface_instance_id) {',
			`                return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "tunnel_interfaces", "unique interface_instance_id"));`,
			'            }',
			'        }'
		],
		typescript: () => 'hasUniqueNetworkTunnelInterfaceIds(value.tunnel_interfaces)'
	},
	coherent_media_endpoint_state: {
		rust: (typeName) => [
			'        if matches!(self.coverage, MediaDeviceCoverage::NotCollected)',
			'            && (!matches!(self.certainty, MediaDeviceCertainty::Unknown)',
			'                || !matches!(self.permission, PermissionState::NotDetermined)',
			'                || !matches!(self.readiness, MediaEndpointReadiness::Unknown)',
			'                || self.endpoint_count != 0',
			'                || !matches!(self.other_application_use, MediaConcurrentUse::Unknown))',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "coverage", "not-collected coverage carries no media facts"));`,
			'        }',
			'        if matches!(self.coverage, MediaDeviceCoverage::Unavailable)',
			'            && (!matches!(self.certainty, MediaDeviceCertainty::Unknown)',
			'                || !matches!(self.permission, PermissionState::Unavailable)',
			'                || !matches!(self.readiness, MediaEndpointReadiness::Unknown)',
			'                || self.endpoint_count != 0',
			'                || !matches!(self.other_application_use, MediaConcurrentUse::Unknown))',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "coverage", "unavailable coverage carries no media facts"));`,
			'        }',
			'        if matches!(self.coverage, MediaDeviceCoverage::ReadinessOnly)',
			'            && !matches!(self.other_application_use, MediaConcurrentUse::Unknown)',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "other_application_use", "readiness-only coverage makes no concurrent-use claim"));`,
			'        }',
			'        if matches!(self.certainty, MediaDeviceCertainty::Complete)',
			'            && (matches!(self.readiness, MediaEndpointReadiness::Unknown)',
			'                || (matches!(self.coverage, MediaDeviceCoverage::ReadinessAndConcurrentUse)',
			'                    && matches!(self.other_application_use, MediaConcurrentUse::Unknown)))',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "certainty", "complete media coverage contains known applicable facts"));`,
			'        }'
		],
		typescript: () => 'hasCoherentMediaEndpointState(value)'
	},
	valid_helper_channel_nonce: {
		rust: (typeName) => [
			'        if self.channel_nonce.len() != 64',
			'            || !self.channel_nonce.bytes().all(|byte| {',
			'                byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()',
			'            })',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "channel_nonce", "64 lowercase hexadecimal characters"));`,
			'        }'
		],
		typescript: () => 'hasValidHelperChannelNonce(value)'
	},
	unique_helper_capabilities: {
		rust: (typeName) => [
			'        if self.capabilities.is_empty()',
			'            || self.capabilities.iter().enumerate().any(|(index, capability)| {',
			'                self.capabilities[..index].contains(capability)',
			'            })',
			'        {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "capabilities", "nonempty unique helper capabilities"));`,
			'        }'
		],
		typescript: () => 'hasUniqueHelperCapabilities(value)'
	},
	coherent_helper_source_open: {
		rust: (typeName) => [
			'        let matching = match self.source_kind {',
			'            HelperSourceKind::ProcessApplication => {',
			'                self.event_classes.len() == 2',
			'                    && self.event_classes.contains(&HelperEventClass::ProcessLifecycle)',
			'                    && self.event_classes.contains(&HelperEventClass::ProcessIdentity)',
			'            }',
			'            HelperSourceKind::InteractiveSession => {',
			'                self.event_classes.as_slice()',
			'                    == [HelperEventClass::InteractiveSessionLifecycle]',
			'            }',
			'        };',
			'        let schema_matches = match self.source_kind {',
			'            HelperSourceKind::ProcessApplication => {',
			'                self.schema_version == PROCESS_APPLICATION_SCHEMA_VERSION',
			'            }',
			'            HelperSourceKind::InteractiveSession => {',
			'                self.schema_version == INTERACTIVE_SESSION_SCHEMA_VERSION',
			'            }',
			'        };',
			'        if !matching || !schema_matches {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "event_classes", "complete coherent class set matches helper source"));`,
			'        }'
		],
		typescript: () => 'hasCoherentHelperSourceOpen(value)'
	},
	coherent_helper_source_snapshot: {
		rust: (typeName) => [
			'        let coherent = match self.source_kind {',
			'            HelperSourceKind::ProcessApplication => {',
			'                self.process_state.is_some() && self.interactive_session_state.is_none()',
			'            }',
			'            HelperSourceKind::InteractiveSession => {',
			'                self.process_state.is_none() && self.interactive_session_state.is_some()',
			'            }',
			'        };',
			'        let schema_matches = match self.source_kind {',
			'            HelperSourceKind::ProcessApplication => {',
			'                self.schema_version == PROCESS_APPLICATION_SCHEMA_VERSION',
			'            }',
			'            HelperSourceKind::InteractiveSession => {',
			'                self.schema_version == INTERACTIVE_SESSION_SCHEMA_VERSION',
			'            }',
			'        };',
			'        if !coherent || !schema_matches {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "source_kind", "exact matching source state"));`,
			'        }'
		],
		typescript: () => 'hasCoherentHelperSourceSnapshot(value)'
	},
	coherent_helper_source_failure: {
		rust: (typeName) => [
			'        let reports_loss = matches!(',
			'            self.failure_code,',
			'            HelperFailureCode::NativeEventLoss | HelperFailureCode::QueueOverflow',
			'        );',
			'        if reports_loss != self.lost_event_count.is_some() {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "lost_event_count", "present exactly for native loss or queue overflow"));`,
			'        }'
		],
		typescript: () => 'hasCoherentHelperSourceFailure(value)'
	},
	coherent_helper_observation: {
		rust: (typeName) => [
			'        let coherent = match self.source_kind {',
			'            HelperSourceKind::ProcessApplication => {',
			'                self.process_event.is_some() && self.interactive_session_event.is_none()',
			'            }',
			'            HelperSourceKind::InteractiveSession => {',
			'                self.process_event.is_none() && self.interactive_session_event.is_some()',
			'            }',
			'        };',
			'        if !coherent {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "source_kind", "exact matching event payload"));`,
			'        }',
			'        if self.process_event.as_ref().and_then(|event| event.capture_delay_ns).is_some_and(|delay| delay > self.monotonic_time_ns) {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "process_event", "capture delay cannot precede the source time origin"));`,
			'        }'
		],
		typescript: () => 'hasCoherentHelperObservation(value)'
	},
	coherent_helper_client_message: {
		rust: (typeName) => [
			'        let coherent = match self.kind {',
			'            HelperClientMessageKind::Open => {',
			'                self.open.is_some() && self.close.is_none()',
			'            }',
			'            HelperClientMessageKind::Close => {',
			'                self.open.is_none() && self.close.is_some()',
			'            }',
			'        };',
			'        if !coherent {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "kind", "exact discriminated client payload"));`,
			'        }'
		],
		typescript: () => 'hasCoherentHelperClientMessage(value)'
	},
	coherent_helper_server_message: {
		rust: (typeName) => [
			'        let coherent = match self.kind {',
			'            HelperServerMessageKind::Snapshot => {',
			'                self.snapshot.is_some()',
			'                    && self.observation.is_none()',
			'                    && self.failure.is_none()',
			'            }',
			'            HelperServerMessageKind::Observation => {',
			'                self.snapshot.is_none()',
			'                    && self.observation.is_some()',
			'                    && self.failure.is_none()',
			'            }',
			'            HelperServerMessageKind::Failure => {',
			'                self.snapshot.is_none()',
			'                    && self.observation.is_none()',
			'                    && self.failure.is_some()',
			'            }',
			'        };',
			'        if !coherent {',
			`            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "kind", "exact discriminated server payload"));`,
			'        }'
		],
		typescript: () => 'hasCoherentHelperServerMessage(value)'
	}
} satisfies Readonly<Record<SemanticRule, SemanticRuleEmitter>>;

function semanticRuleEmitter(rule: SemanticRule, typeName: string): SemanticRuleEmitter {
	const emitter: SemanticRuleEmitter | undefined = semanticRuleEmitters[rule];
	if (emitter === undefined)
		throw new Error(`Unsupported semantic rule on ${typeName}: ${String(rule)}`);
	return emitter;
}

function rustSemanticValidation(
	typeName: string,
	rules: NonNullable<Definition['x-proctor-rules']>
): string[] {
	return rules.flatMap((rule) => semanticRuleEmitter(rule, typeName).rust(typeName));
}

function rustSemanticHelpers(
	typeName: string,
	rules: NonNullable<Definition['x-proctor-rules']>
): string[] {
	return rules.flatMap(
		(rule) => semanticRuleEmitter(rule, typeName).rustHelpers?.(typeName) ?? []
	);
}

function typescriptSemanticValidation(
	typeName: string,
	rules: NonNullable<Definition['x-proctor-rules']>
): string[] {
	return rules.map((rule) => semanticRuleEmitter(rule, typeName).typescript(typeName));
}

type SourceBatchDescriptor = {
	readonly authority: string;
	readonly rustLimit: string;
	readonly typescriptLimit: string;
	readonly typescriptValidator: string;
};

const sourceBatchDescriptors: Readonly<Record<string, SourceBatchDescriptor>> = {
	DisplayTopologyDrain: {
		authority: DISPLAY_TOPOLOGY_AUTHORITY,
		rustLimit: 'MAX_DISPLAY_TOPOLOGY_FACTS',
		typescriptLimit: 'MAX_DISPLAY_TOPOLOGY_FACTS',
		typescriptValidator: 'isDisplayTopologyObservation'
	},
	...Object.fromEntries(
		CAPABILITY_DESCRIPTORS.map((descriptor) => [
			descriptor.drainType,
			{
				authority: descriptor.authority,
				rustLimit: descriptor.maximumFactsConstant,
				typescriptLimit: descriptor.maximumFactsConstant,
				typescriptValidator: descriptor.typescriptValidator
			}
		])
	)
};

function sourceBatchDescriptor(typeName: string): SourceBatchDescriptor {
	const descriptor: SourceBatchDescriptor | undefined =
		sourceBatchDescriptors[typeName as keyof typeof sourceBatchDescriptors];
	if (descriptor === undefined) throw new Error(`Unsupported source batch type ${typeName}`);
	return descriptor;
}

type PropertyKind = 'constant' | 'reference' | 'array' | 'string' | 'boolean' | 'integer';
type RustPropertyContext = {
	readonly typeName: string;
	readonly propertyName: string;
	readonly value: string;
	readonly valueIsReference: boolean;
};
type PropertyEmitter = {
	readonly rustType: (property: Property) => string;
	readonly typescriptType: (property: Property) => string;
	readonly rustValidation: (
		property: Property,
		context: RustPropertyContext
	) => readonly string[];
	readonly rustOptionalValidation?: (
		property: Property,
		context: RustPropertyContext
	) => readonly string[];
	readonly typescriptValidation: (property: Property, value: string) => string;
};

const propertyEmitters = {
	constant: {
		rustType: (property) => constantRustType(property),
		typescriptType: (property) => constantTypescriptType(property),
		rustValidation: (property, context) => {
			const constant = requiredConstant(property);
			return [
				`        if ${context.valueIsReference ? '*' : ''}${context.value} != ${rustLiteral(constant)} {`,
				`            ${rustValidationError(context, `const ${String(constant)}`)}`,
				'        }'
			];
		},
		typescriptValidation: (property, value) =>
			`${value} === ${JSON.stringify(requiredConstant(property))}`
	},
	reference: {
		rustType: (property) => referenceName(requiredReference(property)),
		typescriptType: (property) => referenceName(requiredReference(property)),
		rustValidation: (_property, context) => [`        ${context.value}.validate_protocol()?;`],
		typescriptValidation: (property, value) =>
			`is${referenceName(requiredReference(property))}(${value})`
	},
	array: {
		rustType: (property) => `Vec<${rustType(requiredItems(property))}>`,
		typescriptType: (property) => `readonly ${typescriptType(requiredItems(property))}[]`,
		rustValidation: (property, context) => {
			const lines: string[] = [];
			if (property.maxItems !== undefined) {
				lines.push(
					`        if ${context.value}.len() > ${rustNumber(property.maxItems)} {`
				);
				lines.push(
					`            ${rustValidationError(context, `maxItems ${property.maxItems}`)}`
				);
				lines.push('        }');
			}
			const items = requiredItems(property);
			if (propertyKind(items) === 'reference') {
				lines.push(
					`        for value in ${context.valueIsReference ? context.value : `&${context.value}`} {`
				);
				lines.push('            value.validate_protocol()?;');
				lines.push('        }');
			}
			return lines;
		},
		typescriptValidation: (property, value) => {
			const items = requiredItems(property);
			const maximum = property.maxItems ?? Number.MAX_SAFE_INTEGER;
			if (propertyKind(items) === 'reference')
				return `isBoundedArray(${value}, ${maximum}, is${referenceName(requiredReference(items))})`;
			return `isBoundedArray(${value}, ${maximum}, (item): item is ${typescriptType(items)} => ${typescriptValidation('item', items)})`;
		}
	},
	string: {
		rustType: () => 'String',
		typescriptType: () => 'string',
		rustValidation: (property, context) => {
			const minimum = property.minLength ?? 0;
			const maximum = property.maxLength ?? Number.MAX_SAFE_INTEGER;
			return [
				`        if !(${rustNumber(minimum)}..=${rustNumber(maximum)}).contains(&${context.value}.chars().count()) {`,
				`            ${rustValidationError(context, `length ${minimum}..=${maximum}`)}`,
				'        }'
			];
		},
		rustOptionalValidation: (property, context) => {
			const minimum = property.minLength ?? 0;
			const maximum = property.maxLength ?? Number.MAX_SAFE_INTEGER;
			return [
				`        if self.${context.propertyName}.as_ref().is_some_and(|value| !(${rustNumber(minimum)}..=${rustNumber(maximum)}).contains(&value.chars().count())) {`,
				`            ${rustValidationError(context, `length ${minimum}..=${maximum}`)}`,
				'        }'
			];
		},
		typescriptValidation: (property, value) =>
			`hasCodePointLength(${value}, ${property.minLength ?? 0}, ${property.maxLength ?? Number.MAX_SAFE_INTEGER})`
	},
	boolean: {
		rustType: () => 'bool',
		typescriptType: () => 'boolean',
		rustValidation: () => [],
		typescriptValidation: (_property, value) => `typeof ${value} === 'boolean'`
	},
	integer: {
		rustType: (property) => property['x-rust-type'] ?? 'i64',
		typescriptType: () => 'number',
		rustValidation: (property, context) => {
			const minimum = property.minimum ?? Number.MIN_SAFE_INTEGER;
			const maximum = property.maximum ?? Number.MAX_SAFE_INTEGER;
			return [
				`        if !(${rustNumber(minimum)}..=${rustNumber(maximum)}).contains(${context.valueIsReference ? context.value : `&${context.value}`}) {`,
				`            ${rustValidationError(context, `range ${minimum}..=${maximum}`)}`,
				'        }'
			];
		},
		rustOptionalValidation: (property, context) => {
			const minimum = property.minimum ?? Number.MIN_SAFE_INTEGER;
			const maximum = property.maximum ?? Number.MAX_SAFE_INTEGER;
			return [
				`        if self.${context.propertyName}.as_ref().is_some_and(|value| !(${rustNumber(minimum)}..=${rustNumber(maximum)}).contains(value)) {`,
				`            ${rustValidationError(context, `range ${minimum}..=${maximum}`)}`,
				'        }'
			];
		},
		typescriptValidation: (property, value) =>
			`isBoundedInteger(${value}, ${property.minimum ?? Number.MIN_SAFE_INTEGER}, ${property.maximum ?? Number.MAX_SAFE_INTEGER})`
	}
} satisfies Readonly<Record<PropertyKind, PropertyEmitter>>;

function rustValidation(
	typeName: string,
	propertyName: string,
	property: Property,
	required: boolean
): string[] {
	const context: RustPropertyContext = {
		typeName,
		propertyName,
		value: required ? `self.${propertyName}` : 'value',
		valueIsReference: !required
	};
	const emitter = propertyEmitter(property);
	if (!required && emitter.rustOptionalValidation !== undefined) {
		return [...emitter.rustOptionalValidation(property, context)];
	}
	const body = emitter.rustValidation(property, context);
	if (required || body.length === 0) return [...body];
	return [
		`        if let Some(value) = &self.${propertyName} {`,
		...body.map((line) => `    ${line}`),
		'        }'
	];
}

function typescriptValidation(value: string, property: Property): string {
	return propertyEmitter(property).typescriptValidation(property, value);
}

function rustType(property: Property): string {
	return propertyEmitter(property).rustType(property);
}

function typescriptType(property: Property): string {
	return propertyEmitter(property).typescriptType(property);
}

function propertyEmitter(property: Property): PropertyEmitter {
	return propertyEmitters[propertyKind(property)];
}

function propertyKind(property: Property): PropertyKind {
	if (property.const !== undefined) return 'constant';
	if (property.$ref !== undefined) return 'reference';
	if (property.type === 'array' && property.items !== undefined) return 'array';
	if (property.type === 'string') return 'string';
	if (property.type === 'boolean') return 'boolean';
	if (property.type === 'integer') return 'integer';
	throw new Error(`Unsupported schema property ${JSON.stringify(property)}`);
}

function rustValidationError(context: RustPropertyContext, rule: string): string {
	return `return Err(ProtocolValidationError::new(${JSON.stringify(context.typeName)}, ${JSON.stringify(context.propertyName)}, ${JSON.stringify(rule)}));`;
}

function requiredConstant(property: Property): string | number | boolean {
	if (property.const === undefined)
		throw new Error(`Schema constant is missing: ${JSON.stringify(property)}`);
	return property.const;
}

function requiredReference(property: Property): string {
	if (property.$ref === undefined)
		throw new Error(`Schema reference is missing: ${JSON.stringify(property)}`);
	return property.$ref;
}

function requiredItems(property: Property): Property {
	if (property.items === undefined)
		throw new Error(`Schema array items are missing: ${JSON.stringify(property)}`);
	return property.items;
}

function constantRustType(property: Property): string {
	const value = requiredConstant(property);
	if (typeof value === 'string') return 'String';
	if (typeof value === 'boolean') return 'bool';
	return property['x-rust-type'] ?? 'i64';
}

function constantTypescriptType(property: Property): string {
	return typeof requiredConstant(property);
}

function referenceName(reference: string): string {
	const prefix = '#/$defs/';
	if (reference.startsWith(prefix)) return reference.slice(prefix.length);
	const externalDefinition = reference.match(/#\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/u)?.[1];
	if (externalDefinition !== undefined) return externalDefinition;
	throw new Error(`Definition reference is not supported: ${reference}`);
}

function rustVariant(value: string): string {
	return value
		.split(/[_-]/u)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join('');
}

function rustNumber(value: number): string {
	const sign = value < 0 ? '-' : '';
	const digits = Math.abs(value).toString();
	return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '_')}`;
}

function rustLiteral(value: string | number | boolean): string {
	if (typeof value === 'number') return rustNumber(value);
	if (typeof value === 'boolean') return String(value);
	return JSON.stringify(value);
}

function sourceBatchFactLimit(
	definitions: Readonly<Record<string, Definition>>,
	typeName: string
): number {
	const descriptor = sourceBatchDescriptor(typeName);
	const observations = definitions[typeName]?.properties?.observations?.maxItems;
	const resets = definitions[typeName]?.properties?.resets?.maxItems;
	if (observations === undefined || resets === undefined || observations !== resets) {
		throw new Error(
			`${descriptor.authority} must declare one equal bound for ${typeName} observations and resets`
		);
	}
	return observations;
}

function mergeDefinitions(
	common: Readonly<Record<string, Definition>>,
	capability: Readonly<Record<string, Definition>>
): Readonly<Record<string, Definition>> {
	const duplicate = Object.keys(common).find((name) => Object.hasOwn(capability, name));
	if (duplicate !== undefined) {
		throw new Error(
			`Native protocol definition ${duplicate} is declared by more than one schema`
		);
	}
	return { ...common, ...capability };
}

function write(outputRoot: string, path: string, value: string): string {
	const destination = join(outputRoot, path);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, value, 'utf8');
	return destination;
}
