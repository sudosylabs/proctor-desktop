/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type WindowScheme = 'system' | 'light' | 'dark';

/**
 * The window scheme last chosen on this computer. LaunchWindow opens before sign-in, so it cannot
 * read the account's settings; it uses this instead. It holds no account data.
 */
export interface WindowAppearanceStore {
	read(): WindowScheme;
	write(scheme: WindowScheme): void;
}

/**
 * A tiny JSON file under the application's user data directory, read once when the application
 * starts. Unreadable means System. Writes are queued and never block a window.
 */
export class FileWindowAppearanceStore implements WindowAppearanceStore {
	#scheme: WindowScheme;
	#writing: Promise<void> = Promise.resolve();

	private constructor(
		private readonly path: string,
		scheme: WindowScheme
	) {
		this.#scheme = scheme;
	}

	static async open(path: string): Promise<FileWindowAppearanceStore> {
		let scheme: WindowScheme = 'system';
		try {
			const value: unknown = JSON.parse(await readFile(path, 'utf8'));
			const stored =
				typeof value === 'object' && value !== null && 'scheme' in value
					? (value as { scheme: unknown }).scheme
					: undefined;
			if (stored === 'light' || stored === 'dark') scheme = stored;
		} catch {
			// A missing or damaged file is the system scheme.
		}
		return new FileWindowAppearanceStore(path, scheme);
	}

	read(): WindowScheme {
		return this.#scheme;
	}

	write(scheme: WindowScheme): void {
		if (this.#scheme === scheme) return;
		this.#scheme = scheme;
		this.#writing = this.#writing.then(() => this.#persist(scheme));
	}

	/** Resolves once every queued write has finished. */
	flush(): Promise<void> {
		return this.#writing;
	}

	async #persist(scheme: WindowScheme): Promise<void> {
		try {
			await mkdir(dirname(this.path), { recursive: true });
			const temporary = `${this.path}.tmp`;
			await writeFile(temporary, JSON.stringify({ scheme }) + '\n', { mode: 0o600 });
			await rename(temporary, this.path);
		} catch {
			// The next choice writes it again; LaunchWindow falls back to the system scheme.
		}
	}
}
