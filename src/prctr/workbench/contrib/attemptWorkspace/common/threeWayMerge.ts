/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type ThreeWayTextMergeResult =
	| { readonly kind: 'merged'; readonly value: string }
	| { readonly kind: 'overlap' };

interface TextChange { readonly start: number; readonly end: number; readonly replacement: string }

/**
 * Conservatively merges two text versions that each differ from the same base by one
 * contiguous change. More complicated diffs are reported as overlap instead of guessing.
 */
export function mergeNonOverlappingText(base: string, local: string, authoritative: string): ThreeWayTextMergeResult {
	if (local === authoritative) return Object.freeze({ kind: 'merged', value: local });
	if (local === base) return Object.freeze({ kind: 'merged', value: authoritative });
	if (authoritative === base) return Object.freeze({ kind: 'merged', value: local });

	const localChange = singleChange(base, local);
	const authoritativeChange = singleChange(base, authoritative);
	if (changesOverlap(localChange, authoritativeChange)) return Object.freeze({ kind: 'overlap' });

	let value = base;
	for (const change of [localChange, authoritativeChange].sort((left, right) => right.start - left.start || right.end - left.end)) {
		value = `${value.slice(0, change.start)}${change.replacement}${value.slice(change.end)}`;
	}
	return Object.freeze({ kind: 'merged', value });
}

export function decodeTextContent(content: Uint8Array, mediaType: string): string | undefined {
	if (!isTextMediaType(mediaType)) return undefined;
	try { return new TextDecoder('utf-8', { fatal: true }).decode(content); } catch { return undefined; }
}

export function isTextMediaType(mediaType: string): boolean {
	const normalized = mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	return normalized.startsWith('text/') || normalized === 'application/json' || normalized.endsWith('+json') || normalized === 'application/javascript' || normalized === 'application/typescript' || normalized === 'application/xml' || normalized.endsWith('+xml');
}

function singleChange(base: string, changed: string): TextChange {
	let prefix = 0;
	const prefixLimit = Math.min(base.length, changed.length);
	while (prefix < prefixLimit && base.charCodeAt(prefix) === changed.charCodeAt(prefix)) prefix++;

	let baseSuffix = base.length;
	let changedSuffix = changed.length;
	while (baseSuffix > prefix && changedSuffix > prefix && base.charCodeAt(baseSuffix - 1) === changed.charCodeAt(changedSuffix - 1)) { baseSuffix--; changedSuffix--; }
	return Object.freeze({ start: prefix, end: baseSuffix, replacement: changed.slice(prefix, changedSuffix) });
}

function changesOverlap(left: TextChange, right: TextChange): boolean {
	if (left.start === left.end && right.start === right.end) return left.start === right.start;
	if (left.start === left.end) return left.start >= right.start && left.start <= right.end;
	if (right.start === right.end) return right.start >= left.start && right.start <= left.end;
	return left.start < right.end && right.start < left.end;
}
