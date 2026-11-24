import { tokenCustomizationsGenerator } from './tokenCustomizations.ts';
import { serverApiGenerator } from './serverApi.ts';
import { serverRealtimeGenerator } from './serverRealtime.ts';
import { productMetadataGenerator } from './productMetadata.ts';
import { bundledThemesGenerator } from './bundledThemes.ts';
import { plumPaletteGenerator } from './plumPalette.ts';
import { phosphorIconsGenerator } from './phosphorIcons.ts';
import type { Repository } from '../checks/types.ts';
import { nativeAgentProtocolGenerator } from './nativeAgentProtocol.ts';
import { localizationCatalogGenerator } from './localizationCatalog.ts';
import { settingsRegistryGenerator } from './settingsRegistry.ts';
import { createFormatOwnershipGenerator } from './formatOwnership.ts';

export interface Generator {
	readonly id: string;
	readonly inputs: readonly string[];
	readonly committedOutputs: readonly string[];
	readonly buildOutputs: readonly string[];
	generate(repository: Repository, outputRoot: string): void | Promise<void>;
}

const productGenerators: readonly Generator[] = [
	serverApiGenerator,
	serverRealtimeGenerator,
	tokenCustomizationsGenerator,
	productMetadataGenerator,
	// Writes the Proctor themes that theme.resources then bundles.
	plumPaletteGenerator,
	bundledThemesGenerator,
	phosphorIconsGenerator,
	localizationCatalogGenerator,
	settingsRegistryGenerator,
	nativeAgentProtocolGenerator
];

export const generators: readonly Generator[] = [
	...productGenerators,
	createFormatOwnershipGenerator(productGenerators)
];

export function validateGeneratorRegistry(entries: readonly Generator[]): readonly string[] {
	const problems: string[] = [];
	const ids = new Set<string>();
	const outputs = new Map<string, string>();
	for (const entry of entries) {
		if (ids.has(entry.id)) problems.push(`duplicate generator id ${entry.id}`);
		ids.add(entry.id);
		for (const input of entry.inputs)
			if (!isRepositoryPath(input))
				problems.push(`input ${input} for ${entry.id} is not a safe repository path`);
		for (const output of [...entry.committedOutputs, ...entry.buildOutputs]) {
			if (!isRepositoryPath(output))
				problems.push(`output ${output} for ${entry.id} is not a safe repository path`);
			const owner = outputs.get(output);
			if (owner !== undefined)
				problems.push(`output ${output} is owned by both ${owner} and ${entry.id}`);
			outputs.set(output, entry.id);
		}
	}
	return problems.sort();
}

function isRepositoryPath(path: string): boolean {
	return (
		path !== '' &&
		!path.startsWith('/') &&
		!path.includes('\\') &&
		!path.split('/').includes('..')
	);
}
