import type {
	ITokenColorCustomizations,
	ISemanticTokenColorCustomizations
} from './tokenCustomizationTypes.js';
import {
	validateTokenColors,
	validateSemanticTokenColors
} from './tokenCustomizationValidation.generated.js';

/** Bound data before invoking the schema compiled from the pinned theme implementation. */
function normalize(value: unknown, validate: (value: unknown) => boolean): object | undefined {
	let entries = 0,
		characters = 0;
	const seen = new WeakSet<object>();
	const visit = (value: unknown, depth: number): unknown => {
		if (++entries > 8192 || depth > 12)
			throw new Error('Token customizations exceed their bound.');
		if (typeof value === 'string') {
			characters += value.length;
			if (characters > 256 * 1024)
				throw new Error('Token customizations exceed their bound.');
			return value;
		}
		if (value === null || typeof value === 'boolean') return value;
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value !== 'object' || !value || seen.has(value))
			throw new TypeError('Invalid token customization data.');
		seen.add(value);
		if (Array.isArray(value)) {
			if (value.length > 8192) throw new Error('Token customizations exceed their bound.');
			const result = Object.freeze(value.map((item) => visit(item, depth + 1)));
			seen.delete(value);
			return result;
		}
		if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
			throw new TypeError('Invalid token customization object.');
		// The original theme resolver recognizes theme-scoped values with instanceof
		// Object. Dangerous property names are rejected before assigning to this clone.
		const result: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			characters += key.length;
			if (characters > 256 * 1024 || ['__proto__', 'constructor', 'prototype'].includes(key))
				throw new TypeError('Invalid token customization key.');
			result[key] = visit(child, depth + 1);
		}
		seen.delete(value);
		return Object.freeze(result);
	};
	try {
		const result = visit(value, 0);
		return result && typeof result === 'object' && !Array.isArray(result) && validate(result)
			? result
			: undefined;
	} catch {
		return undefined;
	}
}

export function normalizeTokenColorCustomizations(
	value: unknown
): ITokenColorCustomizations | undefined {
	return normalize(value, validateTokenColors) as ITokenColorCustomizations | undefined;
}
export function normalizeSemanticTokenColorCustomizations(
	value: unknown
): ISemanticTokenColorCustomizations | undefined {
	return normalize(value, validateSemanticTokenColors) as
		ISemanticTokenColorCustomizations | undefined;
}
