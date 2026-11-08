/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The Institution origin last verified on this computer, so LaunchWindow starts from it instead
 * of an empty address. It is public server identity, never a credential or account data. Its
 * owner normalizes what it reads, as it would a typed address.
 */
export interface ServerOriginStore {
	read(): string | undefined;
	write(origin: string): void;
	clear(): void;
}

/** Longer than any origin the readiness check accepts. */
const MAX_ORIGIN_LENGTH = 2048;

/**
 * A tiny JSON file under the application's user data directory, read once when the application
 * starts. Unreadable means nothing is remembered. Writes are queued and never block a window.
 */
export class FileServerOriginStore implements ServerOriginStore {
	#origin: string | undefined;
	#writing: Promise<void> = Promise.resolve();

	private constructor(
		private readonly path: string,
		origin: string | undefined
	) {
		this.#origin = origin;
	}

	static async open(path: string): Promise<FileServerOriginStore> {
		let origin: string | undefined;
		try {
			const value: unknown = JSON.parse(await readFile(path, 'utf8'));
			const stored =
				typeof value === 'object' && value !== null && 'origin' in value
					? (value as { origin: unknown }).origin
					: undefined;
			if (
				typeof stored === 'string' &&
				stored.length > 0 &&
				stored.length <= MAX_ORIGIN_LENGTH
			)
				origin = stored;
		} catch {
			// A missing or damaged file remembers nothing.
		}
		return new FileServerOriginStore(path, origin);
	}

	read(): string | undefined {
		return this.#origin;
	}

	write(origin: string): void {
		if (this.#origin === origin) return;
		this.#origin = origin;
		this.#writing = this.#writing.then(() => this.#persist(origin));
	}

	clear(): void {
		if (this.#origin === undefined) return;
		this.#origin = undefined;
		this.#writing = this.#writing.then(() => this.#persist(undefined));
	}

	/** Resolves once every queued write has finished. */
	flush(): Promise<void> {
		return this.#writing;
	}

	async #persist(origin: string | undefined): Promise<void> {
		try {
			if (origin === undefined) {
				await rm(this.path, { force: true });
				return;
			}
			await mkdir(dirname(this.path), { recursive: true });
			const temporary = `${this.path}.tmp`;
			await writeFile(temporary, JSON.stringify({ origin }) + '\n', { mode: 0o600 });
			await rename(temporary, this.path);
		} catch {
			// The next verified server writes it again; LaunchWindow then asks for the address.
		}
	}
}
