/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../base/common/cancellation.js';
import type { Event } from '../../../base/common/event.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import {
	serverEventCatalog,
	USER_DELIVERY,
	type ServerEventVariants
} from './serverEvents.generated.js';

export { USER_DELIVERY };

/** Every event the server documents in its realtime contract. */
export type ServerEventName = keyof ServerEventVariants;
/** How a copy of event `N` is delivered: a subscription action, or {@link USER_DELIVERY}. */
export type ServerEventDelivery<N extends ServerEventName> = keyof ServerEventVariants[N] & string;
/** The subscription actions that deliver event `N`. */
export type ServerEventAction<N extends ServerEventName> = Exclude<
	ServerEventDelivery<N>,
	typeof USER_DELIVERY
>;

/**
 * A subscription: the action the server checks, on the exact resource it is checked against.
 * The server authorizes it when it is made and may refuse it.
 */
export interface ServerResourceScope<A extends string = string> {
	readonly action: A;
	readonly resourceType: string;
	readonly resourceId: string;
}

/**
 * Where an event is delivered. A copy addressed to the signed-in User reaches every connection
 * and needs no scope (`undefined`). Any other copy needs a subscription naming its action and
 * resource. One event can have both, with a payload of its own for each.
 */
export type ServerEventScope<N extends ServerEventName> =
	| ([ServerEventAction<N>] extends [never] ? never : ServerResourceScope<ServerEventAction<N>>)
	| (typeof USER_DELIVERY extends ServerEventDelivery<N> ? undefined : never);

/** The delivery a scope selects. */
export type ServerScopeDelivery<S> = S extends { readonly action: infer A }
	? A
	: typeof USER_DELIVERY;

export interface ServerEvent<
	N extends ServerEventName,
	D extends ServerEventDelivery<N> = ServerEventDelivery<N>
> {
	readonly name: N;
	/** The payload, validated against the server's realtime contract. Unknown fields are kept. */
	readonly data: ServerEventVariants[N][D];
	/** The resource a subscribed copy is about. */
	readonly resourceId?: string;
}

export function isServerEventName(name: string): name is ServerEventName {
	return Object.hasOwn(serverEventCatalog, name);
}

/** The payload schema of one copy of an event, `null` without data, `undefined` when unknown. */
export function serverEventPayloadSchema(
	name: ServerEventName,
	delivery: string
): string | null | undefined {
	const variants = serverEventCatalog[name] as Readonly<Record<string, string | null>>;
	return Object.hasOwn(variants, delivery) ? variants[delivery] : undefined;
}

/**
 * The connection as a consumer may care to show it.
 * - `idle`: nothing needs the connection, so none is open.
 * - `connecting`: opening, or reopening after a loss.
 * - `live`: connected, with every subscription in place.
 * - `waiting`: lost; reconnecting after a backoff.
 * - `offline`: the device is offline; reconnects once it is back.
 * - `ended`: the Session ended or refused the connection; it never reopens.
 */
export type ServerEventsState = 'idle' | 'connecting' | 'live' | 'waiting' | 'offline' | 'ended';

export interface ServerEventSubscription extends IDisposable {
	/**
	 * Settles once the server accepted the subscription (at once for a user event) or refused it.
	 * It never rejects; a subscription that ended before an answer settles `false`.
	 */
	readonly accepted: Promise<boolean>;
}

/**
 * The live events of one authenticated Session. Sockets, credentials, backoff, resume and gaps
 * stay inside: a consumer subscribes to typed events and re-reads authoritative state when
 * continuity is lost. Events never grant access or complete a transition by themselves.
 */
export interface IServerEvents {
	/** Listens for one event. The listener runs once per accepted event, in server order. */
	on<N extends ServerEventName, S extends ServerEventScope<N>>(
		name: N,
		scope: S,
		listener: (event: ServerEvent<N, ServerScopeDelivery<S> & ServerEventDelivery<N>>) => void
	): ServerEventSubscription;
	/**
	 * Fires once whenever events may have been missed: a lost connection replaced by a new one,
	 * an unavailable replay, a sequence gap, an event that failed validation, or the server's
	 * `resync_required`. It fires after every live subscription is restored on the connection,
	 * so a consumer that re-reads now cannot miss a later event.
	 */
	readonly onDidLoseContinuity: Event<void>;
	readonly onDidChangeState: Event<ServerEventsState>;
	readonly state: ServerEventsState;
	/** The Attempt owner's channel for realtime commands; one holder per Session at a time. */
	openCommandChannel(): ServerCommandChannel;
}

/** Attempt commands the server accepts over the realtime connection. */
export type ServerCommandAction =
	| 'exam_attempt.connect'
	| 'exam_attempt.renew'
	| 'exam_attempt.security.update'
	| 'exam_attempt.focus_loss'
	| 'exam_attempt.browser_activity.start'
	| 'exam_attempt.browser_activity.append';

export interface ServerCommandOptions {
	readonly token?: CancellationToken;
	/** Defaults to 15 seconds. */
	readonly timeoutMs?: number;
}

/**
 * Sends Attempt commands. A command is sent once and never replayed: a command whose reply was
 * lost settles `unconfirmed`, and its owner reconciles from authoritative state. After any loss
 * of continuity the channel refuses commands until its holder calls `resynchronized()`.
 */
export interface ServerCommandChannel extends IDisposable {
	/** Resolves with the reply data; rejects with a {@link ServerCommandError}. */
	send(
		action: ServerCommandAction,
		data: unknown,
		options?: ServerCommandOptions
	): Promise<unknown>;
	readonly needsResynchronization: boolean;
	readonly onDidNeedResynchronization: Event<void>;
	/** The holder re-read authoritative Attempt state; commands may flow again. */
	resynchronized(): void;
}

export type ServerCommandOutcome =
	/** Not sent: disconnected, waiting for resynchronization, or over a bound. */
	| 'notSent'
	/** Sent, but no reply arrived: lost, timed out or cancelled. The server may have acted. */
	| 'unconfirmed'
	/** The server answered with an error. */
	| 'rejected';

/** The bounded error body the server sent with a rejected command. */
export interface ServerCommandProblem {
	readonly code: string;
	readonly [field: string]: unknown;
}

export class ServerCommandError extends Error {
	readonly outcome: ServerCommandOutcome;
	readonly problem: ServerCommandProblem | undefined;
	constructor(outcome: ServerCommandOutcome, problem?: ServerCommandProblem) {
		super(`Server command ${outcome}`);
		this.name = 'ServerCommandError';
		this.outcome = outcome;
		this.problem = problem;
	}
}
