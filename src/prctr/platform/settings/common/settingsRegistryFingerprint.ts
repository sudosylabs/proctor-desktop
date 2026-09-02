/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const record = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/** Stable non-security identity used for parity; server-issued Attempt digests remain authoritative. */
export function registryFingerprint(value: unknown): string {
	let hash = 0xcbf29ce484222325n;
	for (const character of new TextEncoder().encode(stableStringify(value))) {
		hash ^= BigInt(character);
		hash = BigInt.asUintN(64, hash * 0x100000001b3n);
	}
	return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}
