/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerApiError, type ApiProblem } from '../common/serverApi.js';
import { parseStrictContractJson } from './canonicalContract.js';
import {
	validateNamedSchema,
	validateSchema,
	type ApiOperationContract
} from './serverContract.js';
import type { HttpResponse } from './serverHttpTransport.js';

export interface DecodedApiResponse {
	readonly status: number;
	readonly value: unknown;
	readonly headers: Readonly<Record<string, string>>;
}

/**
 * Reads one operation's response. A success is checked against the status and media type the
 * contract declares; a failure becomes a `server` {@link ServerApiError} that keeps the status,
 * a consistent Problem Details and the server's Retry-After, but never the raw body.
 */
export function decodeResponse(
	operation: ApiOperationContract,
	response: HttpResponse
): DecodedApiResponse {
	if (response.status >= 400) throw serverFailure(response);
	const declared = operation.responses[String(response.status)];
	if (!declared) throw new ServerApiError('invalidResponse');
	const content = declared.content;
	if (!content) {
		if (response.bytes.byteLength) throw new ServerApiError('invalidResponse');
		return { status: response.status, value: undefined, headers: response.headers };
	}
	const mediaType = (response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
	const media = content[mediaType] ?? content['*/*'];
	if (!media || !mediaType) throw new ServerApiError('invalidResponse');
	if (mediaType !== 'application/json' || content['*/*'])
		return { status: response.status, value: response.bytes, headers: response.headers };
	const value = decodeJsonBody(response, operation.strictIntegers);
	if (media.schema) validateSchema(media.schema, value, 'response');
	return { status: response.status, value, headers: response.headers };
}

/**
 * Parses a JSON or Problem Details body strictly: fatal UTF-8, bounded depth, no duplicate keys,
 * and safe integers. With `integersOnly`, decimals and non-canonical integer spellings are refused.
 */
export function decodeJsonBody(response: HttpResponse, integersOnly = false): unknown {
	if (
		!/^application\/(?:json|problem\+json)(?:\s*;|$)/iu.test(
			response.headers['content-type'] ?? ''
		)
	)
		throw new ServerApiError('invalidResponse');
	try {
		return parseStrictContractJson(response.bytes, {
			integerNumbersOnly: integersOnly,
			maxBytes: Math.max(1, response.bytes.byteLength)
		});
	} catch {
		throw new ServerApiError('invalidResponse');
	}
}

function serverFailure(response: HttpResponse): ServerApiError {
	let problem: ApiProblem | undefined;
	try {
		const candidate = decodeJsonBody(response);
		validateNamedSchema('ProblemDetails', candidate, 'response');
		if ((candidate as ApiProblem).status === response.status) problem = candidate as ApiProblem;
	} catch {
		// A gateway can answer with HTML: keep the status without exposing the body.
	}
	const retryAfterMs = retryAfter(response.headers['retry-after']);
	return new ServerApiError('server', {
		status: response.status,
		...(problem ? { problem } : {}),
		...(retryAfterMs === undefined ? {} : { retryAfterMs })
	});
}

function retryAfter(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const milliseconds = /^\d+$/u.test(value)
		? Number(value) * 1000
		: Math.max(0, Date.parse(value) - Date.now());
	return Number.isFinite(milliseconds) ? milliseconds : undefined;
}
