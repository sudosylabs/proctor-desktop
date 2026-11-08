import type { ApiInput, ApiOperationId } from '../common/serverApi.js';
import { ServerApiError } from '../common/serverApi.js';
import { apiOperations, resolveContract } from './apiContract.js';
import type { ApiRequestInput } from './apiRequest.js';

/** Transitional domain adapters resolve only packaged routes; no arbitrary endpoint is admitted. */
export function resolveApiRoute(
	origin: string,
	path: string,
	method: string,
	body?: unknown,
	header?: Readonly<Record<string, string>>,
	mediaType?: string
): { id: ApiOperationId; input: ApiInput<ApiOperationId> } {
	const url = new URL(path, origin);
	if (url.origin !== origin || url.hash) throw new ServerApiError('invalidRequest');
	for (const operation of apiOperations.values()) {
		if (operation.method !== method) continue;
		const template = operation.path.split('/');
		const actual = url.pathname.split('/');
		if (template.length !== actual.length) continue;
		const params: Record<string, unknown> = {};
		let matched = true;
		for (let i = 0; i < template.length; i++) {
			const part = template[i];
			if (part.startsWith('{')) params[part.slice(1, -1)] = decodeURIComponent(actual[i]);
			else if (part !== actual[i]) {
				matched = false;
				break;
			}
		}
		if (!matched) continue;
		const query: Record<string, unknown> = {};
		for (const [name, value] of url.searchParams) {
			const param = operation.parameters
				?.map(resolveContract)
				.find((p) => p.in === 'query' && p.name === name);
			const schema = param && resolveContract(param.schema);
			// A repeated parameter keeps every value it was given, in order.
			if (schema?.type === 'array') {
				const items =
					schema.items === undefined ? undefined : resolveContract(schema.items);
				const previous = query[name];
				query[name] = [...(Array.isArray(previous) ? previous : []), scalar(items, value)];
			} else query[name] = scalar(schema, value);
		}
		const input: ApiRequestInput = {
			path: params,
			query,
			...(header ? { header } : {}),
			...(body === undefined ? {} : { body }),
			...(mediaType ? { mediaType } : {})
		};
		return { id: operation.operationId, input: input as ApiInput<ApiOperationId> };
	}
	throw new ServerApiError('invalidRequest');
}

function scalar(schema: { readonly type?: unknown } | undefined, value: string): unknown {
	if (schema?.type === 'integer' || schema?.type === 'number') return Number(value);
	if (schema?.type === 'boolean') return value === 'true';
	return value;
}
