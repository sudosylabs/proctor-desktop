/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerApiError, type ApiOperationId } from '../common/serverApi.js';
import {
	operationContract,
	resolveSchema,
	validateSchema,
	type ApiMediaContract,
	type ApiOperationContract,
	type ApiParameterContract,
	type ApiSchema
} from './serverContract.js';
import type { HttpRequest } from './serverHttpTransport.js';

/** Largest binary body or multipart file Desktop sends. */
const MAX_BINARY_BODY_BYTES = 100 * 1024 * 1024;
/** Largest image body when the schema states no limit of its own. */
const MAX_IMAGE_BODY_BYTES = 2 * 1024 * 1024;
/** Largest JSON part of a multipart body, such as an upload's metadata. */
const MAX_MULTIPART_JSON_BYTES = 32 * 1024;
/** Response limit of an ordinary JSON operation. */
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Response limit of an operation that can answer with an archive, export or download. */
const MAX_DOWNLOAD_RESPONSE_BYTES = 100 * 1024 * 1024;
const downloadMediaTypes = new Set(['*/*', 'application/zip', 'text/csv']);
/** Supplied only by the privileged authentication owner, never by a caller. */
const credentialHeader = /^(?:authorization|dpop|x-proctor-csrf-token)$/iu;

export interface ApiRequestInput {
	readonly path?: Readonly<Record<string, unknown>>;
	readonly query?: Readonly<Record<string, unknown>>;
	readonly header?: Readonly<Record<string, unknown>>;
	readonly body?: unknown;
	readonly mediaType?: string;
}
/** An HTTP request built from one packaged operation. It carries no credential. */
export interface EncodedApiRequest extends HttpRequest {
	readonly operation: ApiOperationContract;
}

/**
 * Builds the request for one operation of the packaged contract. Every parameter and body is
 * validated against the contract before anything is sent, and the URL can never leave `origin`.
 */
export function encodeRequest(
	origin: string,
	id: ApiOperationId,
	input: ApiRequestInput = {}
): EncodedApiRequest {
	const operation = operationContract(id);
	const headers: Record<string, string> = {};
	const url = encodeParameters(operation, input, headers, origin);
	if (url.origin !== origin) throw new ServerApiError('invalidRequest');
	const body = encodeBody(operation, input, headers);
	headers.Accept = operation.accept.join(', ') || 'application/json';
	return {
		operation,
		url: url.href,
		method: operation.method,
		maxResponseBytes: operation.accept.some((type) => downloadMediaTypes.has(type))
			? MAX_DOWNLOAD_RESPONSE_BYTES
			: MAX_JSON_RESPONSE_BYTES,
		headers,
		...(body === undefined ? {} : { body })
	};
}

/** Whether a request may be shared through the read cache. Credentials never enter a cache key. */
export function isCacheableRequest(request: EncodedApiRequest): boolean {
	return (
		request.method === 'GET' &&
		!Object.keys(request.headers ?? {}).some((key) =>
			/(?:credential|authorization|dpop|cookie|csrf)/iu.test(key)
		)
	);
}

/** Returns the URL with its path and query encoded; fills `headers` with header parameters. */
function encodeParameters(
	operation: ApiOperationContract,
	input: ApiRequestInput,
	headers: Record<string, string>,
	origin: string
): URL {
	let path = operation.path;
	const query = new URLSearchParams();
	const known = { path: new Set<string>(), query: new Set<string>(), header: new Set<string>() };
	for (const parameter of operation.parameters) {
		const location = parameter.in;
		known[location].add(parameter.name);
		const value = input[location]?.[parameter.name];
		if (location === 'header' && credentialHeader.test(parameter.name)) {
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
		} else if (location === 'header') headers[parameter.name] = String(value);
		else appendQuery(query, parameter, value);
	}
	for (const location of ['path', 'query', 'header'] as const)
		for (const key of Object.keys(input[location] ?? {}))
			if (!known[location].has(key)) throw new ServerApiError('invalidRequest');
	if (path.includes('{') || path.includes('}')) throw new ServerApiError('invalidRequest');
	const url = new URL(path, origin);
	url.search = query.toString();
	return url;
}

function appendQuery(query: URLSearchParams, parameter: ApiParameterContract, value: unknown) {
	if (!Array.isArray(value)) {
		query.set(parameter.name, String(value));
		return;
	}
	if (parameter.explode !== false) {
		for (const entry of value) query.append(parameter.name, String(entry));
		return;
	}
	const separator =
		parameter.style === 'spaceDelimited'
			? ' '
			: parameter.style === 'pipeDelimited'
				? '|'
				: ',';
	query.set(parameter.name, value.map(String).join(separator));
}

function encodeBody(
	operation: ApiOperationContract,
	input: ApiRequestInput,
	headers: Record<string, string>
): HttpRequest['body'] {
	const declared = operation.requestBody;
	if (input.body === undefined) {
		if (declared?.required) throw new ServerApiError('invalidRequest');
		return undefined;
	}
	const content = declared?.content ?? {};
	const mediaType = input.mediaType ?? Object.keys(content)[0];
	const media = mediaType === undefined ? undefined : content[mediaType];
	if (mediaType === undefined || !media) throw new ServerApiError('invalidRequest');
	if (mediaType === 'multipart/form-data') return encodeMultipart(media, input.body);
	headers['Content-Type'] = mediaType;
	if (mediaType === 'application/json') {
		if (media.schema) validateSchema(media.schema, input.body);
		return JSON.stringify(input.body);
	}
	const schema = media.schema && resolveSchema(media.schema);
	if (schema?.format === 'binary') return encodeBinary(schema, mediaType, input.body);
	if (typeof input.body !== 'string') throw new ServerApiError('invalidRequest');
	if (schema) validateSchema(schema, input.body);
	return input.body;
}

function encodeBinary(schema: ApiSchema, mediaType: string, body: unknown): Uint8Array {
	if (!(body instanceof Uint8Array)) throw new ServerApiError('invalidRequest');
	const maximum =
		typeof schema.maxLength === 'number'
			? schema.maxLength
			: mediaType.startsWith('image/')
				? MAX_IMAGE_BODY_BYTES
				: MAX_BINARY_BODY_BYTES;
	const minimum = typeof schema.minLength === 'number' ? schema.minLength : 0;
	if (body.byteLength < minimum || body.byteLength > maximum)
		throw new ServerApiError('invalidRequest');
	return new Uint8Array(body);
}

/**
 * Encodes a multipart body. `metadata` goes first so the server can check it before it reads
 * any file part; files are sent as bytes and validated only as present.
 */
function encodeMultipart(media: ApiMediaContract, body: unknown): FormData {
	const schema = media.schema && resolveSchema(media.schema);
	if (!schema || !body || typeof body !== 'object') throw new ServerApiError('invalidRequest');
	const form = new FormData();
	const validation: Record<string, unknown> = {};
	const fields = Object.entries(body as Record<string, unknown>).sort(([left], [right]) =>
		left === 'metadata' ? -1 : right === 'metadata' ? 1 : left.localeCompare(right)
	);
	for (const [key, value] of fields) {
		const field = schema.properties?.[key];
		if (!field) throw new ServerApiError('invalidRequest');
		const resolved = resolveSchema(field);
		const partType =
			media.encoding?.[key]?.contentType ??
			(resolved.type === 'object' || resolved.type === 'array'
				? 'application/json'
				: resolved.format === 'binary'
					? 'application/octet-stream'
					: 'text/plain');
		if (resolved.format === 'binary') {
			if (!(value instanceof Uint8Array) || value.byteLength > MAX_BINARY_BODY_BYTES)
				throw new ServerApiError('invalidRequest');
			form.append(key, new Blob([new Uint8Array(value)], { type: partType }), key);
			validation[key] = '';
			continue;
		}
		validateSchema(field, value);
		validation[key] = value;
		if (partType !== 'application/json') {
			form.append(key, String(value));
			continue;
		}
		const json = JSON.stringify(value);
		if (Buffer.byteLength(json) > MAX_MULTIPART_JSON_BYTES)
			throw new ServerApiError('invalidRequest');
		form.append(key, new Blob([json], { type: partType }), '');
	}
	validateSchema(schema, validation);
	return form;
}
