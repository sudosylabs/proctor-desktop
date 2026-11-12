/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { ServerApiError } from '../../serverApi/common/serverApi.js';
import type { SessionApi } from '../../serverApi/node/sessionApi.js';
import { validateUserSettingsCommitIntent } from '../common/settingsRendererProtocol.js';
import {
	readUserSettingsRevision,
	readUserSettingsWire,
	type SettingsSessionBinding,
	type UserSettingsSessionService,
	type UserSettingsSnapshot
} from '../common/userSettingsSession.js';
import type { SettingsCommitRequest, SettingsCommitResult } from '../common/userSettingsService.js';

/** What the Session owner lends the settings transport. Credentials never leave it. */
export interface UserSettingsSessionPort {
	/** The typed client of the bound Session; throws `sessionEnded` once it is not current. */
	apiForSession(binding: SettingsSessionBinding): Pick<SessionApi, 'request'>;
}

/**
 * The server side of the virtual `settings.json`: reads it and replaces it under a revision
 * fence. A replacement whose outcome is unknown is reported `ambiguous` so the settings owner
 * can reconcile; it is never retried here.
 */
export class UserSettingsServer implements UserSettingsSessionService {
	constructor(private readonly session: UserSettingsSessionPort) {}

	async readSettings(binding: SettingsSessionBinding): Promise<UserSettingsSnapshot | undefined> {
		try {
			const result = await this.session
				.apiForSession(binding)
				.request('getCurrentUserSettings', {});
			return readUserSettingsWire(result.value);
		} catch {
			return undefined;
		}
	}

	async commitSettings(
		binding: SettingsSessionBinding,
		raw: SettingsCommitRequest
	): Promise<SettingsCommitResult> {
		const request = validateUserSettingsCommitIntent(raw);
		let api: Pick<SessionApi, 'request'>;
		try {
			api = this.session.apiForSession(binding);
		} catch {
			return { kind: 'unavailable' };
		}
		try {
			const result = await api.request('replaceCurrentUserSettings', {
				header: {
					// The renderer's key is hashed so the server never sees a renderer-chosen value.
					'Idempotency-Key': createHash('sha256')
						.update(request.idempotencyKey)
						.digest('hex')
				},
				body: {
					source: request.source,
					format_version: 1,
					expected_revision: request.expectedRevision
				}
			} as never);
			return { kind: 'success', revision: readUserSettingsRevision(result.value) };
		} catch (error) {
			if (!(error instanceof ServerApiError)) return { kind: 'ambiguous' };
			if (error.kind === 'sessionEnded' || error.kind === 'invalidRequest')
				return { kind: 'unavailable' };
			if (error.kind !== 'server') return { kind: 'ambiguous' };
			if (error.status === 409 && error.code === 'user_settings.revision_conflict') {
				const latest = await this.readSettings(binding);
				return latest
					? { kind: 'conflict', latest: latest.acknowledged }
					: { kind: 'unavailable' };
			}
			return {
				kind:
					(error.status ?? 0) >= 500 || error.code === 'idempotency.in_progress'
						? 'ambiguous'
						: 'unavailable'
			};
		}
	}
}
