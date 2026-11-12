import type { operations, components } from './serverApi.generated.js';

export type ApiOperationId = keyof operations;
export type ApiProblem = components['schemas']['ProblemDetails'];
type ManagedHeader = 'Authorization' | 'DPoP' | 'X-Proctor-CSRF-Token';
type PublicHeaders<P> = P extends { header?: infer H }
	? [NonNullable<H>] extends [never]
		? Record<never, never>
		: Omit<NonNullable<H>, ManagedHeader>
	: Record<never, never>;
type Parameters<K extends ApiOperationId> = operations[K] extends { parameters: infer P }
	? Omit<P, 'header' | 'cookie'> &
			({} extends PublicHeaders<P>
				? { readonly header?: PublicHeaders<P> }
				: { readonly header: PublicHeaders<P> })
	: never;
type Content<T> = T extends { content: infer C } ? C[keyof C] : undefined;
type Body<K extends ApiOperationId> = operations[K] extends { requestBody: infer B }
	? { readonly body: Content<B> }
	: operations[K] extends { requestBody?: infer B }
		? { readonly body?: Content<B> }
		: { readonly body?: never };
export type ApiInput<K extends ApiOperationId> = Parameters<K> &
	Body<K> & {
		readonly mediaType?: string;
	};
type Responses<K extends ApiOperationId> = operations[K]['responses'];
export type ApiResponse<K extends ApiOperationId> = K extends ApiOperationId
	? {
			[S in keyof Responses<K>]: {
				readonly status: S;
				readonly value: Content<Responses<K>[S]>;
				readonly headers: Readonly<Record<string, string>>;
			};
		}[keyof Responses<K>]
	: never;

export type ApiFailureKind =
	| 'server'
	| 'network'
	| 'timeout'
	| 'cancelled'
	| 'invalidRequest'
	| 'invalidResponse'
	| 'redirectBlocked'
	| 'sessionEnded';
export interface ServerApiErrorDetails {
	/** The HTTP status the server answered with, for `server` failures. */
	readonly status?: number;
	/** The server's Problem Details, when it sent a valid one for this status. */
	readonly problem?: ApiProblem;
	/** How long the server asked the client to wait before trying again. */
	readonly retryAfterMs?: number;
}
/**
 * A failed server operation. The message names only the kind and status: it never includes
 * credentials, request bodies, URLs or the underlying exception.
 */
export class ServerApiError extends Error {
	readonly kind: ApiFailureKind;
	readonly status: number | undefined;
	readonly problem: ApiProblem | undefined;
	readonly retryAfterMs: number | undefined;
	constructor(kind: ApiFailureKind, details: ServerApiErrorDetails = {}) {
		super(`Server API ${kind}${details.status === undefined ? '' : ` (${details.status})`}`);
		this.name = 'ServerApiError';
		this.kind = kind;
		this.status = details.status;
		this.problem = details.problem;
		this.retryAfterMs = details.retryAfterMs;
	}
	/** The server's stable error code, when it answered with Problem Details. */
	get code(): string | undefined {
		return this.problem?.code;
	}
}

export interface ApiQueryState<T> {
	readonly data: T | undefined;
	readonly error: ServerApiError | undefined;
	readonly loading: boolean;
	readonly fetching: boolean;
}
