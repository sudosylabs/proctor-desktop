import { safeStorage } from 'electron';
import { mkdir, lstat, readFile, rename, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
	DesktopCredentialStore,
	StoredDesktopSession
} from '../node/desktopCredentialStore.js';
import { DesktopAuthorizationError } from '../node/desktopAuthorizationError.js';

/** Refresh credentials are encrypted by Keychain/DPAPI; signing keys stay in native custody. */
export class OsDesktopCredentialStore implements DesktopCredentialStore {
	constructor(private readonly directory: string) {}
	async #path(scope: string): Promise<string> {
		if (!/^[0-9a-f]{64}$/.test(scope))
			throw new DesktopAuthorizationError('storageUnavailable');
		if (
			!safeStorage.isEncryptionAvailable() ||
			(process.platform !== 'darwin' &&
				process.platform !== 'win32' &&
				['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()))
		)
			throw new DesktopAuthorizationError('storageUnavailable');
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const folder = await lstat(this.directory);
		if (!folder.isDirectory() || folder.isSymbolicLink())
			throw new DesktopAuthorizationError('storageUnavailable');
		return join(this.directory, `${scope}.credential`);
	}
	async read(scope: string): Promise<StoredDesktopSession | undefined> {
		try {
			const path = await this.#path(scope);
			let stat;
			try {
				stat = await lstat(path);
			} catch (error) {
				if (isMissing(error)) return undefined;
				throw error;
			}
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw new Error();
			const value: unknown = JSON.parse(safeStorage.decryptString(await readFile(path)));
			if (!valid(value)) throw new Error();
			return Object.freeze(value);
		} catch {
			throw new DesktopAuthorizationError('storageUnavailable');
		}
	}
	async write(scope: string, value: StoredDesktopSession): Promise<void> {
		let temporary: string | undefined;
		try {
			if (!valid(value)) throw new Error();
			const path = await this.#path(scope);
			const encrypted = safeStorage.encryptString(JSON.stringify(value));
			temporary = `${path}.${randomBytes(16).toString('hex')}.tmp`;
			const file = await open(temporary, 'wx', 0o600);
			try {
				await file.writeFile(encrypted);
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(temporary, path);
			temporary = undefined;
			// Flush the published file, then the parent entry on platforms with directory fsync.
			const published = await open(path, 'r+');
			try {
				await published.sync();
			} finally {
				await published.close();
			}
			await this.#syncDirectory();
		} catch {
			throw new DesktopAuthorizationError('storageUnavailable');
		} finally {
			if (temporary) await unlink(temporary).catch(() => undefined);
		}
	}
	async #syncDirectory(): Promise<void> {
		if (process.platform === 'win32') return; // Windows FlushFileBuffers uses the published file handle above.
		const directory = await open(this.directory, 'r');
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	}
	async delete(scope: string): Promise<void> {
		try {
			await unlink(await this.#path(scope));
			await this.#syncDirectory();
		} catch (error) {
			if (!isMissing(error)) throw new DesktopAuthorizationError('storageUnavailable');
		}
	}
}
function isMissing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function valid(value: unknown): value is StoredDesktopSession {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	if (
		Object.keys(item).length !== 11 ||
		item.version !== 1 ||
		(item.phase !== 'usable' && item.phase !== 'rotationPending')
	)
		return false;
	for (const field of [
		'institutionId',
		'installationId',
		'principalId',
		'sessionId',
		'registrationId'
	])
		if (
			typeof item[field] !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item[field])
		)
			return false;
	return (
		typeof item.origin === 'string' &&
		item.origin.length <= 2048 &&
		typeof item.refreshToken === 'string' &&
		/^[A-Za-z0-9_-]{43}$/.test(item.refreshToken) &&
		typeof item.keyThumbprint === 'string' &&
		/^[A-Za-z0-9_-]{43}$/.test(item.keyThumbprint) &&
		Number.isSafeInteger(item.refreshExpiresAt) &&
		Number(item.refreshExpiresAt) > 0
	);
}
