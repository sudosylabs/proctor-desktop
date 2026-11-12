/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	ADMINISTRATION_MAX_PAGE_SIZE,
	type AdministrationFailure,
	type AdministrationIntentOf,
	type AdministrationReadKind,
	type AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import type { AdministrationResponse } from '../../../../platform/administration/common/administrationProtocol.js';
import { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import type { IAdministrationService } from '../../../services/administration/common/administration.js';
import { administrationFailureWithdraws } from '../common/administrationPresentation.js';
import type { AdminListItem, AdminListKind, AdminListQuery } from './adminList.js';

export type AdminReadResult<T> =
	| { readonly kind: 'data'; readonly value: T }
	| { readonly kind: 'failure'; readonly reason: AdministrationFailure };

/** Reads one resource once. */
export async function readOnce<K extends AdministrationReadKind>(
	administration: IAdministrationService,
	intent: AdministrationIntentOf<K>
): Promise<AdminReadResult<AdministrationValue<K>>> {
	const kind: string = (intent as { readonly kind: string }).kind;
	const response = await administration.request(intent);
	if (response.kind === 'data' && response.data.resource === kind)
		return { kind: 'data', value: response.data.value as AdministrationValue<K> };
	return { kind: 'failure', reason: response.kind === 'error' ? response.reason : 'invalid' };
}

/**
 * Reads a list's pages for a picker, up to `maximum` rows. `more` says the list goes on, so the
 * picker can ask the person to narrow it down.
 */
export async function readPages<K extends AdminListKind>(
	administration: IAdministrationService,
	kind: K,
	query: AdminListQuery<K>,
	maximum = 50
): Promise<
	AdminReadResult<{ readonly items: readonly AdminListItem<K>[]; readonly more: boolean }>
> {
	const items: AdminListItem<K>[] = [];
	let cursor: string | undefined;
	do {
		const intent = {
			...query,
			kind,
			// A picker reads the largest pages, so a long list takes few requests.
			limit: ADMINISTRATION_MAX_PAGE_SIZE,
			...(cursor === undefined ? {} : { cursor })
		} as unknown as AdministrationIntentOf<K>;
		const result = await readOnce(administration, intent);
		if (result.kind === 'failure') return result;
		const page = result.value as unknown as {
			readonly items: readonly AdminListItem<K>[];
			readonly cursor?: string;
		};
		items.push(...page.items);
		cursor = page.cursor;
	} while (cursor !== undefined && items.length < maximum);
	return { kind: 'data', value: { items, more: cursor !== undefined } };
}

/** A page's live read of one resource, with the page's loading, slow, failed and stale states. */
export function adminRead<K extends AdministrationReadKind>(
	administration: IAdministrationService,
	intent: AdministrationIntentOf<K>
): PageRead<AdministrationValue<K>, AdministrationFailure, AdministrationResponse> {
	const kind: string = (intent as { readonly kind: string }).kind;
	return new PageRead({
		source: {
			request: () => administration.request(intent),
			observe: (listener) => administration.observe(intent, listener)
		},
		interpret: (response) =>
			response.kind === 'data' && response.data.resource === kind
				? { kind: 'data', data: response.data.value as AdministrationValue<K> }
				: {
						kind: 'failure',
						reason: response.kind === 'error' ? response.reason : 'invalid'
					},
		withdraws: administrationFailureWithdraws,
		timeout: 'unavailable'
	});
}

/** One academic unit in a picker, with how deep it sits under the root units. */
export interface AdminUnitChoice {
	readonly id: string;
	readonly name: string;
	readonly depth: number;
}

/**
 * Every academic unit the person can see, root units first and each unit's children after it,
 * up to `maximum`. The server lists roots on their own, so the tree is read one level at a time.
 */
export async function readUnitTree(
	administration: IAdministrationService,
	maximum = 100
): Promise<AdminReadResult<readonly AdminUnitChoice[]>> {
	const roots = await readPages(administration, 'academicUnits', {}, maximum);
	if (roots.kind === 'failure') return roots;
	const result: AdminUnitChoice[] = [];
	const visit = async (
		units: readonly {
			readonly id: string;
			readonly displayName: string;
			readonly archivedAt?: number;
		}[],
		depth: number
	): Promise<void> => {
		for (const unit of units) {
			if (unit.archivedAt !== undefined || result.length >= maximum) continue;
			result.push({ id: unit.id, name: unit.displayName, depth });
			const children = await readPages(
				administration,
				'unitChildren',
				{ unitId: unit.id },
				maximum
			);
			if (children.kind === 'data') await visit(children.value.items, depth + 1);
		}
	};
	await visit(roots.value.items, 0);
	return { kind: 'data', value: result };
}

/** A unit's picker label, indented by its depth with figure spaces so the tree reads in a list. */
export function unitLabel(unit: AdminUnitChoice): string {
	return `${'  '.repeat(unit.depth)}${unit.name}`;
}
