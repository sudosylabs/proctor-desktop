import { safeStorage } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
	EncryptedRecordStore,
	ProtectedStorageError,
	type ProtectedRecordStoreOptions
} from '../node/protectedRecordStore.js';

/** Composition-only factory. The OS wraps the data key; signing keys are a separate native capability. */
export async function openOsProtectedRecordStore(
	options: Omit<ProtectedRecordStoreOptions, 'key'>
): Promise<EncryptedRecordStore> {
	if (
		!options.authorized() ||
		!safeStorage.isEncryptionAvailable() ||
		(process.platform !== 'darwin' &&
			process.platform !== 'win32' &&
			['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()))
	)
		throw new ProtectedStorageError('denied');
	await mkdir(options.directory, { recursive: true, mode: 0o700 });
	const directory = await lstat(options.directory);
	if (!directory.isDirectory() || directory.isSymbolicLink())
		throw new ProtectedStorageError('unavailable');
	const binding = createHash('sha256').update(options.scope).digest('hex');
	const path = join(options.directory, `${binding}.key`);
	let key: Buffer | undefined;
	try {
		try {
			const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const stat = await file.stat();
				if (!stat.isFile() || stat.size < 1 || stat.size > 16384)
					throw new ProtectedStorageError('corrupt');
				const encrypted = Buffer.alloc(stat.size);
				const result = await file.read(encrypted, 0, encrypted.length, 0);
				if (result.bytesRead !== encrypted.length)
					throw new ProtectedStorageError('corrupt');
				const decoded: unknown = JSON.parse(safeStorage.decryptString(encrypted));
				if (
					!decoded ||
					typeof decoded !== 'object' ||
					!('scope' in decoded) ||
					decoded.scope !== binding ||
					!('key' in decoded) ||
					typeof decoded.key !== 'string' ||
					!/^[0-9a-f]{64}$/.test(decoded.key)
				)
					throw new ProtectedStorageError('corrupt');
				key = Buffer.from(decoded.key, 'hex');
			} finally {
				await file.close();
			}
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
				throw error;
			key = randomBytes(32);
			const encrypted = safeStorage.encryptString(
				JSON.stringify({ scope: binding, key: key.toString('hex') })
			);
			const temporary = join(
				options.directory,
				`${binding}.${randomBytes(16).toString('hex')}.tmp`
			);
			const file = await open(temporary, 'wx', 0o600);
			try {
				await file.writeFile(encrypted);
				await file.sync();
				if (!options.authorized()) throw new ProtectedStorageError('denied');
				// Publish only a complete key; link refuses to replace an existing partition key.
				await link(temporary, path);
			} finally {
				await file.close();
				await unlink(temporary);
			}
			if (process.platform !== 'win32') {
				const folder = await open(options.directory, 'r');
				try {
					await folder.sync();
				} finally {
					await folder.close();
				}
			}
		}
		if (!options.authorized()) throw new ProtectedStorageError('denied');
		return new EncryptedRecordStore({ ...options, key });
	} catch (error) {
		if (error instanceof ProtectedStorageError) throw error;
		throw new ProtectedStorageError('unavailable');
	} finally {
		key?.fill(0);
	}
}
