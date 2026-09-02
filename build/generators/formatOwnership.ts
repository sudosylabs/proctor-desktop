import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formattingIgnore } from '../lib/formatOwnership.ts';
import type { Generator } from './registry.ts';

export function createFormatOwnershipGenerator(owners: readonly Generator[]): Generator {
	return {
		id: 'tooling.format-ownership',
		inputs: [
			'docs/upstream/vscode-ports',
			'build/generators/registry.ts',
			'build/lib/formatOwnership.ts'
		],
		committedOutputs: ['.prettierignore'],
		buildOutputs: [],
		generate(repository, outputRoot) {
			mkdirSync(outputRoot, { recursive: true });
			writeFileSync(
				join(outputRoot, '.prettierignore'),
				formattingIgnore(repository, [
					'.prettierignore',
					...owners.flatMap((owner) => owner.committedOutputs)
				])
			);
		}
	};
}
