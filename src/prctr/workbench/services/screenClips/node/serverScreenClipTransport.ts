/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerApiError } from '../../../../platform/serverApi/common/serverApi.js';
import type { SessionApi } from '../../../../platform/serverApi/node/sessionApi.js';
import type {
	ScreenClipManifest,
	ScreenClipRequest,
	ScreenClipTransport
} from '../common/screenClips.js';

/** The live Participation's credentials; absent once the Participation has closed. */
export interface ScreenClipAccess {
	readonly continuityCredential: string;
	readonly connectionId: string;
}

const PAGE = 50;

/**
 * The server's candidate clip routes for one Attempt. Listing and taking requests need the live
 * Participation; uploading a clip already taken continues without its headers after closure,
 * until the Participation's upload deadline.
 */
export class ServerScreenClipTransport implements ScreenClipTransport {
	public constructor(
		private readonly api: Pick<SessionApi, 'request'>,
		private readonly attemptId: string,
		private readonly access: () => ScreenClipAccess | undefined
	) {}

	private live(): {
		readonly 'X-Proctor-Attempt-Credential': string;
		readonly 'X-Proctor-Attempt-Connection-ID': string;
	} {
		const access = this.access();
		if (access === undefined) throw new ServerApiError('invalidRequest');
		return {
			'X-Proctor-Attempt-Credential': access.continuityCredential,
			'X-Proctor-Attempt-Connection-ID': access.connectionId
		};
	}

	private optional() {
		return this.access() === undefined ? {} : this.live();
	}

	public async list(
		cursor?: string
	): Promise<{ readonly items: readonly ScreenClipRequest[]; readonly next_cursor?: string }> {
		const result = await this.api.request('listCandidateScreenClipRequests', {
			path: { exam_attempt_id: this.attemptId },
			header: this.live(),
			query: { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
		return result.value;
	}

	public async take(clipId: string): Promise<void> {
		const result = await this.api.request('takeCandidateScreenClipRequest', {
			path: { exam_attempt_id: this.attemptId, screen_clip_id: clipId },
			header: this.live()
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
	}

	public async declare(clipId: string, manifest: ScreenClipManifest): Promise<readonly number[]> {
		const result = await this.api.request('beginCandidateScreenClipUpload', {
			path: { exam_attempt_id: this.attemptId, screen_clip_id: clipId },
			header: this.optional(),
			body: {
				media_type: manifest.media_type,
				size_bytes: manifest.size_bytes,
				chunk_sha256: [...manifest.chunk_sha256]
			}
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
		return result.value.received_chunks;
	}

	public async putChunk(clipId: string, index: number, bytes: Uint8Array): Promise<void> {
		const result = await this.api.request('uploadCandidateScreenClipChunk', {
			path: { exam_attempt_id: this.attemptId, screen_clip_id: clipId, chunk: index },
			header: this.optional(),
			mediaType: 'application/octet-stream',
			body: bytes
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
	}

	public async complete(
		clipId: string,
		completion: { readonly content_digest: string; readonly signature: string }
	): Promise<void> {
		const result = await this.api.request('completeCandidateScreenClipUpload', {
			path: { exam_attempt_id: this.attemptId, screen_clip_id: clipId },
			header: this.optional(),
			body: { content_digest: completion.content_digest, signature: completion.signature }
		});
		if (result.status !== 200) throw new ServerApiError('server', { status: result.status });
	}
}
