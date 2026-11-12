/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/*
 * PROVISIONAL. The server publishes no machine-readable realtime contract yet. These entries are
 * written by hand from the server's event constructors and cover only the events Desktop reads.
 * Replace this module with types generated from the server's realtime schemas when they exist.
 *
 * Validators are lenient on purpose: an unknown field is ignored and only the fields Desktop
 * reads are checked, because most events are refetch hints rather than data.
 */

type EventFields = Readonly<Record<string, unknown>>;

interface UserEventEntry<T> {
	/** Delivered to every connection of the signed-in User, without a subscription. */
	readonly target: 'user';
	readonly read: (data: EventFields) => T;
}
interface ResourceEventEntry<T> {
	/** Delivered only to connections subscribed to `action` on a resource of `resourceType`. */
	readonly target: 'resource';
	readonly action: string;
	readonly resourceType: string;
	readonly read: (data: EventFields) => T;
}

function userEvent<T>(read: (data: EventFields) => T): UserEventEntry<T> {
	return { target: 'user', read };
}
function resourceEvent<T>(
	action: string,
	resourceType: string,
	read: (data: EventFields) => T
): ResourceEventEntry<T> {
	return { target: 'resource', action, resourceType, read };
}

export const serverEventCatalog = {
	/** The User's navigation context changed; re-read it. */
	'current_user.context.changed': userEvent(() => ({})),
	/** The candidate's Exam activity collection changed; re-read it. */
	'candidate.exam_activity.changed': userEvent(() => ({})),
	/** The User's profile picture changed at profile `revision`. */
	user_profile_picture_changed: userEvent((data) => ({ revision: eventCount(data.revision) })),
	/** The Institution's Access Policy reached `revision`. */
	access_policy_changed: resourceEvent('access_policy.view', 'institution', (data) => ({
		revision: eventCount(data.revision)
	}))
} as const;

export type ServerEventCatalog = typeof serverEventCatalog;
export type ServerEventName = keyof ServerEventCatalog;
export type ServerUserEventName = {
	[N in ServerEventName]: ServerEventCatalog[N]['target'] extends 'user' ? N : never;
}[ServerEventName];
export type ServerResourceEventName = Exclude<ServerEventName, ServerUserEventName>;
export type ServerEventData<N extends ServerEventName> = ReturnType<ServerEventCatalog[N]['read']>;

export function isServerEventName(name: string): name is ServerEventName {
	return Object.hasOwn(serverEventCatalog, name);
}

function eventCount(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		throw new TypeError('Invalid event count');
	return Number(value);
}
