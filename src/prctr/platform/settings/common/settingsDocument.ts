import { getNodeValue, parseTree, type Node, type ParseError } from '../../../base/common/json.js';
import { getParseErrorMessage } from '../../../base/common/jsonErrorMessages.js';
import { settingsRegistry } from './settingsRegistry.js';
import { findJsonDepthOverflow } from '../../../base/common/jsonBounds.js';

export const SETTINGS_DOCUMENT_LIMITS = Object.freeze({
	maxBytes: 128 * 1024,
	maxDepth: 16,
	maxProperties: 512,
	maxStringLength: 16 * 1024,
	maxLanguageOverrides: 32
});

export type SettingsDiagnosticCode =
	| 'syntax'
	| 'too-large'
	| 'too-deep'
	| 'too-many-properties'
	| 'string-too-long'
	| 'too-many-overrides'
	| 'duplicate-key'
	| 'dangerous-key'
	| 'confusable-key'
	| 'invalid-root'
	| 'invalid-value'
	| 'prohibited-key'
	| 'invalid-language-override';

export interface SettingsDiagnostic {
	readonly code: SettingsDiagnosticCode;
	readonly key?: string;
	readonly offset: number;
	readonly length: number;
	readonly message: string;
}

export interface ParsedSettingsDocument {
	readonly source: string;
	readonly valid: boolean;
	readonly root?: Readonly<Record<string, unknown>>;
	readonly diagnostics: readonly SettingsDiagnostic[];
	readonly values: ReadonlyMap<string, unknown>;
	readonly languageValues: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
}

const languageOverridePattern = /^\[([a-z0-9][a-z0-9+._-]{0,63})\]$/i;
const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function parseSettingsDocument(source: string): ParsedSettingsDocument {
	const diagnostics: SettingsDiagnostic[] = [];
	if (
		source.length > SETTINGS_DOCUMENT_LIMITS.maxBytes ||
		new TextEncoder().encode(source).byteLength > SETTINGS_DOCUMENT_LIMITS.maxBytes
	) {
		diagnostics.push({
			code: 'too-large',
			offset: 0,
			length: source.length,
			message: `Settings source exceeds ${SETTINGS_DOCUMENT_LIMITS.maxBytes} bytes.`
		});
		return freezeResult(source, diagnostics, undefined, new Map(), new Map());
	}
	const syntaxErrors: ParseError[] = [];
	const depthOverflow = findJsonDepthOverflow(source, SETTINGS_DOCUMENT_LIMITS.maxDepth);
	if (depthOverflow !== undefined) {
		diagnostics.push({
			code: 'too-deep',
			offset: depthOverflow,
			length: 1,
			message: `Settings nesting exceeds ${SETTINGS_DOCUMENT_LIMITS.maxDepth} levels.`
		});
		return freezeResult(source, diagnostics, undefined, new Map(), new Map());
	}
	const node = parseTree(source, syntaxErrors, {
		allowTrailingComma: true,
		allowEmptyContent: false
	});
	diagnostics.push(
		...syntaxErrors.map((error) => ({
			code: 'syntax' as const,
			offset: error.offset,
			length: error.length,
			message: getParseErrorMessage(error.error) || `JSONC parse error ${error.error}`
		}))
	);
	if (node === undefined || node.type !== 'object') {
		diagnostics.push({
			code: 'invalid-root',
			offset: node?.offset ?? 0,
			length: node?.length ?? source.length,
			message: 'User Settings must be a JSONC object.'
		});
		return freezeResult(source, diagnostics, undefined, new Map(), new Map());
	}
	let propertyCount = 0;
	let overrideCount = 0;
	inspectTree(node, 1, diagnostics, (state) => {
		propertyCount += state.properties;
		overrideCount += state.overrides;
	});
	if (propertyCount > SETTINGS_DOCUMENT_LIMITS.maxProperties)
		diagnostics.push({
			code: 'too-many-properties',
			offset: 0,
			length: source.length,
			message: `Settings source contains more than ${SETTINGS_DOCUMENT_LIMITS.maxProperties} properties.`
		});
	if (overrideCount > SETTINGS_DOCUMENT_LIMITS.maxLanguageOverrides)
		diagnostics.push({
			code: 'too-many-overrides',
			offset: 0,
			length: source.length,
			message: `Settings source contains more than ${SETTINGS_DOCUMENT_LIMITS.maxLanguageOverrides} language overrides.`
		});

	const root = getNodeValue(node) as Record<string, unknown>;
	const values = new Map<string, unknown>();
	const languageValues = new Map<string, ReadonlyMap<string, unknown>>();
	for (const property of node.children ?? []) {
		const keyNode = property.children?.[0];
		const valueNode = property.children?.[1];
		const key = keyNode?.value;
		if (typeof key !== 'string' || valueNode === undefined) continue;
		const language = languageOverridePattern.exec(key)?.[1];
		if (language !== undefined) {
			if (valueNode.type !== 'object') {
				diagnostics.push({
					code: 'invalid-language-override',
					key,
					offset: valueNode.offset,
					length: valueNode.length,
					message: 'A language override must contain an object.'
				});
				continue;
			}
			const overrides = new Map<string, unknown>();
			for (const nested of valueNode.children ?? []) {
				const nestedKeyNode = nested.children?.[0];
				const nestedValueNode = nested.children?.[1];
				const nestedKey = nestedKeyNode?.value;
				if (typeof nestedKey !== 'string' || nestedValueNode === undefined) continue;
				validateSettingValue(
					nestedKey,
					getNodeValue(nestedValueNode),
					nestedValueNode,
					true,
					diagnostics,
					overrides
				);
			}
			languageValues.set(language.toLowerCase(), overrides);
			continue;
		}
		validateSettingValue(key, getNodeValue(valueNode), valueNode, false, diagnostics, values);
	}
	return freezeResult(source, diagnostics, root, values, languageValues);
}

function inspectTree(
	node: Node,
	depth: number,
	diagnostics: SettingsDiagnostic[],
	update: (state: { properties: number; overrides: number }) => void
): void {
	if (depth > SETTINGS_DOCUMENT_LIMITS.maxDepth)
		diagnostics.push({
			code: 'too-deep',
			offset: node.offset,
			length: node.length,
			message: `Settings nesting exceeds ${SETTINGS_DOCUMENT_LIMITS.maxDepth} levels.`
		});
	if (
		node.type === 'string' &&
		typeof node.value === 'string' &&
		node.value.length > SETTINGS_DOCUMENT_LIMITS.maxStringLength
	)
		diagnostics.push({
			code: 'string-too-long',
			offset: node.offset,
			length: node.length,
			message: `A settings string exceeds ${SETTINGS_DOCUMENT_LIMITS.maxStringLength} characters.`
		});
	if (node.type === 'object') {
		const seen = new Set<string>();
		for (const property of node.children ?? []) {
			const keyNode = property.children?.[0];
			const valueNode = property.children?.[1];
			const key = keyNode?.value;
			if (typeof key !== 'string' || keyNode === undefined) continue;
			update({
				properties: 1,
				overrides: depth === 1 && languageOverridePattern.test(key) ? 1 : 0
			});
			if (seen.has(key))
				diagnostics.push({
					code: 'duplicate-key',
					key,
					offset: keyNode.offset,
					length: keyNode.length,
					message: `Setting key ${key} is duplicated.`
				});
			seen.add(key);
			if (dangerousKeys.has(key))
				diagnostics.push({
					code: 'dangerous-key',
					key,
					offset: keyNode.offset,
					length: keyNode.length,
					message: `Setting key ${key} is not permitted.`
				});
			if (
				key.normalize('NFKC') !== key ||
				/[\u202a-\u202e\u2066-\u2069\u200b-\u200f]/u.test(key)
			)
				diagnostics.push({
					code: 'confusable-key',
					key,
					offset: keyNode.offset,
					length: keyNode.length,
					message: `Setting key ${key} contains confusable characters.`
				});
			if (valueNode !== undefined) inspectTree(valueNode, depth + 1, diagnostics, update);
		}
	} else {
		for (const child of node.children ?? []) inspectTree(child, depth + 1, diagnostics, update);
	}
}

function validateSettingValue(
	key: string,
	value: unknown,
	node: Node,
	languageOverride: boolean,
	diagnostics: SettingsDiagnostic[],
	destination: Map<string, unknown>
): void {
	const declaration = settingsRegistry.declaration(key);
	if (declaration === undefined) return; // Preserved but inactive.
	if (declaration.candidate === 'prohibited') {
		diagnostics.push({
			code: 'prohibited-key',
			key,
			offset: node.offset,
			length: node.length,
			message: declaration.rejectionReason?.defaultMessage ?? `${key} is prohibited.`
		});
		return;
	}
	if (languageOverride && !declaration.languageOverride) {
		diagnostics.push({
			code: 'invalid-language-override',
			key,
			offset: node.offset,
			length: node.length,
			message: `${key} does not support language overrides.`
		});
		return;
	}
	if (settingsRegistry.normalize(key as never, value) === undefined) {
		diagnostics.push({
			code: 'invalid-value',
			key,
			offset: node.offset,
			length: node.length,
			message: `The value for ${key} does not satisfy its packaged schema.`
		});
		return;
	}
	destination.set(key, value);
}

function freezeResult(
	source: string,
	diagnostics: SettingsDiagnostic[],
	root: Readonly<Record<string, unknown>> | undefined,
	values: Map<string, unknown>,
	languageValues: Map<string, ReadonlyMap<string, unknown>>
): ParsedSettingsDocument {
	const valid = diagnostics.length === 0;
	return Object.freeze({
		source,
		valid,
		...(root === undefined ? {} : { root: Object.freeze(root) }),
		diagnostics: Object.freeze(diagnostics),
		values,
		languageValues
	});
}
