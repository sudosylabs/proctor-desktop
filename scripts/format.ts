import { writeFileSync } from 'node:fs';
import { FileSystemRepository } from '../build/checks/repository.ts';
import { formatText } from '../build/lib/format.ts';
import { repositoryPath, repositoryRoot } from '../build/lib/paths.ts';

const arguments_ = process.argv.slice(2);
if (arguments_.some((argument) => argument !== '--write') || arguments_.length > 1)
	throw new Error('Usage: npm run format:check | npm run format');
const write = arguments_.includes('--write');
const repository = new FileSystemRepository(repositoryRoot);
let checked = 0;
let changed = 0;
for (const path of repository.files()) {
	if (repository.kind(path) !== 'file') continue;
	const before = repository.read(path);
	const after = await formatText(path, before);
	if (after === undefined) continue;
	checked++;
	if (before !== after) {
		changed++;
		if (write) writeFileSync(repositoryPath(path), after);
		else console.error(`Formatting differs: ${path}`);
	}
}
console.log(`Formatting: ${checked} files checked; ${changed} ${write ? 'formatted' : 'differ'}.`);
if (changed && !write) process.exitCode = 1;
