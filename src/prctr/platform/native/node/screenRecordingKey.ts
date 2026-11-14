/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecordingStart } from '../common/nativeAgentProtocol.generated.js';

/** The OS keystore seal Electron's `safeStorage` provides: Keychain on macOS, DPAPI on Windows. */
export interface RecordingKeySeal {
	isEncryptionAvailable(): boolean;
	encryptString(plainText: string): Buffer;
	decryptString(encrypted: Buffer): string;
}

export class ScreenRecordingKeyError extends Error {
	public constructor(public readonly reason: 'keystore_unavailable' | 'key_unreadable') {
		super(`screen recording key: ${reason}`);
		this.name = 'ScreenRecordingKeyError';
	}
}

/**
 * The per-Attempt screen recording key. The key is generated in main, sealed in the OS keystore and
 * kept beside the encrypted recording, so a relaunch into the same Attempt continues the same
 * recording. The agent receives it at confirmation and never stores it. Deleting removes the key
 * and the recording together.
 */
export class ScreenRecordingKeys {
	public constructor(
		private readonly root: string,
		private readonly seal: RecordingKeySeal
	) {}

	private paths(attemptId: string): {
		readonly id: string;
		readonly directory: string;
		readonly key: string;
	} {
		const id = `recording-${createHash('sha256').update(attemptId).digest('base64url').slice(0, 32)}`;
		const base = join(this.root, id);
		return { id, directory: join(base, 'recording'), key: join(base, 'recording.key') };
	}

	/** The Attempt's recording, created on first use and reopened afterwards. */
	public async open(attemptId: string): Promise<RecordingStart> {
		if (!this.seal.isEncryptionAvailable())
			throw new ScreenRecordingKeyError('keystore_unavailable');
		const paths = this.paths(attemptId);
		let key: string;
		try {
			key = this.seal.decryptString(await readFile(paths.key));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
				throw new ScreenRecordingKeyError('key_unreadable');
			key = randomBytes(32).toString('base64url');
			await mkdir(join(paths.key, '..'), { recursive: true, mode: 0o700 });
			await writeFile(paths.key, this.seal.encryptString(key), { mode: 0o600, flag: 'wx' });
		}
		if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new ScreenRecordingKeyError('key_unreadable');
		return { recording_id: paths.id, key, directory: paths.directory };
	}

	/** Removes the Attempt's key and its recording directory, whatever the agent left behind. */
	public async delete(attemptId: string): Promise<void> {
		await rm(join(this.paths(attemptId).key, '..'), { recursive: true, force: true });
	}
}
