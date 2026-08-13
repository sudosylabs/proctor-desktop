import process from 'node:process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemRepository } from '../checks/repository.ts';
import { generators, validateGeneratorRegistry } from './registry.ts';

if (process.argv.length !== 3 || process.argv[2] !== '--write') throw new Error('Usage: node build/generators/main.ts --write');
const problems = validateGeneratorRegistry(generators);
if (problems.length > 0) throw new Error(problems.join('\n'));
const repository = new FileSystemRepository(process.cwd());
for (const generator of generators) {
  const outputRoot = mkdtempSync(join(tmpdir(), 'proctor-generate-'));
  try {
    await generator.generate(repository, outputRoot);
    for (const output of generator.committedOutputs) {
      const source = join(outputRoot, output); const destination = resolve(process.cwd(), output);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
  } finally { rmSync(outputRoot, { recursive: true, force: true }); }
}
process.stdout.write(`Generated ${generators.length} registered artifact set${generators.length === 1 ? '' : 's'}.\n`);
