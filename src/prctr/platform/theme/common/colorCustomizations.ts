export type IColorCustomizations = {
	readonly [id: string]: string | Readonly<Record<string, string>>;
};

const colorPattern = /^(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8}|default)$/iu;
const identifierPattern = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/u;
const scopePattern = /^\[[^\]]+\](?:\s*\[[^\]]+\])*$/u;

/** Bounded data-only override boundary. Unknown color IDs survive for future bundled controls. */
export function normalizeColorCustomizations(value: unknown): IColorCustomizations | undefined {
	let count = 0;
	function normalize(input: unknown, scoped: true): Readonly<Record<string, string>> | undefined;
	function normalize(input: unknown, scoped: false): IColorCustomizations | undefined;
	function normalize(input: unknown, scoped: boolean): IColorCustomizations | undefined {
		if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
		const output: Record<string, string | Readonly<Record<string, string>>> = {};
		for (const [key, color] of Object.entries(input)) {
			if (
				++count > 512 ||
				key.length > 256 ||
				['__proto__', 'prototype', 'constructor'].includes(key)
			)
				return undefined;
			if (!scoped && scopePattern.test(key)) {
				const nested = normalize(color, true);
				if (!nested) return undefined;
				output[key] = nested;
			} else {
				if (
					!identifierPattern.test(key) ||
					typeof color !== 'string' ||
					!colorPattern.test(color)
				)
					return undefined;
				output[key] = color;
			}
		}
		return Object.freeze(output);
	}
	return normalize(value, false);
}

export const colorCustomizationSchema = {
	type: 'object' as const,
	additionalProperties: false,
	patternProperties: {
		'^[A-Za-z][A-Za-z0-9]*(\\.[A-Za-z][A-Za-z0-9]*)*$': {
			type: 'string' as const,
			oneOf: [{ type: 'string' as const, format: 'color-hex', defaultSnippets: [{ body: '${1:#ff0000}' }] }, { const: 'default' }],
			pattern: '^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|default)$'
		},
		'^\\[[^\\]]+\\](\\s*\\[[^\\]]+\\])*$': {
			type: 'object' as const,
			additionalProperties: false,
			patternProperties: {
				'^[A-Za-z][A-Za-z0-9]*(\\.[A-Za-z][A-Za-z0-9]*)*$': {
					type: 'string' as const,
					oneOf: [{ type: 'string' as const, format: 'color-hex', defaultSnippets: [{ body: '${1:#ff0000}' }] }, { const: 'default' }],
					pattern:
						'^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|default)$'
				}
			}
		}
	}
};
