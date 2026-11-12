/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerApiError } from '../../serverApi/common/serverApi.js';
import type { EncodedApiRequest } from '../../serverApi/node/requestEncoding.js';
import type {
	HttpResponse,
	ServerHttpTransport
} from '../../serverApi/node/serverHttpTransport.js';
import { problemCode, sendWithDPoP } from '../node/dpopExchange.js';
import { createDPoPProof, type DesktopSigningKey } from '../node/desktopSigningKey.js';

/** Access is refreshed this long before it expires, so a request never races its expiry. */
const REFRESH_MARGIN_MS = 5000;

export interface SessionCredentials {
	readonly key: DesktopSigningKey;
	readonly accessToken: string;
	readonly accessExpiresAt: number;
	readonly nonce: string;
}
/** What the Session owner lends the signer. The signer never stores a credential itself. */
export interface SignedSessionPort {
	/** The Session's current credentials, or `undefined` once it is no longer current. */
	credentials(): SessionCredentials | undefined;
	recordNonce(nonce: string): void;
	/** Single-flight access refresh. */
	refresh(): Promise<void>;
	readonly refreshing: boolean;
	/** The server refused the Session's credential even after a refresh. */
	endSession(): void;
}

/**
 * The only path that signs a Session request. Each send gets a fresh proof bound to the method,
 * URL, current nonce and access token. A nonce challenge is answered once; an `invalid_token`
 * answer refreshes once and resends; a credential still refused ends the Session.
 */
export class SessionRequestSigner {
	constructor(
		private readonly transport: ServerHttpTransport,
		private readonly session: SignedSessionPort
	) {}

	async execute(request: EncodedApiRequest): Promise<HttpResponse> {
		this.current(request.signal);
		if (request.operation.auth === 'public') return this.transport.send(request);
		// A refresh credential is sent only by the Session owner's own rotation.
		if (request.operation.auth === 'refresh_credential_required')
			throw new ServerApiError('invalidRequest');
		await this.freshAccess();
		let response = await this.send(request);
		if (response.status === 401 && problemCode(response) === 'authentication.invalid_token') {
			await this.refreshAccess();
			response = await this.send(request);
		}
		if (response.status === 401) {
			this.session.endSession();
			throw new ServerApiError('sessionEnded');
		}
		return response;
	}

	/** Headers for the realtime upgrade; `challenge` carries the nonce a refused upgrade issued. */
	async authorizeUpgrade(
		url: string,
		challenge?: { readonly nonce?: string }
	): Promise<Readonly<Record<string, string>>> {
		this.current();
		if (challenge?.nonce) this.session.recordNonce(challenge.nonce);
		await this.freshAccess();
		const credentials = this.current();
		const proof = await createDPoPProof(
			credentials.key,
			'GET',
			url,
			credentials.nonce,
			credentials.accessToken
		);
		this.current();
		return { Authorization: `DPoP ${credentials.accessToken}`, DPoP: proof };
	}

	private async send(request: EncodedApiRequest): Promise<HttpResponse> {
		const credentials = this.current(request.signal);
		const exchange = await sendWithDPoP(
			this.transport,
			request,
			{ key: credentials.key, credential: credentials.accessToken, accessToken: true },
			credentials.nonce
		);
		this.current(request.signal);
		if (exchange.nonce !== undefined && exchange.nonce !== credentials.nonce)
			this.session.recordNonce(exchange.nonce);
		return exchange.response;
	}
	private async freshAccess(): Promise<void> {
		const credentials = this.current();
		if (
			this.session.refreshing ||
			credentials.accessExpiresAt <= Date.now() + REFRESH_MARGIN_MS
		)
			await this.refreshAccess();
	}
	private async refreshAccess(): Promise<void> {
		try {
			await this.session.refresh();
		} catch {
			throw new ServerApiError('sessionEnded');
		}
		this.current();
	}
	private current(signal?: AbortSignal): SessionCredentials {
		const credentials = this.session.credentials();
		if (!credentials) throw new ServerApiError('sessionEnded');
		if (signal?.aborted) throw new ServerApiError('cancelled');
		return credentials;
	}
}
