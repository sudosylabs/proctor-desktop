import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check, Diagnostic } from './types.ts';
import { diagnostic } from './types.ts';
import { generators, validateGeneratorRegistry } from '../generators/registry.ts';

export const generatedCheck: Check = {
	id: 'generated.parity',
	category: 'generation',
	contractRequired: true,
	run: async ({ repository }) => {
		const diagnostics: Diagnostic[] = validateGeneratorRegistry(generators).map((problem) =>
			diagnostic(
				'generated.parity',
				'build/generators/registry.ts',
				problem,
				'Give every generator and output exactly one owner.'
			)
		);
		const known = new Map<string, string>();
		for (const generator of generators) {
			const outputRoot = mkdtempSync(join(tmpdir(), 'proctor-generated-'));
			try {
				await generator.generate(repository, outputRoot);
				for (const output of generator.committedOutputs) {
					known.set(output, generator.id);
					let expected: Uint8Array | undefined;
					try {
						expected = readFileSync(join(outputRoot, output));
					} catch {
						expected = undefined;
					}
					if (expected === undefined)
						diagnostics.push(
							diagnostic(
								'generated.parity',
								output,
								`Generator ${generator.id} did not produce its declared output.`,
								'Make generation total and deterministic.'
							)
						);
					else if (
						!repository.exists(output) ||
						!Buffer.from(repository.readBytes(output)).equals(Buffer.from(expected))
					)
						diagnostics.push(
							diagnostic(
								'generated.parity',
								output,
								`Committed output differs from generator ${generator.id}.`,
								'Run npm run generate and review the deterministic diff.'
							)
						);
				}
				const declared = new Set([
					...generator.committedOutputs,
					...generator.buildOutputs
				]);
				for (const output of listFiles(outputRoot))
					if (!declared.has(output))
						diagnostics.push(
							diagnostic(
								'generated.parity',
								output,
								`Generator ${generator.id} emitted an undeclared output.`,
								'Declare the output class or stop emitting it.'
							)
						);
			} finally {
				rmSync(outputRoot, { recursive: true, force: true });
			}
		}
		for (const path of repository.files()) {
			let text: string;
			try {
				text = repository.read(path);
			} catch {
				continue;
			}
			for (const match of text.matchAll(/@generated\s+by\s+([a-z][a-z0-9.-]+)/g))
				if (known.get(path) !== match[1])
					diagnostics.push(
						diagnostic(
							'generated.parity',
							path,
							`Generated marker names unregistered owner ${match[1]}.`,
							'Register the generator/output or remove the orphan marker.'
						)
					);
		}
		return diagnostics;
	}
};

function listFiles(root: string, directory = '', result: string[] = []): readonly string[] {
	for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
		const relative = directory === '' ? entry.name : `${directory}/${entry.name}`;
		if (entry.isDirectory()) listFiles(root, relative, result);
		else if (entry.isFile()) result.push(relative);
	}
	return result.sort();
}
