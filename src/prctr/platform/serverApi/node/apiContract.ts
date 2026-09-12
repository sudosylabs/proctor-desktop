import { Ajv2020, type AnySchema, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { serverContract } from './serverContract.generated.js';
import { ServerApiError, type ApiOperationId } from '../common/serverApi.js';

export interface ApiSchema {
	readonly $ref?: string;
	readonly type?: string | readonly string[];
	readonly format?: string;
	readonly properties?: Readonly<Record<string, ApiSchema>>;
	readonly required?: readonly string[];
	readonly items?: ApiSchema;
	readonly [key: string]: unknown;
}
interface Reference {
	readonly $ref?: string;
}
export interface ApiParameter extends Reference {
	readonly name: string;
	readonly in: string;
	readonly required?: boolean;
	readonly schema: ApiSchema;
	readonly style?: string;
	readonly explode?: boolean;
}
export interface ApiMedia {
	readonly schema?: ApiSchema;
	readonly encoding?: Readonly<Record<string, { readonly contentType?: string }>>;
}
export interface ApiBody extends Reference {
	readonly required?: boolean;
	readonly content?: Readonly<Record<string, ApiMedia>>;
}
export interface ApiOperation {
	readonly operationId: ApiOperationId;
	readonly path: string;
	readonly method: string;
	readonly parameters?: readonly ApiParameter[];
	readonly requestBody?: ApiBody;
	readonly responses: Readonly<Record<string, ApiBody>>;
	readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
	readonly 'x-proctor-auth'?: string;
	readonly 'x-proctor-idempotency'?: string;
}
export interface ApiDocument {
	readonly paths: Readonly<
		Record<string, Readonly<Record<string, Omit<ApiOperation, 'path' | 'method'>>>>
	>;
	readonly components: {
		readonly schemas: Readonly<Record<string, ApiSchema>>;
		readonly [key: string]: unknown;
	};
}
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
export const apiOperations: ReadonlyMap<ApiOperationId, ApiOperation> = new Map(
	Object.entries(serverContract.paths).flatMap(([path, item]) =>
		Object.entries(item)
			.filter(([method]) => methods.has(method))
			.map(
				([method, operation]) =>
					[
						operation.operationId,
						{
							...operation,
							path,
							method: method.toUpperCase(),
							parameters: [
								...new Map(
									[
										...(Array.isArray(item.parameters)
											? (item.parameters as unknown as readonly ApiParameter[])
											: []),
										...(operation.parameters ?? [])
									]
										.map(resolveContract)
										.map((parameter) => [
											`${parameter.in}:${parameter.name}`,
											parameter
										])
								).values()
							]
						}
					] as const
			)
	)
);

export function resolveContract<T extends Reference>(value: T): T {
	if (!value.$ref) return value;
	if (!value.$ref.startsWith('#/components/'))
		throw new Error('Only packaged API references are allowed');
	let current: unknown = serverContract;
	for (const segment of value.$ref.slice(2).split('/'))
		current = (current as Record<string, unknown>)[
			segment.replace(/~1/g, '/').replace(/~0/g, '~')
		];
	if (!current || typeof current !== 'object') throw new Error('Invalid packaged API reference');
	return resolveContract(current as T);
}

const validators = new Map<string, ValidateFunction>();
function createValidator(additive: boolean): Ajv2020 {
	const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: true });
	addFormats.default(ajv);
	ajv.addFormat('int64', { type: 'number', validate: Number.isSafeInteger });
	ajv.addFormat('binary', true);
	ajv.addFormat('password', true);
	const components = additive
		? JSON.parse(
				JSON.stringify(serverContract.components, (key, value: unknown) =>
					key === 'additionalProperties' && value === false ? undefined : value
				)
			)
		: serverContract.components;
	ajv.addSchema({ $id: 'urn:proctor:api', components });
	return ajv;
}
const requestValidator = createValidator(false);
const responseValidator = createValidator(true);
export function validateApiValue(schema: ApiSchema, value: unknown, response = false): void {
	const rewritten = JSON.parse(
		JSON.stringify(schema, (key, value: unknown) => {
			if (key === '$ref' && typeof value === 'string') return `urn:proctor:api${value}`;
			if (response && key === 'additionalProperties' && value === false) return undefined;
			return value;
		})
	) as AnySchema;
	const key = `${response}:${JSON.stringify(rewritten)}`;
	let validate = validators.get(key);
	if (!validate) {
		validate = (response ? responseValidator : requestValidator).compile(rewritten);
		validators.set(key, validate);
	}
	if (!validate(value)) throw new ServerApiError(response ? 'invalidResponse' : 'invalidRequest');
}
