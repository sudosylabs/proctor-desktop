import { ServerApiError, type ApiOperationId, type ApiProblem } from '../common/serverApi.js';
import {
	operationContract,
	resolveSchema,
	validateNamedSchema,
	validateSchema,
	type ApiOperationContract
} from './serverContract.js';
import { decodeJson, type HttpRequest, type HttpResponse } from './serverHttpTransport.js';

export interface ApiRequestInput {
	readonly path?: Readonly<Record<string, unknown>>;
	readonly query?: Readonly<Record<string, unknown>>;
	readonly header?: Readonly<Record<string, unknown>>;
	readonly cookie?: never;
	readonly body?: unknown;
	readonly mediaType?: string;
}
export interface PreparedApiRequest extends HttpRequest {
	readonly operation: ApiOperationContract;
}

export function prepareApiRequest(
	origin: string,
	id: ApiOperationId,
	input: ApiRequestInput = {}
): PreparedApiRequest {
	const operation = operationContract(id);
	let path = operation.path;
	const query = new URLSearchParams();
	const headers: Record<string, string> = {};
	const known = { path: new Set<string>(), query: new Set<string>(), header: new Set<string>() };
	for (const parameter of operation.parameters) {
		const location = parameter.in;
		known[location].add(parameter.name);
		const value = input[location]?.[parameter.name];
		// Credentials/proofs are supplied only by the privileged authentication owner.
		if (
			location === 'header' &&
			/^(?:authorization|dpop|x-proctor-csrf-token)$/iu.test(parameter.name)
		) {
			if (value !== undefined) throw new ServerApiError('invalidRequest');
			continue;
		}
		if (value === undefined) {
			if (parameter.required) throw new ServerApiError('invalidRequest');
			continue;
		}
		validateSchema(parameter.schema, value);
		if (location === 'path') {
			if (value === '.' || value === '..') throw new ServerApiError('invalidRequest');
			path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
		} else if (location === 'header') {
			headers[parameter.name] = String(value);
		} else if (Array.isArray(value)) {
			if (parameter.explode !== false)
				for (const entry of value) query.append(parameter.name, String(entry));
			else
				query.set(
					parameter.name,
					value
						.map(String)
						.join(
							parameter.style === 'spaceDelimited'
								? ' '
								: parameter.style === 'pipeDelimited'
									? '|'
									: ','
						)
				);
		} else query.set(parameter.name, String(value));
	}
	for (const location of ['path', 'query', 'header'] as const)
		for (const key of Object.keys(input[location] ?? {}))
			if (!known[location].has(key)) throw new ServerApiError('invalidRequest');
	if (path.includes('{') || path.includes('}')) throw new ServerApiError('invalidRequest');
	const url = new URL(path, origin);
	if (url.origin !== origin) throw new ServerApiError('invalidRequest');
	url.search = query.toString();
	let body: HttpRequest['body'];
	const declared = operation.requestBody;
	if (declared?.required && input.body === undefined) throw new ServerApiError('invalidRequest');
	if (input.body !== undefined) {
		const content = declared?.content ?? {};
		const mediaType = input.mediaType ?? Object.keys(content)[0];
		const media = content[mediaType];
		if (!media) throw new ServerApiError('invalidRequest');
		if (mediaType === 'application/json') {
			if (media.schema) validateSchema(media.schema, input.body);
			body = JSON.stringify(input.body);
			headers['Content-Type'] = mediaType;
		} else if (mediaType === 'multipart/form-data') {
			const schema = media.schema && resolveSchema(media.schema);
			if (!schema || !input.body || typeof input.body !== 'object')
				throw new ServerApiError('invalidRequest');
			const values = input.body as Record<string, unknown>;
			const form = new FormData();
			const validation: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(values).sort(([left], [right]) =>
				left === 'metadata' ? -1 : right === 'metadata' ? 1 : left.localeCompare(right)
			)) {
				const field = schema.properties?.[key];
				if (!field) throw new ServerApiError('invalidRequest');
				const resolved = resolveSchema(field);
				const mediaType =
					media.encoding?.[key]?.contentType ??
					(resolved.type === 'object' || resolved.type === 'array'
						? 'application/json'
						: resolved.format === 'binary'
							? 'application/octet-stream'
							: 'text/plain');
				if (resolved.format === 'binary') {
					if (!(value instanceof Uint8Array) || value.byteLength > 100 * 1024 * 1024)
						throw new ServerApiError('invalidRequest');
					form.append(key, new Blob([new Uint8Array(value)], { type: mediaType }), key);
					validation[key] = '';
				} else {
					validateSchema(field, value);
					validation[key] = value;
					if (mediaType === 'application/json') {
						const json = JSON.stringify(value);
						if (Buffer.byteLength(json) > 32 * 1024)
							throw new ServerApiError('invalidRequest');
						form.append(key, new Blob([json], { type: mediaType }), '');
					} else form.append(key, String(value));
				}
			}
			validateSchema(schema, validation);
			body = form;
		} else {
			const schema = media.schema && resolveSchema(media.schema);
			if (schema?.format === 'binary') {
				if (!(input.body instanceof Uint8Array)) throw new ServerApiError('invalidRequest');
				const maximum =
					typeof schema.maxLength === 'number'
						? schema.maxLength
						: (mediaType.startsWith('image/') ? 2 : 100) * 1024 * 1024;
				const minimum = typeof schema.minLength === 'number' ? schema.minLength : 0;
				if (input.body.byteLength < minimum || input.body.byteLength > maximum)
					throw new ServerApiError('invalidRequest');
				body = new Uint8Array(input.body);
			} else {
				if (typeof input.body !== 'string') throw new ServerApiError('invalidRequest');
				if (schema) validateSchema(schema, input.body);
				body = input.body;
			}
			headers['Content-Type'] = mediaType;
		}
	}
	headers.Accept = operation.accept.join(', ') || 'application/json';
	return {
		operation,
		url: url.href,
		method: operation.method,
		maxResponseBytes: operation.accept.some((type) =>
			['*/*', 'application/zip', 'text/csv'].includes(type)
		)
			? 100 * 1024 * 1024
			: 2 * 1024 * 1024,
		headers,
		...(body === undefined ? {} : { body })
	};
}

export function readApiResponse(
	operation: ApiOperationContract,
	response: HttpResponse
): { status: number; value: unknown; headers: Readonly<Record<string, string>> } {
	if (response.status >= 400) {
		let problem: ApiProblem | undefined;
		try {
			const candidate = decodeJson(response);
			validateNamedSchema('ProblemDetails', candidate, 'response');
			if ((candidate as ApiProblem).status === response.status)
				problem = candidate as ApiProblem;
		} catch {
			/* A gateway can return HTML; preserve HTTP status without exposing its body. */
		}
		const retry = response.headers['retry-after'];
		const retryAfterMs = retry
			? /^\d+$/u.test(retry)
				? Number(retry) * 1000
				: Math.max(0, Date.parse(retry) - Date.now())
			: undefined;
		throw new ServerApiError(
			'server',
			response.status,
			problem,
			Number.isFinite(retryAfterMs) ? retryAfterMs : undefined
		);
	}
	const declared = operation.responses[String(response.status)];
	if (!declared) throw new ServerApiError('invalidResponse');
	const content = declared.content;
	let value: unknown;
	if (content) {
		const mediaType = (response.headers['content-type'] ?? '')
			.split(';')[0]
			.trim()
			.toLowerCase();
		const media = content[mediaType] ?? content['*/*'];
		if (!media || !mediaType) throw new ServerApiError('invalidResponse');
		if (mediaType === 'application/json' && !content['*/*']) {
			value = decodeJson(response, operation.strictIntegers);
			if (media.schema) validateSchema(media.schema, value, 'response');
		} else value = response.bytes;
	} else if (response.bytes.byteLength) throw new ServerApiError('invalidResponse');
	return { status: response.status, value, headers: response.headers };
}
