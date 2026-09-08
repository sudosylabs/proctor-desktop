import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import type { EntryKind, Repository } from './types.ts';

function normalize(path: string): string {
	const value = posix.normalize(path.replaceAll('\\', '/'));
	if (value === '..' || value.startsWith('../') || value.startsWith('/')) {
		throw new Error(`Repository path escapes its root: ${path}`);
	}
	return value === '.' ? '' : value;
}

export class FileSystemRepository implements Repository {
	readonly #root: string;
	readonly #files: readonly string[];

	constructor(root: string) {
		this.#root = resolve(root);
		const output = execFileSync(
			'git',
			['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
			{ cwd: this.#root }
		);
		this.#files = output
			.toString('utf8')
			.split('\0')
			.filter(Boolean)
			.map(normalize)
			// The index still lists tracked files deleted from the working tree.
			.filter((path) => this.kind(path) !== undefined)
			.sort();
	}

	files(): readonly string[] {
		return this.#files;
	}
	exists(path: string): boolean {
		return this.kind(path) !== undefined;
	}
	kind(path: string): EntryKind | undefined {
		try {
			const stat = lstatSync(this.#absolute(path));
			return stat.isSymbolicLink()
				? 'symlink'
				: stat.isDirectory()
					? 'directory'
					: stat.isFile()
						? 'file'
						: undefined;
		} catch {
			return undefined;
		}
	}
	read(path: string): string {
		return readFileSync(this.#absolute(path), 'utf8');
	}
	readBytes(path: string): Uint8Array {
		return readFileSync(this.#absolute(path));
	}
	readLink(path: string): string | undefined {
		return this.kind(path) === 'symlink' ? readlinkSync(this.#absolute(path)) : undefined;
	}
	#absolute(path: string): string {
		return resolve(this.#root, normalize(path));
	}
}

export type VirtualEntry = string | Uint8Array | { readonly symlink: string };

export class VirtualRepository implements Repository {
	readonly #entries: ReadonlyMap<string, VirtualEntry>;
	constructor(entries: Readonly<Record<string, VirtualEntry>>) {
		this.#entries = new Map(
			Object.entries(entries).map(([path, entry]) => [normalize(path), entry])
		);
	}
	files(): readonly string[] {
		return [...this.#entries.keys()].sort();
	}
	exists(path: string): boolean {
		return this.kind(path) !== undefined;
	}
	kind(path: string): EntryKind | undefined {
		const normalized = normalize(path);
		const entry = this.#entries.get(normalized);
		if (entry !== undefined)
			return typeof entry === 'object' && !(entry instanceof Uint8Array) && 'symlink' in entry
				? 'symlink'
				: 'file';
		const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
		return [...this.#entries.keys()].some((candidate) => candidate.startsWith(prefix))
			? 'directory'
			: undefined;
	}
	read(path: string): string {
		const entry = this.#entries.get(normalize(path));
		if (typeof entry === 'string') return entry;
		if (entry instanceof Uint8Array) return new TextDecoder().decode(entry);
		throw new Error(`Not a readable file: ${path}`);
	}
	readBytes(path: string): Uint8Array {
		const entry = this.#entries.get(normalize(path));
		if (typeof entry === 'string') return new TextEncoder().encode(entry);
		if (entry instanceof Uint8Array) return entry;
		throw new Error(`Not a readable file: ${path}`);
	}
	readLink(path: string): string | undefined {
		const entry = this.#entries.get(normalize(path));
		return typeof entry === 'object' && !(entry instanceof Uint8Array) && 'symlink' in entry
			? entry.symlink
			: undefined;
	}
}

export function resolveRepositoryPath(from: string, target: string): string {
	return normalize(posix.join(dirname(from), target));
}
