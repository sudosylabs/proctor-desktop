import { createHash } from 'node:crypto';
import type { ProtectedRecordStore } from '../../../../platform/protectedStorage/node/protectedRecordStore.js';
import type { ProtectedContentPort, RecoveryRecord } from '../common/internalPorts.js';

/** Workspace-owned encoding, separate from browser records and their retention rules. */
export class ProtectedWorkspaceContent implements ProtectedContentPort {
	constructor(private readonly records: ProtectedRecordStore) {}
	async loadRecovery(): Promise<readonly RecoveryRecord[]> {
		const result: RecoveryRecord[] = [];
		for (const key of await this.records.list('workspace_')) {
			const bytes = await this.records.read(key);
			if (!bytes) throw new Error('Protected Workspace recovery disappeared');
			const value: unknown = JSON.parse(
				new TextDecoder('utf-8', { fatal: true }).decode(bytes),
				(_name, value: unknown) => {
					if (value && typeof value === 'object' && '$bytes' in value) {
						if (
							Object.keys(value).length !== 1 ||
							typeof value.$bytes !== 'string' ||
							!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
								value.$bytes
							)
						)
							throw new Error('Protected Workspace bytes are invalid');
						return new Uint8Array(Buffer.from(value.$bytes, 'base64'));
					}
					return value;
				}
			);
			if (
				!value ||
				typeof value !== 'object' ||
				!('version' in value) ||
				value.version !== 1 ||
				!('record' in value) ||
				!value.record ||
				typeof value.record !== 'object' ||
				!('storageId' in value.record) ||
				typeof value.record.storageId !== 'string' ||
				recordKey(value.record.storageId) !== key
			)
				throw new Error('Protected Workspace record is invalid');
			// The session performs complete domain/schema and cross-record validation before use.
			result.push(value.record as RecoveryRecord);
		}
		return result;
	}
	async putRecovery(record: RecoveryRecord): Promise<void> {
		const encoded = new TextEncoder().encode(
			JSON.stringify({ version: 1, record }, (_name, value: unknown) =>
				value instanceof Uint8Array
					? { $bytes: Buffer.from(value).toString('base64') }
					: value
			)
		);
		try {
			await this.records.write(recordKey(record.storageId), encoded);
		} finally {
			encoded.fill(0);
		}
	}
	deleteRecovery(storageId: string): Promise<void> {
		return this.records.delete(recordKey(storageId));
	}
}
function recordKey(storageId: string): string {
	return `workspace_${createHash('sha256').update(storageId).digest('hex')}`;
}
