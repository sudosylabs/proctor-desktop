/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { visit } from '../../../base/common/json.js';
import { findJsonDepthOverflow } from '../../../base/common/jsonBounds.js';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 64;

export interface StrictContractJsonOptions {
	readonly maxBytes?: number;
	/** General API data may contain decimals; signed contract integers may not. */
	readonly integerNumbersOnly?: boolean;
}

/** Strict transport validation before JSON.parse can erase duplicate keys or integer spelling. */
export function parseStrictContractJson(
	bytes: Uint8Array,
	options: StrictContractJsonOptions = {}
): unknown {
	const maximum = byteLimit(options.maxBytes);
	if (bytes.byteLength > maximum) invalid();
	const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	if (findJsonDepthOverflow(text, MAX_DEPTH) !== undefined) invalid();
	const objects: Set<string>[] = [];
	visit(
		text,
		{
			onObjectBegin: () => {
				objects.push(new Set());
			},
			onObjectProperty: (key) => {
				validString(key);
				if ((options.integerNumbersOnly ?? true) && !/^[\x00-\x7f]*$/u.test(key)) invalid();
				const current = objects.at(-1);
				if (current === undefined || current.has(key)) invalid();
				current.add(key);
			},
			onObjectEnd: () => {
				objects.pop();
			},
			onLiteralValue: (value: unknown, offset, length) => {
				if (typeof value === 'string') validString(value);
				if (typeof value === 'number') {
					if (
						!Number.isFinite(value) ||
						(Number.isInteger(value) && !Number.isSafeInteger(value))
					)
						invalid();
					if (
						(options.integerNumbersOnly ?? true) &&
						(!Number.isSafeInteger(value) ||
							!/^-?(?:0|[1-9][0-9]*)$/u.test(text.slice(offset, offset + length)))
					)
						invalid();
				}
			},
			onError: () => invalid()
		},
		{ disallowComments: true, allowTrailingComma: false, allowEmptyContent: false }
	);
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return invalid();
	}
}

/** Exact accepted canonical bytes; no JavaScript coercion, toJSON, or Unicode normalization. */
export function canonicalContractBytes(value: unknown, maxBytes = DEFAULT_MAX_BYTES): Uint8Array {
	const maximum = byteLimit(maxBytes);
	const ancestors = new Set<object>();
	let bytes = 0;
	const output: string[] = [];
	const append = (text: string): void => {
		bytes += Buffer.byteLength(text, 'utf8');
		if (bytes > maximum) invalid();
		output.push(text);
	};
	const encode = (item: unknown, depth: number): void => {
		if (depth > MAX_DEPTH) invalid();
		if (item === null) {
			append('null');
			return;
		}
		if (typeof item === 'string') {
			validString(item);
			append(JSON.stringify(item));
			return;
		}
		if (typeof item === 'boolean') {
			append(item ? 'true' : 'false');
			return;
		}
		if (typeof item === 'number') {
			if (!Number.isSafeInteger(item)) invalid();
			append(String(item));
			return;
		}
		if (typeof item !== 'object' || ancestors.has(item) || depth >= MAX_DEPTH) invalid();
		ancestors.add(item);
		try {
			if (Array.isArray(item)) {
				if (item.length > maximum) invalid();
				append('[');
				for (let index = 0; index < item.length; index++) {
					if (index > 0) append(',');
					encode(item[index], depth + 1);
				}
				append(']');
				return;
			}
			if (
				Object.getPrototypeOf(item) !== Object.prototype &&
				Object.getPrototypeOf(item) !== null
			)
				invalid();
			const keys = Reflect.ownKeys(item);
			if (keys.length > maximum || keys.some((key) => typeof key !== 'string')) invalid();
			append('{');
			let first = true;
			for (const key of (keys as string[]).sort()) {
				if (!/^[\x00-\x7f]*$/u.test(key)) invalid();
				const descriptor = Object.getOwnPropertyDescriptor(item, key);
				if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable)
					invalid();
				if (!first) append(',');
				first = false;
				append(`${JSON.stringify(key)}:`);
				encode(descriptor.value, depth + 1);
			}
			append('}');
		} finally {
			ancestors.delete(item);
		}
	};
	encode(value, 0);
	return new TextEncoder().encode(output.join(''));
}

export function canonicalContractDigest(value: unknown, maxBytes = DEFAULT_MAX_BYTES): string {
	return `sha256:${createHash('sha256').update(canonicalContractBytes(value, maxBytes)).digest('hex')}`;
}

function byteLimit(value = DEFAULT_MAX_BYTES): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 128 * 1024 * 1024) invalid();
	return value;
}
function validString(value: string): void {
	if (!value.isWellFormed()) invalid();
}
function invalid(): never {
	throw new TypeError('Invalid canonical contract JSON');
}
