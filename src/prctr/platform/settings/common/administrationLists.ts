/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** How many rows an Administration list shows on a page. */
export const ADMINISTRATION_LIST_PAGE_SIZES = [10, 25, 50] as const;
export type AdministrationListPageSize = (typeof ADMINISTRATION_LIST_PAGE_SIZES)[number];

/** Saved views a person may keep for Users. */
export const MAX_SAVED_USER_VIEWS = 8;
/** Lists whose page size is remembered. */
const MAX_LISTS = 40;
const LIST_ID = /^[a-z][a-zA-Z]{0,39}$/u;
const NAME_LIMIT = 60;
const ID = /^[a-z0-9]{26}$/u;
const AFFILIATIONS = ['student', 'teacher', 'staff', 'external'] as const;

/** The Users filters a saved view keeps; a recent or idle window is measured when it is used. */
export interface SavedUserFilter {
	readonly q?: string;
	readonly affiliation?: readonly (typeof AFFILIATIONS)[number][];
	readonly academicUnitId?: string;
	readonly roleIds?: readonly string[];
	readonly status?: 'active' | 'disabled' | 'any';
	readonly lastActive?: 'never' | 'recent' | 'idle';
}

export interface SavedUserView {
	readonly name: string;
	readonly filter: SavedUserFilter;
}

/** What Administration remembers for its lists, kept in the person's settings. */
export interface AdministrationLists {
	/** A list's chosen page size, by the list's name, as in `{ "users": 25 }`. */
	readonly pageSizes?: Readonly<Record<string, AdministrationListPageSize>>;
	readonly userViews?: readonly SavedUserView[];
}

/**
 * The value as settings.json may hold it, or `undefined` when any part is unknown, too long or
 * of the wrong kind. Nothing outside the shapes above is kept.
 */
export function normalizeAdministrationLists(value: unknown): AdministrationLists | undefined {
	if (!isRecord(value)) return undefined;
	if (Object.keys(value).some((key) => key !== 'pageSizes' && key !== 'userViews'))
		return undefined;
	const result: {
		pageSizes?: Record<string, AdministrationListPageSize>;
		userViews?: SavedUserView[];
	} = {};
	if (value.pageSizes !== undefined) {
		if (!isRecord(value.pageSizes)) return undefined;
		const entries = Object.entries(value.pageSizes);
		if (entries.length > MAX_LISTS) return undefined;
		const sizes: Record<string, AdministrationListPageSize> = {};
		for (const [list, size] of entries) {
			if (!LIST_ID.test(list)) return undefined;
			if (!ADMINISTRATION_LIST_PAGE_SIZES.includes(size as AdministrationListPageSize))
				return undefined;
			sizes[list] = size as AdministrationListPageSize;
		}
		result.pageSizes = sizes;
	}
	if (value.userViews !== undefined) {
		if (!Array.isArray(value.userViews) || value.userViews.length > MAX_SAVED_USER_VIEWS)
			return undefined;
		const views: SavedUserView[] = [];
		for (const view of value.userViews) {
			const normalized = normalizeView(view);
			if (normalized === undefined) return undefined;
			views.push(normalized);
		}
		result.userViews = views;
	}
	return Object.freeze(result);
}

function normalizeView(value: unknown): SavedUserView | undefined {
	if (!isRecord(value) || Object.keys(value).some((key) => key !== 'name' && key !== 'filter'))
		return undefined;
	const name = value.name;
	if (typeof name !== 'string' || name.trim() === '' || name.length > NAME_LIMIT)
		return undefined;
	const filter = value.filter;
	if (!isRecord(filter)) return undefined;
	const known = ['q', 'affiliation', 'academicUnitId', 'roleIds', 'status', 'lastActive'];
	if (Object.keys(filter).some((key) => !known.includes(key))) return undefined;
	if (filter.q !== undefined && (typeof filter.q !== 'string' || filter.q.length > 100))
		return undefined;
	if (
		filter.affiliation !== undefined &&
		(!Array.isArray(filter.affiliation) ||
			filter.affiliation.length > AFFILIATIONS.length ||
			filter.affiliation.some((kind) => !AFFILIATIONS.includes(kind)))
	)
		return undefined;
	if (
		filter.academicUnitId !== undefined &&
		(typeof filter.academicUnitId !== 'string' || !ID.test(filter.academicUnitId))
	)
		return undefined;
	if (
		filter.roleIds !== undefined &&
		(!Array.isArray(filter.roleIds) ||
			filter.roleIds.length > 16 ||
			filter.roleIds.some((id) => typeof id !== 'string' || !ID.test(id)))
	)
		return undefined;
	if (
		filter.status !== undefined &&
		!['active', 'disabled', 'any'].includes(filter.status as string)
	)
		return undefined;
	if (
		filter.lastActive !== undefined &&
		!['never', 'recent', 'idle'].includes(filter.lastActive as string)
	)
		return undefined;
	return Object.freeze({
		name: name.trim(),
		filter: Object.freeze({ ...filter }) as SavedUserFilter
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
