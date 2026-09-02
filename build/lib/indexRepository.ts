import { execFileSync } from 'node:child_process';
import { VirtualRepository } from '../checks/repository.ts';
import { repositoryRoot } from './paths.ts';

export function stagedPaths(root = repositoryRoot): string[] {
	return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
		cwd: root
	})
		.toString('utf8')
		.split('\0')
		.filter(Boolean);
}

export function readIndex(root = repositoryRoot): VirtualRepository {
	const entries = Object.create(null) as Record<string, Uint8Array | { symlink: string }>;
	const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root }).toString(
		'utf8'
	);
	for (const record of index.split('\0').filter(Boolean)) {
		const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(record);
		if (!match || match[3] !== '0')
			throw new Error('Resolve unmerged index entries before checking staged content.');
		const [, mode, object, , path] = match;
		if (!path || !object) throw new Error('Malformed Git index entry.');
		if (mode === '160000')
			throw new Error(`Submodules are outside the repository graph: ${path}`);
		const bytes = execFileSync('git', ['cat-file', 'blob', object], {
			cwd: root,
			maxBuffer: 32 * 1024 * 1024
		});
		entries[path] = mode === '120000' ? { symlink: bytes.toString('utf8') } : bytes;
	}
	return new VirtualRepository(entries);
}
