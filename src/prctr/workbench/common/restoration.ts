/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type PresentationScope = 'attemptPresentation' | 'device' | 'principalComposition' | 'windowSession';
export interface PresentationCategory {
	readonly id: string;
	readonly scope: PresentationScope;
	readonly schemaVersion: number;
	readonly sensitivity: 'nonSensitive';
	readonly cleanupOwner: string;
}
export interface RestorableItemReference { readonly typeId: string; readonly logicalIdentity: string; readonly viewState?: Readonly<Record<string, unknown>> }

const SENSITIVE_KEY = /(?:answer|authorization|browserActivity|content|credential|evidence|privateKey|securityObservation|source|token)/iu;
const IDENTIFIER = /^[a-z][a-z0-9.-]{0,127}$/u;

export class PresentationCategoryRegistry {
	readonly #categories = new Map<string, PresentationCategory>();
	register(category: PresentationCategory): void {
		if (!IDENTIFIER.test(category.id) || !IDENTIFIER.test(category.cleanupOwner)) throw new Error('Presentation category identifiers are invalid');
		if (!Number.isSafeInteger(category.schemaVersion) || category.schemaVersion < 1) throw new RangeError('Presentation category schemaVersion must be positive');
		if (this.#categories.has(category.id)) throw new Error(`Presentation category ${category.id} is already registered`);
		this.#categories.set(category.id, Object.freeze({ ...category }));
	}
	get(id: string): PresentationCategory | undefined { return this.#categories.get(id); }
}

export function sanitizeRestorationReferences(value: unknown, admittedTypes: ReadonlySet<string>): readonly RestorableItemReference[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	const output: RestorableItemReference[] = [];
	for (const candidate of value.slice(0, 32)) {
		if (!isRecord(candidate)) continue;
		if (typeof candidate.typeId !== 'string' || !admittedTypes.has(candidate.typeId)) continue;
		if (typeof candidate.logicalIdentity !== 'string' || candidate.logicalIdentity.length === 0 || candidate.logicalIdentity.length > 512) continue;
		const viewState = sanitizeViewState(candidate.viewState, 0);
		if (candidate.viewState !== undefined && viewState === undefined) continue;
		output.push(Object.freeze({ typeId: candidate.typeId, logicalIdentity: candidate.logicalIdentity, ...(viewState === undefined ? {} : { viewState }) }));
	}
	return Object.freeze(output);
}

function sanitizeViewState(value: unknown, depth: number): Readonly<Record<string, unknown>> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value) || depth > 4 || Object.keys(value).length > 64) return undefined;
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const [key, child] of Object.entries(value)) {
		if (!IDENTIFIER.test(key) || SENSITIVE_KEY.test(key)) return undefined;
		const sanitized = sanitizeValue(child, depth + 1); if (sanitized === INVALID) return undefined; output[key] = sanitized;
	}
	return Object.freeze(output);
}
const INVALID = Symbol('invalid');
function sanitizeValue(value: unknown, depth: number): unknown | typeof INVALID {
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID;
	if (typeof value === 'string') return value.length <= 4096 ? value : INVALID;
	if (depth > 4) return INVALID;
	if (Array.isArray(value)) {
		if (value.length > 64) return INVALID; const output: unknown[] = [];
		for (const child of value) { const sanitized = sanitizeValue(child, depth + 1); if (sanitized === INVALID) return INVALID; output.push(sanitized); }
		return Object.freeze(output);
	}
	return sanitizeViewState(value, depth);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
