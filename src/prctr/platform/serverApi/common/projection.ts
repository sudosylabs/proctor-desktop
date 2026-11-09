/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerApiError } from './serverApi.js';

/** The authenticated Session a privileged capability is bound to for its whole life. */
export interface SessionBinding {
	readonly principalId: string;
	readonly sessionId: string;
}

export function projectionRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('Invalid projected data');
	return value as Record<string, unknown>;
}
/** Bounded text; control characters become spaces so nothing can restyle a presentation. */
export function projectionText(value: unknown, limit = 512): string {
	if (typeof value !== 'string' || value.length > limit)
		throw new TypeError('Invalid projected text');
	return value.replace(/[\u0000-\u001f\u007f]/gu, ' ');
}
export function projectionId(value: unknown): string {
	if (typeof value !== 'string' || !/^[ybndrfg8ejkmcpqxot1uwisza345h769]{26}$/u.test(value))
		throw new TypeError('Invalid projected resource');
	return value;
}
export function projectionFlag(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new TypeError('Invalid projected flag');
	return value;
}
/** A non-negative safe integer: epoch milliseconds, a count, or a revision. */
export function projectionTime(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 8640000000000000)
		throw new TypeError('Invalid projected number');
	return Number(value);
}
export function projectionList(value: unknown, limit = 256): unknown[] {
	if (!Array.isArray(value) || value.length > limit)
		throw new TypeError('Invalid projected list');
	return value;
}
/** Reads one page of a server collection; only its first page is presented. */
export function projectionPage(value: unknown, limit = 256): unknown[] {
	return projectionList(projectionRecord(value).items, limit);
}
/** Reads a server RFC 3339 UTC instant as epoch milliseconds; absence stays absent. */
export function projectionInstant(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value.length > 40 || !/Z$/u.test(value))
		throw new TypeError('Invalid projected timestamp');
	return projectionTime(Date.parse(value));
}
export function projectionMember<T extends string>(value: unknown, members: readonly T[]): T {
	if (!members.includes(value as T)) throw new TypeError('Invalid projected state');
	return value as T;
}

/**
 * A projected read that answered with a failure. The query cache keeps the server failure it
 * came from, so its retry policy sees a transport failure, while the caller still receives the
 * closed failure reply.
 */
export class ProjectionFailure<R> extends ServerApiError {
	readonly response: R;
	constructor(response: R, failure?: ServerApiError, sessionEnded = false) {
		super(
			failure?.kind ?? (sessionEnded ? 'sessionEnded' : 'invalidResponse'),
			failure?.status,
			failure?.problem,
			failure?.retryAfterMs
		);
		this.response = response;
	}
}
/** Runs one projected read, turning a failure reply into a {@link ProjectionFailure}. */
export async function projectRead<T extends { readonly kind: string }>(
	read: (capture: (failure: ServerApiError) => void) => Promise<T>
): Promise<T> {
	let failure: ServerApiError | undefined;
	const result = await read((value) => {
		failure = value;
	});
	if (result.kind === 'error')
		throw new ProjectionFailure(
			result,
			failure,
			(result as { readonly reason?: unknown }).reason === 'sessionEnded'
		);
	return result;
}
