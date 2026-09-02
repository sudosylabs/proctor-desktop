import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Repository } from '../checks/types.ts';
import {
	SETTINGS_MANIFEST,
	SETTINGS_REGISTRY_VERSION,
	type SettingDeclaration
} from '../../src/prctr/platform/settings/common/settingsManifest.ts';
import { registryFingerprint } from '../../src/prctr/platform/settings/common/settingsRegistryFingerprint.ts';
import type { Generator } from './registry.ts';

const SCHEMA = 'resources/settings/settings.schema.json';
const CATALOG = 'resources/settings/settings.catalog.json';
const REJECTIONS = 'resources/settings/settings.rejections.json';
const FINGERPRINT = 'resources/settings/registry.fingerprint.json';

export const settingsRegistryGenerator: Generator = {
	id: 'settings.registry',
	inputs: [
		'src/prctr/platform/settings/common/settingsManifest.ts',
		'src/prctr/platform/settings/common/settingsRegistryFingerprint.ts'
	],
	committedOutputs: [SCHEMA, CATALOG, REJECTIONS, FINGERPRINT],
	buildOutputs: [],
	generate(_repository: Repository, outputRoot: string): void {
		const declarations = SETTINGS_MANIFEST as readonly SettingDeclaration[];
		validate(declarations);
		const fingerprint = registryFingerprint({
			version: SETTINGS_REGISTRY_VERSION,
			declarations
		});
		const effective = declarations.filter((item) => item.candidate !== 'prohibited');
		const language = effective.filter((item) => item.languageOverride);
		write(outputRoot, SCHEMA, {
			generatedBy: 'settings.registry',
			registryVersion: SETTINGS_REGISTRY_VERSION,
			registryFingerprint: fingerprint,
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			additionalProperties: true,
			properties: Object.fromEntries(effective.map((item) => [item.id, schemaFor(item)])),
			patternProperties: {
				'^\\[[A-Za-z0-9][A-Za-z0-9+._-]{0,63}\\]$': {
					type: 'object',
					additionalProperties: true,
					properties: Object.fromEntries(
						language.map((item) => [item.id, schemaFor(item)])
					)
				}
			}
		});
		write(outputRoot, CATALOG, {
			generatedBy: 'settings.registry',
			registryVersion: SETTINGS_REGISTRY_VERSION,
			registryFingerprint: fingerprint,
			settings: effective.map((item) => ({
				id: item.id,
				title: item.title.defaultMessage,
				titleMessageId: item.title.id,
				description: item.description.defaultMessage,
				descriptionMessageId: item.description.id,
				default: item.default,
				storage: item.storage,
				domain: item.domain,
				windows: item.windows,
				languageOverride: item.languageOverride,
				activation: item.activation,
				candidate: item.candidate
			}))
		});
		write(outputRoot, REJECTIONS, {
			generatedBy: 'settings.registry',
			registryVersion: SETTINGS_REGISTRY_VERSION,
			registryFingerprint: fingerprint,
			settings: declarations
				.filter((item) => item.candidate === 'prohibited')
				.map((item) => ({
					id: item.id,
					reason: item.rejectionReason?.defaultMessage,
					reasonMessageId: item.rejectionReason?.id
				}))
		});
		write(outputRoot, FINGERPRINT, {
			generatedBy: 'settings.registry',
			registryVersion: SETTINGS_REGISTRY_VERSION,
			registryFingerprint: fingerprint
		});
	}
};

function schemaFor(item: SettingDeclaration): Readonly<Record<string, unknown>> {
	return Object.fromEntries(
		Object.entries({
			type: item.type === 'integer' ? 'integer' : item.type,
			default: item.default,
			enum: item.enum,
			minimum: item.minimum,
			maximum: item.maximum,
			title: item.title.defaultMessage,
			description: item.description.defaultMessage
		}).filter(([, value]) => value !== undefined)
	);
}

function validate(declarations: readonly SettingDeclaration[]): void {
	const ids = new Set<string>();
	for (const declaration of declarations) {
		if (!/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(declaration.id))
			throw new Error(`Invalid setting identifier ${declaration.id}`);
		if (ids.has(declaration.id))
			throw new Error(`Duplicate setting identifier ${declaration.id}`);
		ids.add(declaration.id);
		if (declaration.candidate === 'prohibited' && !declaration.rejectionReason)
			throw new Error(`Prohibited setting ${declaration.id} requires a rejection reason`);
		if (declaration.candidate !== 'prohibited' && declaration.default === undefined)
			throw new Error(`Effective setting ${declaration.id} requires a default`);
	}
}

function write(outputRoot: string, path: string, value: unknown): void {
	const destination = join(outputRoot, path);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
