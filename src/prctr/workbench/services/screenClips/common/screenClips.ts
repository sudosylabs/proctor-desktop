/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from '../../../../base/common/event.js';
import type {
	ClipOutcome,
	ClipRange
} from '../../../../platform/native/common/nativeAgentProtocol.generated.js';

/** One server screen-clip request, as `GET …/screen-clip-requests` lists it. */
export interface ScreenClipRequest {
	readonly id: string;
	readonly source: 'manager' | 'incident';
	readonly state: string;
	readonly range: {
		readonly from_session_start: boolean;
		readonly start?: string;
		readonly end: string;
	};
	readonly revision: number;
}

export interface ScreenClipManifest {
	readonly media_type: 'video/mp4';
	readonly size_bytes: number;
	readonly chunk_sha256: readonly string[];
}

/** The server's clip routes for one Attempt, over its live Connection. */
export interface ScreenClipTransport {
	list(
		cursor?: string
	): Promise<{ readonly items: readonly ScreenClipRequest[]; readonly next_cursor?: string }>;
	take(clipId: string): Promise<void>;
	/** Declares the manifest; re-declaring the same one is a no-op. Returns the chunks received. */
	declare(clipId: string, manifest: ScreenClipManifest): Promise<readonly number[]>;
	/** Uploads chunk `index`, numbered from 1. */
	putChunk(clipId: string, index: number, bytes: Uint8Array): Promise<void>;
	complete(
		clipId: string,
		completion: { readonly content_digest: string; readonly signature: string }
	): Promise<void>;
}

/** The native agent's recorder, as `INativeAgentService` exposes it. */
export interface ScreenClipRecorder {
	recorderSave(clipRequestId: string, range: ClipRange): Promise<void>;
	recorderRelease(clipRequestId: string): Promise<void>;
	readonly onDidClip: Event<{ readonly clipRequestId: string; readonly outcome: ClipOutcome }>;
}

/** Signs a clip's content digest with the registered installation key: ES256, raw r‖s, base64url. */
export interface ScreenClipSigner {
	sign(contentDigestHex: string): Promise<string>;
}

export type ScreenClipState = 'recording' | 'uploading' | 'uploaded' | 'failed';
