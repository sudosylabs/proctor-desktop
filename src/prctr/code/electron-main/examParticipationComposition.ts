/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { INativeAgentService } from '../../platform/native/electron-main/nativeAgentService.js';
import { ScreenRecordingKeys } from '../../platform/native/node/screenRecordingKey.js';
import { openOsProtectedRecordStore } from '../../platform/protectedStorage/electron-main/osProtectedRecordStore.js';
import type { SessionApi } from '../../platform/serverApi/node/sessionApi.js';
import type { CertificationEvidence } from '../../workbench/services/examSecurity/common/certification.js';
import { ExamParticipationService } from '../../workbench/services/examSecurity/electron-main/examParticipationService.js';
import { SPOOL_BYTES } from '../../workbench/services/examSecurity/node/nativeDeliveryService.js';

export interface ExamParticipationCompositionOptions {
	/** The bound Session's client; its realtime events carry the command channel. */
	readonly api: SessionApi;
	readonly agent: INativeAgentService;
	readonly certification: CertificationEvidence;
	readonly nativeRegistryDigest: string;
	readonly configurationManifestFingerprint: string;
	/** Privileged per-principal state directory, never supplied by a renderer. */
	readonly stateDirectory: string;
	/** Opaque principal/Session binding for the protected spool's scope. */
	readonly scope: string;
	/** Whether the Session is still the one this composition was made for. */
	readonly authorized: () => boolean;
}

/**
 * Composes one Session's exam participation: the native delivery spool in OS-protected storage,
 * the per-Attempt screen recording key sealed by the OS keystore, and the realtime command
 * channel. The returned owner must be disposed when the Session ends.
 */
export function createExamParticipationComposition(
	options: ExamParticipationCompositionOptions
): ExamParticipationService {
	const recordings = new ScreenRecordingKeys(
		join(options.stateDirectory, 'recordings'),
		safeStorage
	);
	return new ExamParticipationService({
		api: options.api,
		events: options.api.events,
		agent: options.agent,
		certification: options.certification,
		nativeRegistryDigest: options.nativeRegistryDigest,
		configurationManifestFingerprint: options.configurationManifestFingerprint,
		openSpool: (attemptId) =>
			openOsProtectedRecordStore({
				directory: join(options.stateDirectory, 'native-delivery'),
				scope: `native-delivery:${options.scope}:${attemptId}`,
				maximumRecordBytes: SPOOL_BYTES + 1024 * 1024,
				maximumTotalBytes: 4 * (SPOOL_BYTES + 1024 * 1024),
				maximumRecords: 64,
				authorized: options.authorized
			}),
		recordings,
		randomBytes: (length) => new Uint8Array(randomBytes(length))
	});
}
