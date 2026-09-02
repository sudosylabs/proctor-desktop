import { readFileSync } from 'node:fs';
import { repositoryPath } from '../build/lib/paths.ts';
import { runNode } from '../build/lib/process.ts';

if (process.argv.length > 2) throw new Error('Usage: npm run check:types');
const solution = JSON.parse(readFileSync(repositoryPath('tsconfig.json'), 'utf8')) as {
	references: { path: string }[];
};
// This is an editor index, not a composite/declaration build. Check every runtime independently.
for (const project of solution.references)
	runNode(['node_modules/typescript/bin/tsc', '--project', project.path, '--noEmit']);
