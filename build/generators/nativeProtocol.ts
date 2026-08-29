import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Repository } from '../checks/types.ts';
import type { Generator } from './registry.ts';

const COMMON_AUTHORITY = 'native/schemas/native-observation.schema.json';
const DISPLAY_TOPOLOGY_AUTHORITY = 'native/schemas/display-topology.schema.json';
const CANDIDATE_WINDOW_AUTHORITY = 'native/schemas/candidate-window-state.schema.json';
const CAPTURE_SESSION_AUTHORITY = 'native/schemas/capture-session-state.schema.json';
const RUST_OUTPUT = 'native/crates/prctr-native-protocol/src/generated.rs';
const TYPESCRIPT_OUTPUT = 'src/prctr/platform/native/common/nativeObservation.generated.ts';
const GENERATED_MARKER = `// @${'generated'} by native.protocol from ${COMMON_AUTHORITY}, ${DISPLAY_TOPOLOGY_AUTHORITY}, ${CANDIDATE_WINDOW_AUTHORITY}, and ${CAPTURE_SESSION_AUTHORITY}.`;
const CANDIDATE_WINDOW_RUST_OUTPUT = 'native/crates/prctr-native-protocol/src/candidate_window.generated.rs';
const CANDIDATE_WINDOW_GENERATED_MARKER = `// @${'generated'} by candidate-window.protocol from ${COMMON_AUTHORITY} and ${CANDIDATE_WINDOW_AUTHORITY}.`;
const CAPTURE_SESSION_RUST_OUTPUT = 'native/crates/prctr-native-protocol/src/capture_session.generated.rs';
const CAPTURE_SESSION_GENERATED_MARKER = `// @${'generated'} by capture-session.protocol from ${COMMON_AUTHORITY} and ${CAPTURE_SESSION_AUTHORITY}.`;

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

type SemanticRule = 'ordered_sequence_gap' | 'unique_target_ids' | 'valid_mirror_references'
  | 'gap_ends_immediately_before_sequence' | 'coherent_source_batch'
  | 'coherent_candidate_window_state' | 'coherent_candidate_window_host_event'
  | 'coherent_capture_session_signal';

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
  inputs: [COMMON_AUTHORITY, DISPLAY_TOPOLOGY_AUTHORITY, CANDIDATE_WINDOW_AUTHORITY, CAPTURE_SESSION_AUTHORITY],
  committedOutputs: [RUST_OUTPUT, TYPESCRIPT_OUTPUT],
  buildOutputs: [],
  generate(repository: Repository, outputRoot: string): void {
    const schema = JSON.parse(repository.read(DISPLAY_TOPOLOGY_AUTHORITY)) as JsonSchema;
    const capabilityDefinitions = schema.$defs;
    if (capabilityDefinitions === undefined) throw new Error(`${DISPLAY_TOPOLOGY_AUTHORITY} must define $defs`);
    const commonSchema = JSON.parse(repository.read(COMMON_AUTHORITY)) as JsonSchema;
    const commonDefinitions = commonSchema.$defs;
    if (commonDefinitions === undefined) throw new Error(`${COMMON_AUTHORITY} must define $defs`);
    const definitions = mergeDefinitions(commonDefinitions, capabilityDefinitions);
    const candidateWindowSchema = JSON.parse(
      repository.read(CANDIDATE_WINDOW_AUTHORITY)
    ) as JsonSchema;
    const candidateWindowDefinitions = candidateWindowSchema.$defs;
    if (candidateWindowDefinitions === undefined) {
      throw new Error(`${CANDIDATE_WINDOW_AUTHORITY} must define $defs`);
    }
    const captureSessionSchema = JSON.parse(repository.read(CAPTURE_SESSION_AUTHORITY)) as JsonSchema;
    const captureSessionDefinitions = captureSessionSchema.$defs;
    if (captureSessionDefinitions === undefined) {
      throw new Error(`${CAPTURE_SESSION_AUTHORITY} must define $defs`);
    }
    const schemaVersion = schema.properties?.schema_version?.const;
    if (typeof schemaVersion !== 'number') throw new Error(`${DISPLAY_TOPOLOGY_AUTHORITY} must declare numeric schema_version const`);
    const candidateWindowSchemaVersion = candidateWindowSchema.properties?.schema_version?.const;
    if (typeof candidateWindowSchemaVersion !== 'number') {
      throw new Error(`${CANDIDATE_WINDOW_AUTHORITY} must declare numeric schema_version const`);
    }
    const captureSessionSchemaVersion = captureSessionSchema.properties?.schema_version?.const;
    if (typeof captureSessionSchemaVersion !== 'number') {
      throw new Error(`${CAPTURE_SESSION_AUTHORITY} must declare numeric schema_version const`);
    }
    const sourceManifest = requiredSourceManifest(commonSchema, new Map([
      ['display-topology', schemaVersion],
      ['candidate-window', candidateWindowSchemaVersion],
      ['capture-session', captureSessionSchemaVersion]
    ]));
    const sourceManifestVersion = requiredSourceManifestVersion(commonSchema);
    const sourceLifecycleDeadlineMs = requiredSourceLifecycleDeadline(commonSchema);
    const rustOutput = write(
      outputRoot,
      RUST_OUTPUT,
      renderRust(
        definitions,
        schemaVersion,
        sourceManifest,
        sourceManifestVersion,
        sourceLifecycleDeadlineMs
      )
    );
    execFileSync('rustfmt', ['--edition', '2024', rustOutput]);
    write(
      outputRoot,
      TYPESCRIPT_OUTPUT,
      renderTypeScript(
        mergeDefinitions(
          mergeDefinitions(definitions, candidateWindowDefinitions),
          captureSessionDefinitions
        ),
        sourceManifest,
        sourceManifestVersion,
        sourceLifecycleDeadlineMs
      )
    );
  }
};

export const candidateWindowProtocolGenerator: Generator = {
  id: 'candidate-window.protocol',
  inputs: [COMMON_AUTHORITY, CANDIDATE_WINDOW_AUTHORITY],
  committedOutputs: [CANDIDATE_WINDOW_RUST_OUTPUT],
  buildOutputs: [],
  generate(repository: Repository, outputRoot: string): void {
    const schema = JSON.parse(repository.read(CANDIDATE_WINDOW_AUTHORITY)) as JsonSchema;
    const definitions = schema.$defs;
    if (definitions === undefined) throw new Error(`${CANDIDATE_WINDOW_AUTHORITY} must define $defs`);
    const schemaVersion = schema.properties?.schema_version?.const;
    if (typeof schemaVersion !== 'number') {
      throw new Error(`${CANDIDATE_WINDOW_AUTHORITY} must declare numeric schema_version const`);
    }
    const rustOutput = write(
      outputRoot,
      CANDIDATE_WINDOW_RUST_OUTPUT,
      renderCapabilityRust(
        definitions,
        schemaVersion,
        CANDIDATE_WINDOW_GENERATED_MARKER,
        'CandidateWindowDrain',
        'CANDIDATE_WINDOW_SCHEMA_VERSION',
        'MAX_CANDIDATE_WINDOW_FACTS'
      )
    );
    execFileSync('rustfmt', ['--edition', '2024', rustOutput]);
  }
};

export const captureSessionProtocolGenerator: Generator = {
  id: 'capture-session.protocol',
  inputs: [COMMON_AUTHORITY, CAPTURE_SESSION_AUTHORITY],
  committedOutputs: [CAPTURE_SESSION_RUST_OUTPUT],
  buildOutputs: [],
  generate(repository: Repository, outputRoot: string): void {
    const schema = JSON.parse(repository.read(CAPTURE_SESSION_AUTHORITY)) as JsonSchema;
    const definitions = schema.$defs;
    if (definitions === undefined) throw new Error(`${CAPTURE_SESSION_AUTHORITY} must define $defs`);
    const schemaVersion = schema.properties?.schema_version?.const;
    if (typeof schemaVersion !== 'number') {
      throw new Error(`${CAPTURE_SESSION_AUTHORITY} must declare numeric schema_version const`);
    }
    const rustOutput = write(
      outputRoot,
      CAPTURE_SESSION_RUST_OUTPUT,
      renderCapabilityRust(
        definitions,
        schemaVersion,
        CAPTURE_SESSION_GENERATED_MARKER,
        'CaptureSessionDrain',
        'CAPTURE_SESSION_SCHEMA_VERSION',
        'MAX_CAPTURE_SESSION_FACTS'
      )
    );
    execFileSync('rustfmt', ['--edition', '2024', rustOutput]);
  }
};

function renderRust(
  definitions: Readonly<Record<string, Definition>>,
  schemaVersion: number,
  sourceManifest: readonly SourceManifestEntry[],
  sourceManifestVersion: number,
  sourceLifecycleDeadlineMs: number
): string {
  const maximumTargets = definitions.DisplayTopologySnapshot?.properties?.targets?.maxItems;
  if (maximumTargets === undefined) throw new Error(`${DISPLAY_TOPOLOGY_AUTHORITY} must bound DisplayTopologySnapshot.targets`);
  const maximumFacts = sourceBatchFactLimit(definitions, 'DisplayTopologyDrain');
  const maximumTimestamp = definitions.SourceTimestamp?.properties?.monotonic_time_ns?.maximum;
  if (maximumTimestamp === undefined) throw new Error(`${DISPLAY_TOPOLOGY_AUTHORITY} must bound SourceTimestamp.monotonic_time_ns`);
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
    ...sourceManifest.map(entry => [
      '    NativeSourceManifestEntry {',
      `        source_id: ${JSON.stringify(entry.source_id)},`,
      `        schema_version: ${rustNumber(entry.schema_version)},`,
      '    },'
    ]).flat(),
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
    '',
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
    '',
  ];
  lines.push(...renderRustDefinitions(definitions));
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderRustDefinitions(definitions: Readonly<Record<string, Definition>>): string[] {
  const lines: string[] = [];
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.type === 'string' && definition.enum !== undefined) {
      lines.push(
        '#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]',
        '#[serde(rename_all = "snake_case")]',
        `pub enum ${name} {`
      );
      for (const value of definition.enum) lines.push(`    ${rustVariant(value)},`);
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
      const booleanCount = Object.values(definition.properties)
        .filter(property => property.type === 'boolean').length;
      if (booleanCount > 3) {
        lines.push('// These independent mechanical facts are intentionally not one state machine.');
        lines.push('#[allow(clippy::struct_excessive_bools)]');
      }
      lines.push(
        '#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]',
        `pub struct ${name} {`
      );
      for (const [propertyName, property] of Object.entries(definition.properties)) {
        const type = rustType(property);
        if (!required.has(propertyName)) {
          lines.push('    #[serde(skip_serializing_if = "Option::is_none")]');
        }
        if (property['x-rust-type'] === 'u64') {
          lines.push('    #[serde(');
          lines.push('        serialize_with = "crate::serialize_protocol_safe_u64",');
          lines.push('        deserialize_with = "crate::deserialize_protocol_safe_u64"');
          lines.push('    )]');
        }
        lines.push(`    pub ${propertyName}: ${required.has(propertyName) ? type : `Option<${type}>`},`);
      }
      lines.push('}', '');
      lines.push(`impl ProtocolValidatable for ${name} {`);
      lines.push('    fn validate_protocol(&self) -> Result<(), ProtocolValidationError> {');
      for (const [propertyName, property] of Object.entries(definition.properties)) {
        lines.push(...rustValidation(name, propertyName, property, required.has(propertyName)));
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
  sourceLifecycleDeadlineMs: number
): string {
  const maximumTargets = definitions.DisplayTopologySnapshot?.properties?.targets?.maxItems;
  if (maximumTargets === undefined) throw new Error(`${DISPLAY_TOPOLOGY_AUTHORITY} must bound DisplayTopologySnapshot.targets`);
  const maximumDisplayFacts = sourceBatchFactLimit(definitions, 'DisplayTopologyDrain');
  const maximumCandidateWindowFacts = sourceBatchFactLimit(definitions, 'CandidateWindowDrain');
  const maximumCaptureSessionFacts = sourceBatchFactLimit(definitions, 'CaptureSessionDrain');
  const lines = [
    GENERATED_MARKER,
    '// Do not edit by hand.',
    '',
    `export const NATIVE_SOURCE_MANIFEST = ${JSON.stringify(sourceManifest)} as const;`,
    'export type NativeSourceManifest = typeof NATIVE_SOURCE_MANIFEST;',
    `export const NATIVE_SOURCE_MANIFEST_VERSION = ${sourceManifestVersion};`,
    `export const NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS = ${sourceLifecycleDeadlineMs};`,
    '',
    `const MAX_DISPLAY_TOPOLOGY_FACTS = ${maximumDisplayFacts};`,
    `const MAX_CANDIDATE_WINDOW_FACTS = ${maximumCandidateWindowFacts};`,
    `const MAX_CAPTURE_SESSION_FACTS = ${maximumCaptureSessionFacts};`,
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
    '  if (typeof sourceInstanceId !== \'string\' || !Array.isArray(observations) || !Array.isArray(resets)) return false;',
    '  if (observations.length + resets.length > maximumFacts || resets.length > 1) return false;',
    '  if ((health === \'failed\') !== (terminalError !== undefined) || health === \'starting\') return false;',
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
    "    || value.bounds !== undefined || value.display_target_id !== undefined)",
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
      throw new Error(`${COMMON_AUTHORITY} source manifest entry ${index} has an invalid source_id`);
    }
    if (sourceIds.has(sourceId)) {
      throw new Error(`${COMMON_AUTHORITY} source manifest repeats ${sourceId}`);
    }
    const schemaVersion = schemaVersions.get(sourceId);
    if (schemaVersion === undefined) {
      throw new Error(`${COMMON_AUTHORITY} source manifest names unsupported source ${sourceId}`);
    }
    sourceIds.add(sourceId);
    return { source_id: sourceId, schema_version: schemaVersion };
  });
  if (sourceIds.size !== schemaVersions.size) {
    throw new Error(`${COMMON_AUTHORITY} source manifest must name every generated source exactly once`);
  }
  return result;
}

function requiredSourceLifecycleDeadline(schema: JsonSchema): number {
  const deadline = schema['x-proctor-source-lifecycle-deadline-ms'];
  if (typeof deadline !== 'number' || !Number.isSafeInteger(deadline)
    || deadline < 1 || deadline > 60_000) {
    throw new Error(
      `${COMMON_AUTHORITY} must declare a bounded x-proctor-source-lifecycle-deadline-ms`
    );
  }
  return deadline;
}

function requiredSourceManifestVersion(schema: JsonSchema): number {
  const version = schema['x-proctor-source-manifest-version'];
  if (typeof version !== 'number' || !Number.isInteger(version)
    || version < 1 || version > 65_535) {
    throw new Error(`${COMMON_AUTHORITY} must declare a bounded x-proctor-source-manifest-version`);
  }
  return version;
}

function renderTypeScriptDefinitions(
  definitions: Readonly<Record<string, Definition>>
): string[] {
  const lines: string[] = [];
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.type === 'string' && definition.enum !== undefined) {
      lines.push(`export type ${name} = ${definition.enum.map(value => JSON.stringify(value)).join(' | ')};`);
      lines.push('');
      lines.push(`export function is${name}(value: unknown): value is ${name} {`);
      lines.push(`  return ${definition.enum.map(value => `value === ${JSON.stringify(value)}`).join(' || ')};`);
      lines.push('}', '');
      continue;
    }
    if (definition.type === 'object' && definition.properties !== undefined) {
      const required = new Set(definition.required ?? []);
      lines.push(`export interface ${name} {`);
      for (const [propertyName, property] of Object.entries(definition.properties)) {
        lines.push(`  readonly ${propertyName}${required.has(propertyName) ? '' : '?'}: ${typescriptType(property)};`);
      }
      lines.push('}', '');
      const propertyNames = Object.keys(definition.properties);
      lines.push(`export function is${name}(value: unknown): value is ${name} {`);
      lines.push('  return isJsonObject(value)');
      if (definition.additionalProperties === false) {
        lines.push(`    && hasOnlyKeys(value, [${propertyNames.map(value => JSON.stringify(value)).join(', ')}])`);
      }
      for (const [propertyName, property] of Object.entries(definition.properties)) {
        const validation = typescriptValidation(`value.${propertyName}`, property);
        lines.push(`    && ${required.has(propertyName) ? `Object.hasOwn(value, ${JSON.stringify(propertyName)}) && ${validation}` : `(!Object.hasOwn(value, ${JSON.stringify(propertyName)}) || ${validation})`}`);
      }
      for (const validation of typescriptSemanticValidation(name, definition['x-proctor-rules'] ?? [])) {
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
    rust: typeName => [
      '        if self.first_missing > self.last_missing {',
      `            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "last_missing", "not before first_missing"));`,
      '        }'
    ],
    typescript: () => 'value.first_missing <= value.last_missing'
  },
  unique_target_ids: {
    rust: typeName => [
      '        for (index, target) in self.targets.iter().enumerate() {',
      '            if self.targets[..index].iter().any(|existing| existing.target_id == target.target_id) {',
      `                return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "targets", "unique target_id"));`,
      '            }',
      '        }'
    ],
    typescript: () => 'hasUniqueDisplayTargetIds(value.targets)'
  },
  valid_mirror_references: {
    rust: typeName => [
      '        for target in &self.targets {',
      '            if target.mirror_primary_id.as_ref().is_some_and(|primary| primary == &target.target_id || !self.targets.iter().any(|candidate| &candidate.target_id == primary)) {',
      `                return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "targets", "valid mirror_primary_id"));`,
      '            }',
      '        }'
    ],
    typescript: () => 'hasValidMirrorReferences(value.targets)'
  },
  gap_ends_immediately_before_sequence: {
    rust: typeName => [
      '        if self.gap.as_ref().is_some_and(|gap| gap.last_missing != self.sequence - 1) {',
      `            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "gap", "last_missing immediately before sequence"));`,
      '        }'
    ],
    typescript: () => 'gapEndsImmediatelyBeforeSequence(value.gap, value.sequence)'
  },
  coherent_source_batch: {
    rust: () => ['        self.validate_coherent_source_batch()?;'],
    rustHelpers: typeName => [
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
    typescript: typeName => `hasCoherentSourceBatch(value.source_instance_id, value.health, value.observations, value.resets, value.terminal_error, ${sourceBatchDescriptor(typeName).typescriptLimit}, ${sourceBatchDescriptor(typeName).typescriptValidator})`
  },
  coherent_candidate_window_state: {
    rust: typeName => [
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
    rust: typeName => [
      '        if matches!(self.kind, CandidateWindowHostEventKind::CloseAttempt) != self.window.is_none() {',
      `            return Err(ProtocolValidationError::new(${JSON.stringify(typeName)}, "window", "state events carry state and close attempts do not"));`,
      '        }'
    ],
    typescript: () => 'hasCoherentCandidateWindowHostEvent(value)'
  },
  coherent_capture_session_signal: {
    rust: typeName => [
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
  }
} satisfies Readonly<Record<SemanticRule, SemanticRuleEmitter>>;

function semanticRuleEmitter(rule: SemanticRule, typeName: string): SemanticRuleEmitter {
  const emitter: SemanticRuleEmitter | undefined = semanticRuleEmitters[rule];
  if (emitter === undefined) throw new Error(`Unsupported semantic rule on ${typeName}: ${String(rule)}`);
  return emitter;
}

function rustSemanticValidation(typeName: string, rules: NonNullable<Definition['x-proctor-rules']>): string[] {
  return rules.flatMap(rule => semanticRuleEmitter(rule, typeName).rust(typeName));
}

function rustSemanticHelpers(typeName: string, rules: NonNullable<Definition['x-proctor-rules']>): string[] {
  return rules.flatMap(rule => semanticRuleEmitter(rule, typeName).rustHelpers?.(typeName) ?? []);
}

function typescriptSemanticValidation(typeName: string, rules: NonNullable<Definition['x-proctor-rules']>): string[] {
  return rules.map(rule => semanticRuleEmitter(rule, typeName).typescript(typeName));
}

type SourceBatchDescriptor = {
  readonly authority: string;
  readonly rustLimit: string;
  readonly typescriptLimit: string;
  readonly typescriptValidator: string;
};

const sourceBatchDescriptors = {
  DisplayTopologyDrain: {
    authority: DISPLAY_TOPOLOGY_AUTHORITY,
    rustLimit: 'MAX_DISPLAY_TOPOLOGY_FACTS',
    typescriptLimit: 'MAX_DISPLAY_TOPOLOGY_FACTS',
    typescriptValidator: 'isDisplayTopologyObservation'
  },
  CandidateWindowDrain: {
    authority: CANDIDATE_WINDOW_AUTHORITY,
    rustLimit: 'MAX_CANDIDATE_WINDOW_FACTS',
    typescriptLimit: 'MAX_CANDIDATE_WINDOW_FACTS',
    typescriptValidator: 'isCandidateWindowObservation'
  },
  CaptureSessionDrain: {
    authority: CAPTURE_SESSION_AUTHORITY,
    rustLimit: 'MAX_CAPTURE_SESSION_FACTS',
    typescriptLimit: 'MAX_CAPTURE_SESSION_FACTS',
    typescriptValidator: 'isCaptureSessionObservation'
  }
} satisfies Readonly<Record<string, SourceBatchDescriptor>>;

function sourceBatchDescriptor(typeName: string): SourceBatchDescriptor {
  const descriptor: SourceBatchDescriptor | undefined = sourceBatchDescriptors[
    typeName as keyof typeof sourceBatchDescriptors
  ];
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
  readonly rustValidation: (property: Property, context: RustPropertyContext) => readonly string[];
  readonly rustOptionalValidation?: (property: Property, context: RustPropertyContext) => readonly string[];
  readonly typescriptValidation: (property: Property, value: string) => string;
};

const propertyEmitters = {
  constant: {
    rustType: property => constantRustType(property),
    typescriptType: property => constantTypescriptType(property),
    rustValidation: (property, context) => {
      const constant = requiredConstant(property);
      return [
        `        if ${context.valueIsReference ? '*' : ''}${context.value} != ${rustLiteral(constant)} {`,
        `            ${rustValidationError(context, `const ${String(constant)}`)}`,
        '        }'
      ];
    },
    typescriptValidation: (property, value) => `${value} === ${JSON.stringify(requiredConstant(property))}`
  },
  reference: {
    rustType: property => referenceName(requiredReference(property)),
    typescriptType: property => referenceName(requiredReference(property)),
    rustValidation: (_property, context) => [`        ${context.value}.validate_protocol()?;`],
    typescriptValidation: (property, value) => `is${referenceName(requiredReference(property))}(${value})`
  },
  array: {
    rustType: property => `Vec<${rustType(requiredItems(property))}>`,
    typescriptType: property => `readonly ${typescriptType(requiredItems(property))}[]`,
    rustValidation: (property, context) => {
      const lines: string[] = [];
      if (property.maxItems !== undefined) {
        lines.push(`        if ${context.value}.len() > ${rustNumber(property.maxItems)} {`);
        lines.push(`            ${rustValidationError(context, `maxItems ${property.maxItems}`)}`);
        lines.push('        }');
      }
      const items = requiredItems(property);
      if (propertyKind(items) === 'reference') {
        lines.push(`        for value in ${context.valueIsReference ? context.value : `&${context.value}`} {`);
        lines.push('            value.validate_protocol()?;');
        lines.push('        }');
      }
      return lines;
    },
    typescriptValidation: (property, value) => {
      const items = requiredItems(property);
      const maximum = property.maxItems ?? Number.MAX_SAFE_INTEGER;
      if (propertyKind(items) === 'reference') return `isBoundedArray(${value}, ${maximum}, is${referenceName(requiredReference(items))})`;
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
    typescriptValidation: (property, value) => `hasCodePointLength(${value}, ${property.minLength ?? 0}, ${property.maxLength ?? Number.MAX_SAFE_INTEGER})`
  },
  boolean: {
    rustType: () => 'bool',
    typescriptType: () => 'boolean',
    rustValidation: () => [],
    typescriptValidation: (_property, value) => `typeof ${value} === 'boolean'`
  },
  integer: {
    rustType: property => property['x-rust-type'] ?? 'i64',
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
    typescriptValidation: (property, value) => `isBoundedInteger(${value}, ${property.minimum ?? Number.MIN_SAFE_INTEGER}, ${property.maximum ?? Number.MAX_SAFE_INTEGER})`
  }
} satisfies Readonly<Record<PropertyKind, PropertyEmitter>>;

function rustValidation(typeName: string, propertyName: string, property: Property, required: boolean): string[] {
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
    ...body.map(line => `    ${line}`),
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
  if (property.const === undefined) throw new Error(`Schema constant is missing: ${JSON.stringify(property)}`);
  return property.const;
}

function requiredReference(property: Property): string {
  if (property.$ref === undefined) throw new Error(`Schema reference is missing: ${JSON.stringify(property)}`);
  return property.$ref;
}

function requiredItems(property: Property): Property {
  if (property.items === undefined) throw new Error(`Schema array items are missing: ${JSON.stringify(property)}`);
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
  return value.split('_').map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('');
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

function sourceBatchFactLimit(definitions: Readonly<Record<string, Definition>>, typeName: string): number {
  const descriptor = sourceBatchDescriptor(typeName);
  const observations = definitions[typeName]?.properties?.observations?.maxItems;
  const resets = definitions[typeName]?.properties?.resets?.maxItems;
  if (observations === undefined || resets === undefined || observations !== resets) {
    throw new Error(`${descriptor.authority} must declare one equal bound for ${typeName} observations and resets`);
  }
  return observations;
}

function mergeDefinitions(
  common: Readonly<Record<string, Definition>>,
  capability: Readonly<Record<string, Definition>>
): Readonly<Record<string, Definition>> {
  const duplicate = Object.keys(common).find(name => Object.hasOwn(capability, name));
  if (duplicate !== undefined) {
    throw new Error(`Native protocol definition ${duplicate} is declared by more than one schema`);
  }
  return { ...common, ...capability };
}

function write(outputRoot: string, path: string, value: string): string {
  const destination = join(outputRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, value, 'utf8');
  return destination;
}
