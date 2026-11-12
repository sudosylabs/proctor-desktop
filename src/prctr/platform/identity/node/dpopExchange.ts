/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerApiError } from '../../serverApi/common/serverApi.js';
import type {
	HttpRequest,
	HttpResponse,
	ServerHttpTransport
} from '../../serverApi/node/serverHttpTransport.js';
import { parseStrictContractJson } from '../../serverApi/node/canonicalContract.js';
import { createDPoPProof, type DesktopSigningKey } from './desktopSigningKey.js';

const noncePattern = /^[A-Za-z0-9_-]{43}$/u;
const MAX_PROBLEM_BYTES = 64 * 1024;

/** How one request is bound to the registered installation key. */
export interface DPoPBinding {
	readonly key: DesktopSigningKey;
	/** Sent as `Authorization: DPoP …`. */
	readonly credential?: string;
	/** Whether `credential` is an access token, whose hash the proof must carry. */
	readonly accessToken?: boolean;
}
export interface DPoPExchange {
	readonly response: HttpResponse;
	/** The nonce the server expects next: its latest `DPoP-Nonce`, else the one just used. */
	readonly nonce: string | undefined;
}

/**
 * Sends one request with a fresh DPoP proof. A `use_nonce` challenge that carries a valid nonce is
 * answered exactly once, with a new proof; the server rejects the first proof before it acts, so
 * the retry cannot repeat an effect. A malformed `DPoP-Nonce` is refused. Without `binding` the
 * request is sent unsigned and only its nonce is read.
 */
export async function sendWithDPoP(
	transport: ServerHttpTransport,
	request: HttpRequest,
	binding: DPoPBinding | undefined,
	nonce: string | undefined
): Promise<DPoPExchange> {
	let current = nonce;
	for (let attempt = 0; ; attempt++) {
		const headers = { ...request.headers };
		if (binding) {
			if (current === undefined) throw new ServerApiError('invalidRequest');
			headers.DPoP = await createDPoPProof(
				binding.key,
				request.method,
				request.url,
				current,
				binding.accessToken ? binding.credential : undefined
			);
			if (binding.credential) headers.Authorization = `DPoP ${binding.credential}`;
		}
		if (request.signal?.aborted) throw new ServerApiError('cancelled');
		const response = await transport.send({ ...request, headers });
		const issued = response.headers['dpop-nonce'];
		if (issued !== undefined && !noncePattern.test(issued))
			throw new ServerApiError('invalidResponse');
		const challenged =
			binding !== undefined &&
			attempt === 0 &&
			issued !== undefined &&
			problemCode(response) === 'authentication.dpop.use_nonce';
		current = issued ?? current;
		if (!challenged) return { response, nonce: current };
	}
}

/**
 * The stable `code` of a failure body, read leniently: a gateway's HTML or a partial body yields
 * `undefined`. Only the code is read, never echoed.
 */
export function problemCode(response: HttpResponse): string | undefined {
	if (response.status < 400 || response.bytes.byteLength > MAX_PROBLEM_BYTES) return undefined;
	if (
		!/^application\/(?:problem\+)?json(?:\s*;|$)/iu.test(response.headers['content-type'] ?? '')
	)
		return undefined;
	try {
		const value = parseStrictContractJson(response.bytes, {
			integerNumbersOnly: false,
			maxBytes: MAX_PROBLEM_BYTES
		});
		return value &&
			typeof value === 'object' &&
			'code' in value &&
			typeof value.code === 'string' &&
			value.code.length <= 128
			? value.code
			: undefined;
	} catch {
		return undefined;
	}
}
