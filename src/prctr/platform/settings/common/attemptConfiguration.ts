import type { EffectiveSettings, SettingConstraint } from './settingsResolution.js';
import { SETTINGS_REGISTRY_VERSION } from './settingsManifest.js';
import { settingsRegistry } from './settingsRegistry.js';

export const ATTEMPT_CONFIGURATION_SCHEMA_VERSION = 1;
const MAX_APPROVED_IDENTIFIERS = 128;

export interface AttemptConfigurationCandidate {
	readonly schemaVersion: 1;
	readonly registryVersion: number;
	readonly registryFingerprint: string;
	readonly desktopBuild: string;
	readonly desktopTarget: string;
	readonly userSettingsRevision: string;
	readonly presentation: {
		readonly colorTheme: 'light' | 'dark' | 'hcLight' | 'hcDark';
		readonly preferHighContrast: boolean;
		readonly zoomPercent: number;
		readonly editorFontSize: number;
		readonly editorLineHeight: number;
		readonly reducedMotion: boolean;
		readonly screenReaderMode: 'auto' | 'on' | 'off';
		readonly announcementMode: 'auto' | 'verbose' | 'minimal';
		readonly cursorStyle: 'line' | 'block' | 'underline';
		readonly cursorBlinking: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
	};
	readonly approvedCommands: readonly string[];
	readonly approvedKeybindings: readonly string[];
}

export interface FrozenAttemptConfiguration extends AttemptConfigurationCandidate {
	readonly attemptConfigurationRevision: string;
	readonly digest: string;
}

export interface AttemptConfigurationProjection {
	readonly attemptConfigurationRevision: string;
	readonly digest: string;
	readonly presentation: AttemptConfigurationCandidate['presentation'];
	readonly approvedCommands: readonly string[];
	readonly approvedKeybindings: readonly string[];
	readonly appliedConstraintReasons: readonly string[];
}

export type AttemptConfigurationCompatibility =
	| { readonly compatible: true }
	| { readonly compatible: false; readonly reason: 'schema' | 'registry' | 'target' | 'build' };

export function deriveAttemptConfiguration(
	settings: EffectiveSettings,
	identity: {
		readonly registryFingerprint: string;
		readonly desktopBuild: string;
		readonly desktopTarget: string;
		readonly userSettingsRevision: string;
	},
	approvedCommands: readonly string[],
	approvedKeybindings: readonly string[]
): AttemptConfigurationCandidate {
	return deepFreeze({
		schemaVersion: ATTEMPT_CONFIGURATION_SCHEMA_VERSION,
		registryVersion: SETTINGS_REGISTRY_VERSION,
		registryFingerprint: identity.registryFingerprint,
		desktopBuild: boundedIdentity(identity.desktopBuild),
		desktopTarget: boundedIdentity(identity.desktopTarget),
		userSettingsRevision: boundedIdentity(identity.userSettingsRevision),
		presentation: {
			colorTheme: settings.get('workbench.colorTheme'),
			preferHighContrast: settings.get('workbench.preferHighContrast'),
			zoomPercent: settings.get('window.zoomLevel'),
			editorFontSize: settings.get('editor.fontSize'),
			editorLineHeight: settings.get('editor.lineHeight'),
			reducedMotion: settings.get('accessibility.reducedMotion'),
			screenReaderMode: settings.get('accessibility.screenReaderMode'),
			announcementMode: settings.get('accessibility.announcementMode'),
			cursorStyle: settings.get('editor.cursorStyle'),
			cursorBlinking: settings.get('editor.cursorBlinking')
		},
		approvedCommands: normalizeCommands(approvedCommands),
		approvedKeybindings: normalizeKeybindings(approvedKeybindings)
	});
}

export function projectFrozenAttemptConfiguration(
	frozen: FrozenAttemptConfiguration,
	strongerConstraints: readonly SettingConstraint[]
): AttemptConfigurationProjection {
	const validated = validateFrozenAttemptConfiguration(frozen);
	const presentation = { ...validated.presentation };
	const reasons: string[] = [];
	const constrained = new Set<string>();
	for (const constraint of strongerConstraints) {
		if (constrained.has(constraint.id))
			throw new TypeError(`Constraint ${constraint.id} is duplicated`);
		constrained.add(constraint.id);
		switch (constraint.id) {
			case 'workbench.preferHighContrast': {
				const value = settingsRegistry.normalize(
					'workbench.preferHighContrast',
					constraint.value
				);
				if (value === undefined || (presentation.preferHighContrast && !value))
					throw new TypeError(
						'High-contrast constraint must preserve or strengthen the frozen presentation'
					);
				presentation.preferHighContrast = value;
				break;
			}
			case 'window.zoomLevel': {
				const value = settingsRegistry.normalize('window.zoomLevel', constraint.value);
				if (value === undefined || value < presentation.zoomPercent)
					throw new TypeError(
						'Zoom constraint must preserve or strengthen the frozen presentation'
					);
				presentation.zoomPercent = value;
				break;
			}
			case 'editor.fontSize': {
				const value = settingsRegistry.normalize('editor.fontSize', constraint.value);
				if (value === undefined || value < presentation.editorFontSize)
					throw new TypeError(
						'Font-size constraint must preserve or strengthen the frozen presentation'
					);
				presentation.editorFontSize = value;
				break;
			}
			case 'editor.lineHeight': {
				const value = settingsRegistry.normalize('editor.lineHeight', constraint.value);
				if (value === undefined || value < presentation.editorLineHeight)
					throw new TypeError(
						'Line-height constraint must preserve or strengthen the frozen presentation'
					);
				presentation.editorLineHeight = value;
				break;
			}
			case 'accessibility.reducedMotion': {
				const value = settingsRegistry.normalize(
					'accessibility.reducedMotion',
					constraint.value
				);
				if (value === undefined || (presentation.reducedMotion && !value))
					throw new TypeError(
						'Reduced-motion constraint must preserve or strengthen the frozen presentation'
					);
				presentation.reducedMotion = value;
				break;
			}
			case 'accessibility.screenReaderMode': {
				const value = settingsRegistry.normalize(
					'accessibility.screenReaderMode',
					constraint.value
				);
				if (
					value === undefined ||
					modeRank(value, ['off', 'auto', 'on']) <
						modeRank(presentation.screenReaderMode, ['off', 'auto', 'on'])
				)
					throw new TypeError(
						'Screen-reader constraint must preserve or strengthen the frozen presentation'
					);
				presentation.screenReaderMode = value;
				break;
			}
			case 'accessibility.announcementMode': {
				const value = settingsRegistry.normalize(
					'accessibility.announcementMode',
					constraint.value
				);
				if (
					value === undefined ||
					modeRank(value, ['minimal', 'auto', 'verbose']) <
						modeRank(presentation.announcementMode, ['minimal', 'auto', 'verbose'])
				)
					throw new TypeError(
						'Announcement constraint must preserve or strengthen the frozen presentation'
					);
				presentation.announcementMode = value;
				break;
			}
			default:
				throw new Error(
					`Constraint ${constraint.id} cannot alter an Attempt Configuration projection`
				);
		}
		if (typeof constraint.reason !== 'string')
			throw new TypeError('Attempt Configuration constraint reason is invalid');
		reasons.push(boundedReason(constraint.reason));
	}
	return deepFreeze({
		attemptConfigurationRevision: validated.attemptConfigurationRevision,
		digest: validated.digest,
		presentation,
		approvedCommands: [...validated.approvedCommands],
		approvedKeybindings: [...validated.approvedKeybindings],
		appliedConstraintReasons: reasons
	});
}

export function checkAttemptConfigurationCompatibility(
	frozen: FrozenAttemptConfiguration,
	current: {
		readonly registryFingerprint: string;
		readonly desktopBuild: string;
		readonly desktopTarget: string;
	}
): AttemptConfigurationCompatibility {
	if (frozen.schemaVersion !== ATTEMPT_CONFIGURATION_SCHEMA_VERSION)
		return { compatible: false, reason: 'schema' };
	const validated = validateFrozenAttemptConfiguration(frozen);
	if (
		validated.registryVersion !== SETTINGS_REGISTRY_VERSION ||
		validated.registryFingerprint !== current.registryFingerprint
	)
		return { compatible: false, reason: 'registry' };
	if (validated.desktopTarget !== current.desktopTarget)
		return { compatible: false, reason: 'target' };
	if (validated.desktopBuild !== current.desktopBuild)
		return { compatible: false, reason: 'build' };
	return { compatible: true };
}

export function validateFrozenAttemptConfiguration(value: unknown): FrozenAttemptConfiguration {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'registryVersion',
			'registryFingerprint',
			'desktopBuild',
			'desktopTarget',
			'userSettingsRevision',
			'presentation',
			'approvedCommands',
			'approvedKeybindings',
			'attemptConfigurationRevision',
			'digest'
		]) ||
		value.schemaVersion !== ATTEMPT_CONFIGURATION_SCHEMA_VERSION ||
		!Number.isSafeInteger(value.registryVersion) ||
		(value.registryVersion as number) <= 0 ||
		typeof value.registryFingerprint !== 'string' ||
		!/^fnv1a64:[0-9a-f]{16}$/u.test(value.registryFingerprint) ||
		typeof value.desktopBuild !== 'string' ||
		boundedIdentity(value.desktopBuild) !== value.desktopBuild ||
		typeof value.desktopTarget !== 'string' ||
		boundedIdentity(value.desktopTarget) !== value.desktopTarget ||
		typeof value.userSettingsRevision !== 'string' ||
		!boundedIdentifier(value.userSettingsRevision) ||
		typeof value.attemptConfigurationRevision !== 'string' ||
		!boundedIdentifier(value.attemptConfigurationRevision) ||
		typeof value.digest !== 'string' ||
		!/^sha256:[A-Za-z0-9_-]{6,128}$/u.test(value.digest)
	)
		throw new TypeError('Frozen Attempt Configuration identity or schema is invalid');
	const presentation = value.presentation;
	if (
		!isRecord(presentation) ||
		!hasExactKeys(presentation, [
			'colorTheme',
			'preferHighContrast',
			'zoomPercent',
			'editorFontSize',
			'editorLineHeight',
			'reducedMotion',
			'screenReaderMode',
			'announcementMode',
			'cursorStyle',
			'cursorBlinking'
		])
	)
		throw new TypeError('Frozen Attempt Configuration presentation is invalid');
	const normalizedPresentation = {
		colorTheme: settingsRegistry.normalize('workbench.colorTheme', presentation.colorTheme),
		preferHighContrast: settingsRegistry.normalize(
			'workbench.preferHighContrast',
			presentation.preferHighContrast
		),
		zoomPercent: settingsRegistry.normalize('window.zoomLevel', presentation.zoomPercent),
		editorFontSize: settingsRegistry.normalize('editor.fontSize', presentation.editorFontSize),
		editorLineHeight: settingsRegistry.normalize(
			'editor.lineHeight',
			presentation.editorLineHeight
		),
		reducedMotion: settingsRegistry.normalize(
			'accessibility.reducedMotion',
			presentation.reducedMotion
		),
		screenReaderMode: settingsRegistry.normalize(
			'accessibility.screenReaderMode',
			presentation.screenReaderMode
		),
		announcementMode: settingsRegistry.normalize(
			'accessibility.announcementMode',
			presentation.announcementMode
		),
		cursorStyle: settingsRegistry.normalize('editor.cursorStyle', presentation.cursorStyle),
		cursorBlinking: settingsRegistry.normalize(
			'editor.cursorBlinking',
			presentation.cursorBlinking
		)
	};
	if (Object.values(normalizedPresentation).some((item) => item === undefined))
		throw new TypeError('Frozen Attempt Configuration presentation is outside packaged bounds');
	if (
		!Array.isArray(value.approvedCommands) ||
		!value.approvedCommands.every((item) => typeof item === 'string') ||
		!Array.isArray(value.approvedKeybindings) ||
		!value.approvedKeybindings.every((item) => typeof item === 'string')
	)
		throw new TypeError('Frozen Attempt Configuration approvals are invalid');
	const approvedCommands = normalizeCommands(value.approvedCommands as string[]);
	const approvedKeybindings = normalizeKeybindings(value.approvedKeybindings as string[]);
	if (
		!sameStrings(approvedCommands, value.approvedCommands as string[]) ||
		!sameStrings(approvedKeybindings, value.approvedKeybindings as string[])
	)
		throw new TypeError('Frozen Attempt Configuration approvals are not canonical');
	return deepFreeze({
		schemaVersion: 1,
		registryVersion: value.registryVersion as number,
		registryFingerprint: value.registryFingerprint,
		desktopBuild: value.desktopBuild,
		desktopTarget: value.desktopTarget,
		userSettingsRevision: value.userSettingsRevision,
		presentation: normalizedPresentation as AttemptConfigurationCandidate['presentation'],
		approvedCommands,
		approvedKeybindings,
		attemptConfigurationRevision: value.attemptConfigurationRevision,
		digest: value.digest
	});
}

function normalizeCommands(values: readonly string[]): readonly string[] {
	if (values.length > MAX_APPROVED_IDENTIFIERS)
		throw new Error('Attempt Configuration identifier set is too large');
	const result = [
		...new Set(
			values
				.map((value) => value.trim())
				.filter((value) => /^[a-z][a-z0-9._-]{0,127}$/i.test(value))
		)
	].sort();
	return Object.freeze(result);
}

function normalizeKeybindings(values: readonly string[]): readonly string[] {
	if (values.length > MAX_APPROVED_IDENTIFIERS)
		throw new Error('Attempt Configuration identifier set is too large');
	const result = [
		...new Set(
			values
				.map((value) => value.trim())
				.filter(
					(value) =>
						value.length > 0 &&
						value.length <= 128 &&
						/^[A-Za-z0-9+._\[\]-]+(?: [A-Za-z0-9+._\[\]-]+)*$/u.test(value)
				)
		)
	].sort();
	return Object.freeze(result);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((item, index) => item === right[index]);
}
function modeRank<T extends string>(value: T, ordered: readonly T[]): number {
	return ordered.indexOf(value);
}
function boundedIdentifier(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function boundedIdentity(value: string): string {
	const bounded = value.trim();
	if (bounded.length === 0 || bounded.length > 128 || /[\u0000-\u001f]/u.test(bounded))
		throw new Error('Invalid Attempt Configuration identity');
	return bounded;
}

function boundedReason(reason: string): string {
	const sanitized = reason.replace(/[\r\n\u0000-\u001f\u007f]/gu, ' ').trim();
	return sanitized.slice(0, 160) || 'A trusted accessibility constraint applies.';
}

function deepFreeze<T>(value: T): T {
	if (typeof value === 'object' && value !== null) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
