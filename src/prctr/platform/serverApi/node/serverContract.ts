/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Ajv2020, type AnySchema, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { serverContract } from './serverContract.generated.js';
import { ServerApiError, type ApiOperationId } from '../common/serverApi.js';
import type { components } from '../common/serverApi.generated.js';

/** A JSON Schema from the packaged contract. References name {@link schemaBase}. */
export interface ApiSchema {
	readonly $ref?: string;
	readonly type?: string | readonly string[];
	readonly format?: string;
	readonly properties?: Readonly<Record<string, ApiSchema>>;
	readonly required?: readonly string[];
	readonly items?: ApiSchema;
	readonly maxLength?: number;
	readonly minLength?: number;
	readonly [key: string]: unknown;
}
export interface ApiParameterContract {
	readonly name: string;
	readonly in: 'path' | 'query' | 'header';
	readonly required: boolean;
	readonly schema: ApiSchema;
	readonly style?: string;
	readonly explode?: boolean;
}
export interface ApiMediaContract {
	readonly schema?: ApiSchema;
	readonly encoding?: Readonly<Record<string, { readonly contentType?: string }>>;
}
export interface ApiOperationContract {
	readonly id: ApiOperationId;
	readonly method: string;
	readonly path: string;
	/** `x-proctor-auth`: `public`, `session`, `refresh_credential_required`, … */
	readonly auth: string;
	/** `x-proctor-idempotency`: `required` when the server deduplicates by Idempotency-Key. */
	readonly idempotency: string;
	readonly parameters: readonly ApiParameterContract[];
	readonly requestBody?: {
		readonly required: boolean;
		readonly content: Readonly<Record<string, ApiMediaContract>>;
	};
	/** Success responses by status; failures are always Problem Details. */
	readonly responses: Readonly<
		Record<string, { readonly content?: Readonly<Record<string, ApiMediaContract>> }>
	>;
	/** Every media type any response of the operation can carry, failures included. */
	readonly accept: readonly string[];
	/** JSON bodies of this operation carry signed or canonical integers and no decimals. */
	readonly strictIntegers: boolean;
}
/** The shape `server.api` generates; only this module reads it. */
export interface ApiRuntimeContract {
	readonly operations: Readonly<
		Record<string, Omit<ApiOperationContract, 'id' | 'strictIntegers'>>
	>;
	readonly schemas: Readonly<Record<string, ApiSchema>>;
}
export type ApiSchemaName = keyof components['schemas'];

const schemaBase = 'urn:proctor:api';
const schemaPrefix = `${schemaBase}#/components/schemas/`;

/**
 * Operations whose JSON is canonical or signed: integers must be spelled exactly and decimals are
 * refused. Named by operation, so a server route rename cannot silently relax the parse.
 */
const strictIntegerOperations: ReadonlySet<string> = new Set([
	'appendHistoricalBrowserDelivery',
	'appendNativeDelivery',
	'browserDeliveryReceipts',
	'browserSourceList',
	'browserSourceStatus',
	'declareBrowserDeliveryGaps',
	'declareNativeDeliveryGaps',
	'deliveryBudget',
	'listExamAttemptBrowserActivity',
	'nativeDeliveryReceipt',
	'nativeDeliveryStatus',
	'prepareSecurityPreflight',
	'recoverExamSecurityPolicy',
	'reportSecurityPreflight',
	'sealBrowserDelivery',
	'sealNativeDelivery',
	'stopDeliveryDetails',
	'updateBrowserDeliverySummary',
	'updateNativeDeliverySummary'
]);

const operations = new Map<string, ApiOperationContract>(
	Object.entries(serverContract.operations).map(([id, operation]) => [
		id,
		Object.freeze({
			...operation,
			id: id as ApiOperationId,
			strictIntegers: strictIntegerOperations.has(id)
		})
	])
);
for (const id of strictIntegerOperations)
	if (!operations.has(id)) throw new Error(`Unknown strict-integer operation ${id}`);

/** The packaged contract of one operation. An unknown ID is refused before anything is sent. */
export function operationContract(id: ApiOperationId): ApiOperationContract {
	const operation = operations.get(id);
	if (!operation) throw new ServerApiError('invalidRequest');
	return operation;
}
export function operationContracts(): Iterable<ApiOperationContract> {
	return operations.values();
}

/** Follows a schema reference to the named schema it points at. */
export function resolveSchema(schema: ApiSchema): ApiSchema {
	if (schema.$ref === undefined) return schema;
	if (!schema.$ref.startsWith(schemaPrefix))
		throw new Error('Only packaged schema references are allowed');
	const named = serverContract.schemas[schema.$ref.slice(schemaPrefix.length)];
	if (!named) throw new Error('Invalid packaged schema reference');
	return resolveSchema(named);
}
export function namedSchema(name: ApiSchemaName): ApiSchema {
	return { $ref: schemaPrefix + name };
}

/**
 * Validates a value against a packaged schema. A request is held to the exact schema. A response
 * tolerates additive fields: `additionalProperties: false` does not apply to what the server
 * sends, so a newer server can add a field without breaking this build.
 */
export function validateSchema(
	schema: ApiSchema,
	value: unknown,
	direction: 'request' | 'response' = 'request'
): void {
	if (!validator(schema, direction)(value))
		throw new ServerApiError(direction === 'response' ? 'invalidResponse' : 'invalidRequest');
}
export function validateNamedSchema(
	name: ApiSchemaName,
	value: unknown,
	direction: 'request' | 'response' = 'request'
): void {
	let schema = namedSchemas.get(name);
	if (!schema) namedSchemas.set(name, (schema = namedSchema(name)));
	validateSchema(schema, value, direction);
}
const namedSchemas = new Map<string, ApiSchema>();

function openSchema(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(openSchema);
	if (typeof schema !== 'object' || schema === null) return schema;
	return Object.fromEntries(
		Object.entries(schema)
			.filter(([key, value]) => !(key === 'additionalProperties' && value === false))
			.map(([key, value]) => [key, openSchema(value)])
	);
}
function createAjv(direction: 'request' | 'response'): Ajv2020 {
	const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: true });
	addFormats.default(ajv);
	ajv.addFormat('int64', { type: 'number', validate: Number.isSafeInteger });
	ajv.addFormat('binary', true);
	ajv.addFormat('password', true);
	const schemas =
		direction === 'response' ? openSchema(serverContract.schemas) : serverContract.schemas;
	ajv.addSchema({ $id: schemaBase, components: { schemas } });
	return ajv;
}
const compilers = {
	request: lazy(() => createAjv('request')),
	response: lazy(() => createAjv('response'))
};
const compiled = {
	request: new WeakMap<object, ValidateFunction>(),
	response: new WeakMap<object, ValidateFunction>()
};
function validator(schema: ApiSchema, direction: 'request' | 'response'): ValidateFunction {
	let validate = compiled[direction].get(schema);
	if (!validate) {
		const source = (direction === 'response' ? openSchema(schema) : schema) as AnySchema;
		validate = compilers[direction]().compile(source);
		compiled[direction].set(schema, validate);
	}
	return validate;
}
function lazy<T>(create: () => T): () => T {
	let value: T | undefined;
	return () => (value ??= create());
}
