import { globSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const nodeTarget = 'node24';
export const chromiumTarget = 'chrome152';

export function repositoryPath(path: string): string {
	if (
		!path ||
		path.includes('\\') ||
		path.startsWith('/') ||
		path.split('/').includes('..') ||
		/^[A-Za-z]:/.test(path)
	) {
		throw new Error(`Expected a relative repository path: ${path}`);
	}
	return resolve(repositoryRoot, path);
}

export function resetBuildOutput(name: string): string {
	if (!/^[a-z][a-z0-9-]+$/.test(name)) throw new Error(`Invalid build output name: ${name}`);
	const output = repositoryPath(`.build/${name}`);
	for (const path of [repositoryPath('.build'), output]) {
		try {
			if (lstatSync(path).isSymbolicLink())
				throw new Error(`Build output cannot be a symlink: ${path}`);
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
				throw error;
		}
	}
	rmSync(output, { recursive: true, force: true });
	mkdirSync(output, { recursive: true });
	return output;
}

export function selectFiles(patterns: readonly string[], root = repositoryRoot): string[] {
	const selected = new Set<string>();
	for (const pattern of patterns) {
		const matches = globSync(pattern, { cwd: root })
			.map((path) => path.replaceAll('\\', '/'))
			.sort();
		if (matches.length === 0) throw new Error(`Selection matched no files: ${pattern}`);
		for (const match of matches) {
			if (selected.has(match)) throw new Error(`File selected more than once: ${match}`);
			selected.add(match);
		}
	}
	if (selected.size === 0) throw new Error('An empty file selection is not a successful check.');
	return [...selected].sort();
}
