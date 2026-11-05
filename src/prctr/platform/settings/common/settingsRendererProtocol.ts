import type { IColorCustomizations } from '../../theme/common/colorCustomizations.js';
import { normalizeColorCustomizations } from '../../theme/common/colorCustomizations.js';
import { BUNDLED_THEMES } from '../../theme/common/bundledThemes.js';
import { SETTINGS_DOCUMENT_LIMITS } from './settingsDocument.js';

export interface UserSettingsPresentationProjection {
	readonly theme: string;
	readonly colorCustomizations?: IColorCustomizations;
	readonly zoomPercent: number;
	readonly reducedMotion: boolean;
}
export interface UserSettingsProjection {
	readonly source: string;
	readonly revision: string;
	readonly availability: 'available' | 'unavailable';
	readonly writable: boolean;
	readonly presentation: UserSettingsPresentationProjection;
}
export interface UserSettingsCommitIntent {
	readonly source: string;
	readonly expectedRevision: string;
	readonly idempotencyKey: string;
}
export interface UserSettingsPreviewIntent {
	readonly source: string;
}
export type UserSettingsCommitResponse =
	| { readonly kind: 'success' | 'conflict'; readonly projection: UserSettingsProjection }
	| { readonly kind: 'ambiguous' | 'unavailable' };

export function validateUserSettingsProjection(value: unknown): UserSettingsProjection {
	if (
		!isRecord(value) ||
		exactKeys(value, ['availability', 'presentation', 'revision', 'source', 'writable']) ===
			false ||
		!boundedSource(value.source) ||
		!boundedId(value.revision) ||
		!['available', 'unavailable'].includes(value.availability as string) ||
		typeof value.writable !== 'boolean' ||
		(value.availability === 'unavailable' && value.writable)
	)
		throw new TypeError('User Settings projection is invalid');
	return Object.freeze({
		source: value.source,
		revision: value.revision,
		availability: value.availability,
		writable: value.writable,
		presentation: validatePresentation(value.presentation)
	}) as UserSettingsProjection;
}
export function validateUserSettingsCommitIntent(value: unknown): UserSettingsCommitIntent {
	if (
		!isRecord(value) ||
		!exactKeys(value, ['expectedRevision', 'idempotencyKey', 'source']) ||
		!boundedSource(value.source) ||
		!boundedId(value.expectedRevision) ||
		typeof value.idempotencyKey !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value.idempotencyKey)
	)
		throw new TypeError('User Settings commit intent is invalid');
	return Object.freeze({
		source: value.source,
		expectedRevision: value.expectedRevision,
		idempotencyKey: value.idempotencyKey
	});
}
export function validateUserSettingsPreviewIntent(value: unknown): UserSettingsPreviewIntent {
	if (!isRecord(value) || !exactKeys(value, ['source']) || !boundedSource(value.source))
		throw new TypeError('User Settings preview intent is invalid');
	return Object.freeze({ source: value.source });
}
export function validateUserSettingsCommitResponse(value: unknown): UserSettingsCommitResponse {
	if (!isRecord(value) || typeof value.kind !== 'string')
		throw new TypeError('User Settings commit response is invalid');
	if (value.kind === 'success' || value.kind === 'conflict') {
		if (!exactKeys(value, ['kind', 'projection']))
			throw new TypeError('User Settings commit response is invalid');
		return Object.freeze({
			kind: value.kind,
			projection: validateUserSettingsProjection(value.projection)
		});
	}
	if ((value.kind === 'ambiguous' || value.kind === 'unavailable') && exactKeys(value, ['kind']))
		return Object.freeze({ kind: value.kind });
	throw new TypeError('User Settings commit response is invalid');
}
function boundedId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
function boundedSource(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length <= SETTINGS_DOCUMENT_LIMITS.maxBytes &&
		new TextEncoder().encode(value).byteLength <= SETTINGS_DOCUMENT_LIMITS.maxBytes
	);
}
function validatePresentation(value: unknown): UserSettingsPresentationProjection {
	if (
		!isRecord(value) ||
		!exactKeys(value, [
			'reducedMotion',
			'theme',
			'zoomPercent',
			...(value.colorCustomizations === undefined ? [] : ['colorCustomizations'])
		]) ||
		(value.colorCustomizations !== undefined &&
			!normalizeColorCustomizations(value.colorCustomizations)) ||
		!isOneOf(value.theme, [
			'dark',
			'highContrastDark',
			'highContrastLight',
			'light',
			...BUNDLED_THEMES.map((theme) => theme.name)
		] as const) ||
		!Number.isSafeInteger(value.zoomPercent) ||
		(value.zoomPercent as number) < 80 ||
		(value.zoomPercent as number) > 200 ||
		typeof value.reducedMotion !== 'boolean'
	)
		throw new TypeError('User Settings presentation projection is invalid');
	return Object.freeze({
		theme: value.theme,
		...(value.colorCustomizations === undefined
			? {}
			: { colorCustomizations: normalizeColorCustomizations(value.colorCustomizations)! }),
		zoomPercent: value.zoomPercent as number,
		reducedMotion: value.reducedMotion
	});
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value).sort();
	return (
		keys.length === expected.length &&
		keys.every((key, index) => key === [...expected].sort()[index])
	);
}
function isOneOf<const T extends readonly string[]>(
	value: unknown,
	choices: T
): value is T[number] {
	return typeof value === 'string' && choices.includes(value as T[number]);
}
