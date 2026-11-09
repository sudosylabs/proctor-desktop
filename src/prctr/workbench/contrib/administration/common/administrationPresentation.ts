/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { AdministrationFailure } from '../../../../platform/administration/common/administrationProtocol.js';

/** The shown data no longer belongs here, so it is withdrawn rather than kept as stale. */
export function administrationFailureWithdraws(reason: AdministrationFailure): boolean {
	return (
		reason === 'sessionEnded' ||
		reason === 'noAccess' ||
		reason === 'denied' ||
		reason === 'notFound'
	);
}

/** The outcome is unknown or the record changed, so it must be read again before a retry. */
export function administrationFailureNeedsRead(reason: AdministrationFailure): boolean {
	return reason === 'unconfirmed' || reason === 'conflict' || reason === 'notFound';
}

const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]+\.[^\s@,;]+$/u;

/**
 * The addresses in what the person typed: one per line or separated by commas or semicolons.
 * Repeats count once, compared without case; anything else that is not an address is listed.
 */
export function parseEmails(text: string): {
	readonly valid: readonly string[];
	readonly invalid: readonly string[];
} {
	const valid: string[] = [];
	const invalid: string[] = [];
	const seen = new Set<string>();
	for (const part of text.split(/[\s,;]+/u)) {
		const entry = part.trim();
		if (entry === '') continue;
		if (!EMAIL.test(entry) || entry.length > 254) {
			invalid.push(entry);
			continue;
		}
		const key = entry.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		valid.push(entry);
	}
	return { valid, invalid };
}

/**
 * A server action or resource name, such as `user.disable` or `role_binding`, as words to read
 * until the catalogue gives it a sentence: "User disable", "Role binding".
 */
export function readableCode(code: string): string {
	const words = code.replace(/[._:/-]+/gu, ' ').trim();
	return words === '' ? code : words[0]!.toLocaleUpperCase() + words.slice(1);
}

export type PermissionCell = 'allowed' | 'denied' | 'absent';

/**
 * Permissions such as `exam.view` and `academic_unit.members.manage` as a grid: the area is
 * everything before the last dot, the verb the last word. A cell is allowed when the role holds
 * it, denied when the catalogue offers it, and absent when no such permission exists.
 */
export function permissionMatrix(
	catalogue: readonly string[],
	held: readonly string[]
): {
	readonly verbs: readonly string[];
	readonly areas: readonly { readonly area: string; readonly cells: readonly PermissionCell[] }[];
} {
	const split = (code: string): readonly [string, string] => {
		const dot = code.lastIndexOf('.');
		return dot < 0 ? [code, ''] : [code.slice(0, dot), code.slice(dot + 1)];
	};
	const all = [...new Set([...catalogue, ...held])];
	const verbs = [...new Set(all.map((code) => split(code)[1]))].sort();
	const areas = [...new Set(all.map((code) => split(code)[0]))].sort();
	const holds = new Set(held);
	const offers = new Set(all);
	return {
		verbs,
		areas: areas.map((area) => ({
			area,
			cells: verbs.map((verb) => {
				const code = verb === '' ? area : `${area}.${verb}`;
				return holds.has(code) ? 'allowed' : offers.has(code) ? 'denied' : 'absent';
			})
		}))
	};
}

/** An audit action that only read something, such as `user.view`. */
export function isReadAction(action: string): boolean {
	return /(^|[._])(view|read|list|search)$/u.test(action);
}
