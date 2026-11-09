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
