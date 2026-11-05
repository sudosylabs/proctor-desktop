import { parseSettingsDocument } from './settingsDocument.js';
import type {
	AcknowledgedUserSettings,
	SettingsCommitRequest,
	SettingsCommitResult
} from './userSettingsService.js';

export interface SettingsSessionBinding {
	readonly principalId: string;
	readonly sessionId: string;
}
export interface UserSettingsSnapshot {
	readonly acknowledged: AcknowledgedUserSettings;
	readonly writable: boolean;
}
/** Closed privileged capability. No credential, URL or general request crosses this seam. */
export interface UserSettingsSessionService {
	readSettings(binding: SettingsSessionBinding): Promise<UserSettingsSnapshot | undefined>;
	commitSettings(
		binding: SettingsSessionBinding,
		request: SettingsCommitRequest
	): Promise<SettingsCommitResult>;
}

export function readUserSettingsWire(value: unknown): UserSettingsSnapshot {
	const data = record(value);
	if (
		Object.keys(data).length !== 5 ||
		typeof data.source !== 'string' ||
		typeof data.writable !== 'boolean' ||
		!parseSettingsDocument(data.source).valid
	)
		throw new TypeError('Invalid User Settings response');
	return Object.freeze({
		acknowledged: Object.freeze({
			source: data.source,
			revision: metadata(data)
		}),
		writable: data.writable
	});
}
export function readUserSettingsRevision(value: unknown): string {
	const data = record(value);
	if (Object.keys(data).length !== 4 || typeof data.changed !== 'boolean')
		throw new TypeError('Invalid User Settings replacement');
	return metadata(data);
}
function metadata(value: Record<string, unknown>): string {
	if (
		value.format_version !== 1 ||
		typeof value.revision !== 'string' ||
		!/^[ybndrfg8ejkmcpqxot1uwisza345h769]{26}$/u.test(value.revision) ||
		typeof value.updated_at !== 'string' ||
		!/Z$/u.test(value.updated_at) ||
		!Number.isSafeInteger(Date.parse(value.updated_at))
	)
		throw new TypeError('Unsupported User Settings metadata');
	return value.revision;
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('Invalid User Settings response');
	return value as Record<string, unknown>;
}
