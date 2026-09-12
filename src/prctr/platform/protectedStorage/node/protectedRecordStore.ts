import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface ProtectedRecordStore {
	read(key: string): Promise<Uint8Array | undefined>;
	write(key: string, bytes: Uint8Array): Promise<void>;
	delete(key: string): Promise<void>;
	list(prefix?: string): Promise<readonly string[]>;
	dispose(): void;
}
export interface ProtectedRecordStoreOptions {
	/** Privileged application directory, never supplied by a renderer. */
	readonly directory: string;
	/** Immutable opaque principal/Attempt/purpose binding. */
	readonly scope: string;
	/** Fresh or OS-unwrapped 256-bit key. The store keeps and erases its own copy. */
	readonly key: Uint8Array;
	readonly maximumRecordBytes: number;
	readonly maximumTotalBytes: number;
	readonly maximumRecords: number;
	/** Rechecked before and after every asynchronous operation. */
	readonly authorized: () => boolean;
}
export class ProtectedStorageError extends Error {
	constructor(readonly code: 'unavailable' | 'denied' | 'capacity' | 'corrupt') {
		super(`Protected storage ${code}`);
	}
}

// One writer per partition, including independently constructed adapters in this process.
const partitions = new Set<string>();
const overhead = 29; // format byte, nonce and GCM authentication tag

/** Authenticated records, purpose-bound names, atomic replacement and bounded recovery. */
export class EncryptedRecordStore implements ProtectedRecordStore {
	readonly #key: Buffer;
	readonly #directory: string;
	#serial: Promise<unknown> = Promise.resolve();
	#disposed = false;
	#queuedWriteBytes = 0;
	constructor(private readonly options: ProtectedRecordStoreOptions) {
		if (
			!options.scope ||
			options.scope.length > 1024 ||
			options.key.byteLength !== 32 ||
			![options.maximumRecordBytes, options.maximumTotalBytes, options.maximumRecords].every(
				(value) => Number.isSafeInteger(value) && value > 0
			) ||
			options.maximumRecordBytes > options.maximumTotalBytes
		)
			throw new ProtectedStorageError('unavailable');
		this.#directory = join(
			resolve(options.directory),
			createHash('sha256').update(options.scope).digest('hex')
		);
		if (partitions.has(this.#directory)) throw new ProtectedStorageError('unavailable');
		partitions.add(this.#directory);
		this.#key = Buffer.from(options.key);
	}
	read(key: string): Promise<Uint8Array | undefined> {
		return this.#run(async () => {
			const path = this.#path(key);
			let file;
			try {
				file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			} catch (error) {
				if (missing(error)) return undefined;
				throw error;
			}
			try {
				const stat = await file.stat();
				if (
					!stat.isFile() ||
					stat.size < overhead ||
					stat.size > this.options.maximumRecordBytes + overhead
				)
					throw new ProtectedStorageError('corrupt');
				const bytes = Buffer.alloc(stat.size);
				let offset = 0;
				while (offset < bytes.length) {
					const { bytesRead } = await file.read(
						bytes,
						offset,
						bytes.length - offset,
						offset
					);
					if (!bytesRead) throw new ProtectedStorageError('corrupt');
					offset += bytesRead;
				}
				this.#assertAuthorized();
				if (bytes[0] !== 1) throw new ProtectedStorageError('corrupt');
				try {
					const decipher = createDecipheriv(
						'aes-256-gcm',
						this.#key,
						bytes.subarray(1, 13)
					);
					decipher.setAAD(this.#aad(key));
					decipher.setAuthTag(bytes.subarray(13, overhead));
					return Buffer.concat([
						decipher.update(bytes.subarray(overhead)),
						decipher.final()
					]);
				} catch {
					throw new ProtectedStorageError('corrupt');
				}
			} finally {
				await file.close();
			}
		});
	}
	write(key: string, content: Uint8Array): Promise<void> {
		// Copy at acceptance; caller mutations must not race protection.
		if (
			content.byteLength > this.options.maximumRecordBytes ||
			this.#queuedWriteBytes + content.byteLength > this.options.maximumTotalBytes
		)
			return Promise.reject(new ProtectedStorageError('capacity'));
		const bytes = Buffer.from(content);
		this.#queuedWriteBytes += bytes.length;
		return this.#run(async () => {
			const path = this.#path(key);
			const entries = await this.#inventory();
			const other = entries.filter((entry) => entry.key !== key);
			if (
				other.length >= this.options.maximumRecords ||
				other.reduce((sum, entry) => sum + entry.size, 0) + bytes.length >
					this.options.maximumTotalBytes
			)
				throw new ProtectedStorageError('capacity');
			this.#assertAuthorized();
			const nonce = randomBytes(12);
			const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
			cipher.setAAD(this.#aad(key));
			const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
			const temporary = join(this.#directory, `${randomBytes(16).toString('hex')}.tmp`);
			try {
				const file = await open(temporary, 'wx', 0o600);
				try {
					await file.writeFile(
						Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted])
					);
					await file.sync();
				} finally {
					await file.close();
				}
				this.#assertAuthorized();
				await rename(temporary, path);
				await this.#sync();
			} finally {
				await unlink(temporary).catch((error) => {
					if (!missing(error)) throw error;
				});
			}
		}).finally(() => {
			this.#queuedWriteBytes -= bytes.length;
			bytes.fill(0);
		});
	}
	delete(key: string): Promise<void> {
		return this.#run(async () => {
			try {
				await unlink(this.#path(key));
				await this.#sync();
			} catch (error) {
				if (!missing(error)) throw error;
			}
		});
	}
	list(prefix = ''): Promise<readonly string[]> {
		return this.#run(async () =>
			Object.freeze(
				(await this.#inventory())
					.map((entry) => entry.key)
					.filter((key) => key.startsWith(prefix))
					.sort()
			)
		);
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#key.fill(0);
		// Keep the writer fence until queued/in-flight operations finish.
		void this.#serial.finally(() => partitions.delete(this.#directory));
	}
	#path(key: string): string {
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new ProtectedStorageError('unavailable');
		return join(this.#directory, `${key}.record`);
	}
	#aad(key: string): Buffer {
		return Buffer.from(JSON.stringify([1, this.options.scope, key]));
	}
	#assertAuthorized(): void {
		if (this.#disposed || !this.options.authorized()) throw new ProtectedStorageError('denied');
	}
	#run<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#serial.then(async () => {
			this.#assertAuthorized();
			try {
				await mkdir(this.#directory, { recursive: true, mode: 0o700 });
				const stat = await lstat(this.#directory);
				if (!stat.isDirectory() || stat.isSymbolicLink())
					throw new ProtectedStorageError('unavailable');
				this.#assertAuthorized();
				const value = await operation();
				try {
					this.#assertAuthorized();
				} catch (error) {
					if (value instanceof Uint8Array) value.fill(0);
					throw error;
				}
				return value;
			} catch (error) {
				if (error instanceof ProtectedStorageError) throw error;
				throw new ProtectedStorageError('unavailable');
			}
		});
		this.#serial = result.catch(() => undefined);
		return result;
	}
	async #inventory(): Promise<{ key: string; size: number }[]> {
		const entries: { key: string; size: number }[] = [];
		let scanned = 0;
		for await (const item of await opendir(this.#directory)) {
			if (++scanned > this.options.maximumRecords + 16)
				throw new ProtectedStorageError('capacity');
			const name = item.name;
			if (/^[0-9a-f]{32}\.tmp$/.test(name) && item.isFile()) {
				// No writer runs concurrently in this partition; these are interrupted atomic writes.
				await unlink(join(this.#directory, name));
				continue;
			}
			if (!name.endsWith('.record')) throw new ProtectedStorageError('corrupt');
			const key = name.slice(0, -7);
			const stat = await lstat(this.#path(key));
			if (
				!stat.isFile() ||
				stat.isSymbolicLink() ||
				stat.size < overhead ||
				stat.size > this.options.maximumRecordBytes + overhead
			)
				throw new ProtectedStorageError('corrupt');
			entries.push({ key, size: stat.size - overhead });
			if (entries.length > this.options.maximumRecords)
				throw new ProtectedStorageError('capacity');
		}
		if (entries.reduce((sum, entry) => sum + entry.size, 0) > this.options.maximumTotalBytes)
			throw new ProtectedStorageError('capacity');
		return entries;
	}
	async #sync(): Promise<void> {
		if (process.platform === 'win32') return;
		const directory = await open(this.#directory, 'r');
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	}
}
function missing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
