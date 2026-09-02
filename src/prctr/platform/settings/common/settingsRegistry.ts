import {
	SETTINGS_MANIFEST,
	SETTINGS_REGISTRY_VERSION,
	type EffectiveSettingId,
	type SettingDeclaration,
	type SettingId,
	type SettingValueMap
} from './settingsManifest.js';
import { registryFingerprint } from './settingsRegistryFingerprint.js';

export { registryFingerprint, stableStringify } from './settingsRegistryFingerprint.js';

export interface SettingsRegistry {
	readonly version: number;
	readonly fingerprint: string;
	readonly declarations: readonly Readonly<SettingDeclaration>[];
	declaration(id: string): Readonly<SettingDeclaration> | undefined;
	isKnown(id: string): id is SettingId;
	isEffective(id: string): id is EffectiveSettingId;
	normalize<K extends EffectiveSettingId>(id: K, value: unknown): SettingValueMap[K] | undefined;
}

function deepFreeze<T>(value: T): Readonly<T> {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

const declarations = deepFreeze(SETTINGS_MANIFEST.map((item) => ({ ...item })));
const byId = new Map<string, Readonly<SettingDeclaration>>(
	declarations.map((item) => [item.id, item])
);
if (byId.size !== declarations.length)
	throw new Error('The packaged settings manifest contains duplicate identifiers');

export const settingsRegistry: SettingsRegistry = Object.freeze({
	version: SETTINGS_REGISTRY_VERSION,
	fingerprint: registryFingerprint({ version: SETTINGS_REGISTRY_VERSION, declarations }),
	declarations,
	declaration: (id: string) => byId.get(id),
	isKnown: (id: string): id is SettingId => byId.has(id),
	isEffective: (id: string): id is EffectiveSettingId => byId.get(id)?.candidate !== 'prohibited',
	normalize<K extends EffectiveSettingId>(id: K, value: unknown): SettingValueMap[K] | undefined {
		const declaration = byId.get(id);
		if (declaration === undefined || declaration.candidate === 'prohibited') return undefined;
		if (declaration.type === 'boolean' && typeof value !== 'boolean') return undefined;
		if (declaration.type === 'string' && typeof value !== 'string') return undefined;
		if (
			(declaration.type === 'number' || declaration.type === 'integer') &&
			typeof value !== 'number'
		)
			return undefined;
		if (
			typeof value === 'number' &&
			(!Number.isFinite(value) ||
				(declaration.type === 'integer' && !Number.isInteger(value)))
		)
			return undefined;
		if (declaration.enum !== undefined && !declaration.enum.includes(value as never))
			return undefined;
		if (
			typeof value === 'number' &&
			((declaration.minimum !== undefined && value < declaration.minimum) ||
				(declaration.maximum !== undefined && value > declaration.maximum))
		)
			return undefined;
		return value as SettingValueMap[K];
	}
});

export function activeSettingIds(): readonly EffectiveSettingId[] {
	return settingsRegistry.declarations
		.filter((declaration) => declaration.candidate !== 'prohibited')
		.map((declaration) => declaration.id as EffectiveSettingId);
}
