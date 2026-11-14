import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Repository } from '../checks/types.ts';
import type { Generator } from './registry.ts';

const SCHEMA_INPUT = 'native/crates/prctr-protocol/schema/agent-protocol.schema.json';
const DIGEST_INPUT = 'native/crates/prctr-protocol/schema/agent-protocol.digest';
const OUTPUT = 'src/prctr/platform/native/common/nativeAgentProtocol.generated.ts';
const GENERATOR_ID = 'native.agent-protocol';

/** The JSON Schema keywords the Rust schema export uses. Any other keyword fails generation. */
const KNOWN_KEYWORDS = new Set([
	'$ref',
	'type',
	'properties',
	'required',
	'additionalProperties',
	'items',
	'enum',
	'const',
	'oneOf',
	'anyOf',
	'pattern',
	'minimum',
	'maximum',
	'description',
	'title'
]);

type Schema = { readonly [keyword: string]: unknown };

function asSchema(value: unknown, where: string): Schema {
	// `true` accepts any JSON value: a capability's own state, validated by its own schema.
	if (value === true) return {};
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${where}: expected a schema object`);
	}
	const schema = value as Schema;
	for (const keyword of Object.keys(schema)) {
		if (!KNOWN_KEYWORDS.has(keyword)) {
			throw new Error(`${where}: unsupported JSON Schema keyword ${keyword}`);
		}
	}
	return schema;
}

function refName(schema: Schema, where: string): string | undefined {
	const ref = schema.$ref;
	if (ref === undefined) return undefined;
	if (typeof ref !== 'string' || !ref.startsWith('#/$defs/')) {
		throw new Error(`${where}: unsupported $ref ${String(ref)}`);
	}
	return ref.slice('#/$defs/'.length);
}

function types(schema: Schema): readonly string[] {
	const type = schema.type;
	if (type === undefined) return [];
	return Array.isArray(type) ? (type as string[]) : [type as string];
}

/** The TypeScript type text of a schema. */
function typeText(schema: Schema, where: string): string {
	const name = refName(schema, where);
	if (name !== undefined) return name;
	if (schema.const !== undefined) return JSON.stringify(schema.const);
	if (Array.isArray(schema.enum))
		return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
	for (const keyword of ['oneOf', 'anyOf'] as const) {
		const options = schema[keyword];
		if (Array.isArray(options)) {
			return options
				.map(
					(option, index) =>
						`(${typeText(asSchema(option, `${where}.${keyword}[${index}]`), where)})`
				)
				.join(' | ');
		}
	}
	const [type, ...rest] = types(schema);
	if (rest.length > 0) throw new Error(`${where}: multiple types are not supported`);
	switch (type) {
		case undefined:
			return 'unknown';
		case 'string':
			return 'string';
		case 'integer':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'null':
			return 'null';
		case 'array':
			return `readonly (${typeText(asSchema(schema.items, `${where}.items`), where)})[]`;
		case 'object': {
			const properties = asProperties(schema, where);
			const required = new Set((schema.required as string[] | undefined) ?? []);
			const members = Object.entries(properties).map(
				([key, value]) =>
					`readonly ${key}${required.has(key) ? '' : '?'}: ${typeText(asSchema(value, `${where}.${key}`), where)}`
			);
			return `{ ${members.join('; ')} }`;
		}
		default:
			throw new Error(`${where}: unsupported type ${type}`);
	}
}

function asProperties(schema: Schema, where: string): Record<string, unknown> {
	const properties = schema.properties ?? {};
	if (typeof properties !== 'object' || properties === null) {
		throw new Error(`${where}: properties must be an object`);
	}
	if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
		throw new Error(`${where}: only additionalProperties false is supported`);
	}
	return properties as Record<string, unknown>;
}

/** A boolean expression that is true exactly when `value` is valid against `schema`. */
function check(schema: Schema, value: string, where: string, depth: number): string {
	const name = refName(schema, where);
	if (name !== undefined) return `is${name}(${value})`;
	const conditions: string[] = [];
	if (schema.const !== undefined) conditions.push(`${value} === ${JSON.stringify(schema.const)}`);
	if (Array.isArray(schema.enum)) {
		conditions.push(
			`(${schema.enum.map((option) => `${value} === ${JSON.stringify(option)}`).join(' || ')})`
		);
	}
	if (Array.isArray(schema.oneOf)) {
		const options = schema.oneOf.map((option, index) =>
			check(asSchema(option, `${where}.oneOf[${index}]`), value, where, depth)
		);
		conditions.push(
			`[${options.map((option) => `() => ${option}`).join(', ')}].filter((test) => test()).length === 1`
		);
	}
	if (Array.isArray(schema.anyOf)) {
		const options = schema.anyOf.map((option, index) =>
			check(asSchema(option, `${where}.anyOf[${index}]`), value, where, depth)
		);
		conditions.push(`(${options.join(' || ')})`);
	}
	const [type] = types(schema);
	switch (type) {
		case undefined:
			break;
		case 'string':
			conditions.push(`typeof ${value} === 'string'`);
			if (typeof schema.pattern === 'string') {
				conditions.push(`/${schema.pattern.replaceAll('/', '\\/')}/u.test(${value})`);
			}
			break;
		case 'integer': {
			const minimum =
				typeof schema.minimum === 'number' ? schema.minimum : Number.MIN_SAFE_INTEGER;
			const maximum =
				typeof schema.maximum === 'number' ? schema.maximum : Number.MAX_SAFE_INTEGER;
			conditions.push(`isBoundedInteger(${value}, ${minimum}, ${maximum})`);
			break;
		}
		case 'boolean':
			conditions.push(`typeof ${value} === 'boolean'`);
			break;
		case 'null':
			conditions.push(`${value} === null`);
			break;
		case 'array': {
			const item = `item${depth}`;
			const inner = check(asSchema(schema.items, `${where}.items`), item, where, depth + 1);
			conditions.push(
				`Array.isArray(${value}) && ${value}.every((${item}: unknown) => ${inner})`
			);
			break;
		}
		case 'object': {
			const properties = asProperties(schema, where);
			const required = new Set((schema.required as string[] | undefined) ?? []);
			const keys = Object.keys(properties);
			conditions.push(`isJsonObject(${value})`);
			conditions.push(`hasOnlyKeys(${value}, ${JSON.stringify(keys)})`);
			for (const [key, property] of Object.entries(properties)) {
				const field = `${value}[${JSON.stringify(key)}]`;
				const inner = check(asSchema(property, `${where}.${key}`), field, where, depth + 1);
				conditions.push(
					required.has(key)
						? `Object.hasOwn(${value}, ${JSON.stringify(key)}) && ${inner}`
						: `(!Object.hasOwn(${value}, ${JSON.stringify(key)}) || ${inner})`
				);
			}
			break;
		}
		default:
			throw new Error(`${where}: unsupported type ${type}`);
	}
	return conditions.length === 0 ? 'true' : `(${conditions.join(' && ')})`;
}

export function generateNativeAgentProtocol(schemaText: string, digest: string): string {
	const root = JSON.parse(schemaText) as { readonly $defs?: Record<string, unknown> };
	const definitions = root.$defs;
	if (typeof definitions !== 'object' || definitions === null)
		throw new Error('schema: missing $defs');
	if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error('digest: expected a SHA-256 hex digest');
	const names = Object.keys(definitions).sort();
	const lines = [
		`// @${'generated'} by ${GENERATOR_ID} from ${SCHEMA_INPUT} and ${DIGEST_INPUT}.`,
		'// Do not edit by hand. Regenerate the schema with `cargo run -p prctr-xtask -- generate`.',
		'',
		`export const NATIVE_AGENT_PROTOCOL_DIGEST = ${JSON.stringify(digest)};`,
		'',
		'type JsonObject = Record<string, unknown>;',
		'',
		'function isJsonObject(value: unknown): value is JsonObject {',
		"\treturn typeof value === 'object' && value !== null && !Array.isArray(value);",
		'}',
		'',
		'function hasOnlyKeys(value: JsonObject, keys: readonly string[]): boolean {',
		'\treturn Object.keys(value).every((key) => keys.includes(key));',
		'}',
		'',
		'function isBoundedInteger(value: unknown, minimum: number, maximum: number): boolean {',
		"\treturn typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;",
		'}',
		''
	];
	for (const name of names) {
		const schema = asSchema(definitions[name], name);
		const description = typeof schema.description === 'string' ? schema.description : undefined;
		if (description !== undefined) lines.push(`/** ${description.replaceAll('*/', '* /')} */`);
		lines.push(`export type ${name} = ${typeText(schema, name)};`, '');
		lines.push(
			`export function is${name}(value: unknown): value is ${name} {`,
			`\treturn ${check(schema, 'value', name, 0)};`,
			'}',
			''
		);
	}
	return `${lines.join('\n')}`;
}

export const nativeAgentProtocolGenerator: Generator = {
	id: GENERATOR_ID,
	inputs: [SCHEMA_INPUT, DIGEST_INPUT],
	committedOutputs: [OUTPUT],
	buildOutputs: [],
	generate(repository: Repository, outputRoot: string): void {
		const source = generateNativeAgentProtocol(
			repository.read(SCHEMA_INPUT),
			repository.read(DIGEST_INPUT).trim()
		);
		const path = join(outputRoot, OUTPUT);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, source);
	}
};
