/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Names what a cached read holds, as a `/`-separated path from a collection to the entities and
 * parts under it: `user` is every user, `user/<id>` one user, `user/<id>/sessions` that user's
 * Sessions. A read carries the tags of what it shows; a change names the tags it writes.
 */
export type ServerDataTag = string;

/** What one change writes, and what it must not run beside. */
export interface ServerChangeTags {
	/** Reads under these tags are fenced and re-read once the change succeeds. */
	readonly writes: readonly ServerDataTag[];
	/** Another change holding an overlapping tag runs first; usually the same as `writes`. */
	readonly locks: readonly ServerDataTag[];
}

/** Whether writing `written` makes data under `tag` stale: the same tag or one below it. */
export function tagCovers(written: ServerDataTag, tag: ServerDataTag): boolean {
	return tag === written || tag.startsWith(`${written}/`);
}

/** Whether two locks conflict: one tag is the other or lies below it. */
export function tagsOverlap(a: ServerDataTag, b: ServerDataTag): boolean {
	return tagCovers(a, b) || tagCovers(b, a);
}

/** Whether any written tag makes any of `tags` stale. */
export function anyTagCovered(
	written: readonly ServerDataTag[],
	tags: Iterable<ServerDataTag>
): boolean {
	for (const tag of tags) if (written.some((w) => tagCovers(w, tag))) return true;
	return false;
}

/** The change tags of a change that writes and locks the same tags. */
export function changeTags(...tags: readonly ServerDataTag[]): ServerChangeTags {
	return { writes: tags, locks: tags };
}
