import { createHash } from 'node:crypto';
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	opendirSync,
	readSync,
	realpathSync
} from 'node:fs';
import { join, resolve } from 'node:path';

export interface WindowsNativeServiceBuildInventory {
	readonly schema_version: 1;
	readonly release_id: string;
	readonly executable: string;
	readonly files: readonly { relative_path: string; sha256: string; bytes: number }[];
}

/** Inventories a reviewed client package before the helper is built and signed.
 * This is build input, not signature verification or authority supplied by a client.
 * The installer must independently protect the versioned closure before SCM starts it.
 */
export class WindowsNativeServiceInventoryBuilder {
	build(
		directory: string,
		releaseId: string,
		executable: string
	): WindowsNativeServiceBuildInventory {
		if (!/^[A-Za-z0-9-]{1,64}$/.test(releaseId)) throw new Error('Invalid release ID');
		validatePath(executable);
		if (!executable.toLowerCase().endsWith('.exe'))
			throw new Error('Expected packaged executable');
		const root = resolve(directory);
		if (realpathSync(root) !== root || !lstatSync(root).isDirectory())
			throw new Error('Expected real package directory');
		const files: { relative_path: string; sha256: string; bytes: number }[] = [];
		const paths = new Set<string>();
		let total = 0;
		let entries = 0;
		let directories = 0;
		const visit = (relative: string): void => {
			const directory = opendirSync(join(root, relative));
			const names: string[] = [];
			try {
				for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
					if (++entries > 8192) throw new Error('Oversized package tree');
					names.push(entry.name);
				}
			} finally {
				directory.closeSync();
			}
			if (names.length === 0)
				throw new Error('Empty package directory is not represented by the file inventory');
			for (const name of names.sort()) {
				const path = relative ? `${relative}/${name}` : name;
				validatePath(path);
				const folded = path.toLowerCase();
				if (paths.has(folded)) throw new Error('Ambiguous or oversized package tree');
				paths.add(folded);
				const absolute = join(root, path);
				const stat = lstatSync(absolute);
				if (stat.isSymbolicLink()) throw new Error('Package symlink is not permitted');
				if (stat.isDirectory()) {
					// Native keeps up to256 additional ancestor handles outside this tree.
					if (++directories > 4096)
						throw new Error('Package exceeds native directory bound');
					visit(path);
					continue;
				}
				if (
					!stat.isFile() ||
					stat.nlink !== 1 ||
					stat.size <= 0 ||
					stat.size > 512 * 1024 * 1024 ||
					files.length >= 4096
				)
					throw new Error('Invalid package file');
				total += stat.size;
				if (total > 2 * 1024 * 1024 * 1024) throw new Error('Package exceeds byte bound');
				const handle = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
				try {
					const before = fstatSync(handle);
					if (
						before.ino !== stat.ino ||
						before.dev !== stat.dev ||
						before.size !== stat.size ||
						!before.isFile()
					)
						throw new Error('Package changed during inspection');
					const hash = createHash('sha256');
					const buffer = Buffer.alloc(256 * 1024);
					let position = 0;
					while (position < before.size) {
						const count = readSync(
							handle,
							buffer,
							0,
							Math.min(buffer.length, before.size - position),
							position
						);
						if (count === 0) throw new Error('Package truncated during inspection');
						hash.update(buffer.subarray(0, count));
						position += count;
					}
					const after = fstatSync(handle);
					const current = lstatSync(absolute);
					if (
						after.size !== before.size ||
						after.mtimeMs !== before.mtimeMs ||
						after.ctimeMs !== before.ctimeMs ||
						current.ino !== before.ino ||
						current.dev !== before.dev ||
						current.isSymbolicLink()
					)
						throw new Error('Package changed during inspection');
					files.push({
						relative_path: path,
						sha256: hash.digest('hex'),
						bytes: before.size
					});
				} finally {
					closeSync(handle);
				}
			}
		};
		visit('');
		if (!files.some((file) => file.relative_path === executable))
			throw new Error('Executable missing from package');
		const result: WindowsNativeServiceBuildInventory = {
			schema_version: 1,
			release_id: releaseId,
			executable,
			files
		};
		if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024)
			throw new Error('Inventory exceeds build input bound');
		return result;
	}
}

function validatePath(path: string): void {
	if (path.length === 0 || path.length > 240 || !/^[A-Za-z0-9._/-]+$/.test(path))
		throw new Error('Invalid Windows package path');
	for (const part of path.split('/')) {
		if (
			!part ||
			part === '.' ||
			part === '..' ||
			part.endsWith('.') ||
			/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)
		)
			throw new Error('Ambiguous Windows package path');
	}
}
