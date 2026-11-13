/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Emitter, type Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import {
	NATIVE_AGENT_PROTOCOL_DIGEST,
	isAgentMessage,
	type AgentMessage,
	type CloseDisposition,
	type MainMessage,
	type Notification,
	type Request,
	type Response
} from '../common/nativeAgentProtocol.generated.js';
import { NativeAgentFrameDecoder, encodeNativeAgentFrame } from './nativeAgentFrames.js';

export const NATIVE_AGENT_HANDSHAKE_TIMEOUT_MS = 5_000;
export const NATIVE_AGENT_HEARTBEAT_TIMEOUT_MS = 3_000;
export const NATIVE_AGENT_REQUEST_TIMEOUT_MS = 10_000;
export const NATIVE_AGENT_CLOSE_TIMEOUT_MS = 5_000;

/** Verifies the agent binary's code identity before it is spawned. */
export interface NativeAgentVerifier {
	verify(executable: string): Promise<void>;
}

/**
 * Accepts any binary. Only for development builds and tests, where the agent is built unsigned
 * from source; a release composition must pass a signature-checking verifier.
 */
export const unsignedDevelopmentVerifier: NativeAgentVerifier = Object.freeze({
	verify: () => Promise.resolve()
});

export interface NativeAgentLaunchOptions {
	readonly executable: string;
	readonly buildIdentity: string;
	readonly verifier: NativeAgentVerifier;
}

/** Why a connection ended without an orderly close. */
export type NativeAgentFailure =
	'exited' | 'hung' | 'protocol' | 'fatal' | 'handshake' | 'request_timeout';

export class NativeAgentConnectionError extends Error {
	public constructor(public readonly failure: NativeAgentFailure) {
		super(`native agent failed: ${failure}`);
		this.name = 'NativeAgentConnectionError';
	}
}

interface PendingRequest {
	readonly resolve: (response: Response) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

/** One running native agent, from a verified spawn and handshake until it closes or fails. */
export class NativeAgentConnection extends Disposable {
	private readonly _onDidNotify = this._register(new Emitter<Notification>());
	/** Facts, rule statuses, gaps, resets and interruptions, in order. Heartbeats are not forwarded. */
	public readonly onDidNotify: Event<Notification> = this._onDidNotify.event;

	private readonly _onDidFail = this._register(new Emitter<NativeAgentFailure>());
	/** Fires once when the agent fails; the connection is unusable afterwards. */
	public readonly onDidFail: Event<NativeAgentFailure> = this._onDidFail.event;

	private readonly decoder = new NativeAgentFrameDecoder();
	private readonly pending = new Map<number, PendingRequest>();
	private nextRequestId = 1;
	private lastMessageNumber = 0;
	private acknowledgeScheduled = false;
	private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
	private ended = false;
	private closing = false;
	private failed = false;

	private constructor(private readonly child: ChildProcessWithoutNullStreams) {
		super();
	}

	/** Verifies, spawns and completes the handshake within one deadline. */
	public static async launch(options: NativeAgentLaunchOptions): Promise<NativeAgentConnection> {
		await options.verifier.verify(options.executable);
		const child = spawn(options.executable, [], {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {},
			shell: false,
			windowsHide: true
		});
		const connection = new NativeAgentConnection(child);
		try {
			await connection.handshake(options.buildIdentity);
		} catch (error) {
			connection.child.kill('SIGKILL');
			connection.dispose();
			throw error;
		}
		connection.armHeartbeat();
		return connection;
	}

	public get pid(): number | undefined {
		return this.child.pid;
	}

	public request(request: Request): Promise<Response> {
		if (this.ended) return Promise.reject(new NativeAgentConnectionError('exited'));
		const requestId = this.nextRequestId++;
		return new Promise<Response>((resolve, reject) => {
			const timer = setTimeout(
				() => this.fail('request_timeout'),
				NATIVE_AGENT_REQUEST_TIMEOUT_MS
			);
			this.pending.set(requestId, { resolve, reject, timer });
			this.send({ kind: 'request', request_id: requestId, request });
		});
	}

	public sendHostEvent(capability: string, event: unknown): void {
		this.send({ kind: 'host_event', capability, event });
	}

	/**
	 * Ends the session in order, then waits for the process to exit; kills it at the deadline.
	 * `delete` removes the recording (submission, expiry, departure); `seal` keeps it for re-entry.
	 */
	public async close(disposition: CloseDisposition): Promise<Response | undefined> {
		let response: Response | undefined;
		this.closing = true;
		try {
			response = await this.request({ kind: 'close', disposition });
		} catch {
			response = undefined;
		}
		await this.endProcess();
		return response;
	}

	public override dispose(): void {
		this.closing = true;
		this.stopHeartbeat();
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new NativeAgentConnectionError('exited'));
		}
		this.pending.clear();
		if (!this.ended) this.child.kill('SIGKILL');
		super.dispose();
	}

	private handshake(buildIdentity: string): Promise<void> {
		const secret = randomBytes(32).toString('base64url');
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new NativeAgentConnectionError('handshake')),
				NATIVE_AGENT_HANDSHAKE_TIMEOUT_MS
			);
			let acknowledged = false;
			this.child.stdout.on('data', (chunk: Buffer) => {
				try {
					this.decoder.push(chunk);
					for (
						let value = this.decoder.next();
						value !== undefined;
						value = this.decoder.next()
					) {
						if (!isAgentMessage(value))
							throw new NativeAgentConnectionError('protocol');
						if (!acknowledged) {
							const valid =
								value.kind === 'hello_ack' &&
								value.secret === secret &&
								value.build_identity === buildIdentity &&
								value.protocol_digest === NATIVE_AGENT_PROTOCOL_DIGEST;
							if (!valid) throw new NativeAgentConnectionError('handshake');
							acknowledged = true;
							clearTimeout(timer);
							resolve();
							continue;
						}
						this.receive(value);
					}
				} catch (error) {
					clearTimeout(timer);
					if (!acknowledged) {
						reject(
							error instanceof NativeAgentConnectionError
								? error
								: new NativeAgentConnectionError('protocol')
						);
					}
					this.fail('protocol');
				}
			});
			this.child.on('exit', () => {
				clearTimeout(timer);
				this.ended = true;
				if (!acknowledged) reject(new NativeAgentConnectionError('handshake'));
				else if (!this.closing) this.fail('exited');
			});
			this.child.stdin.on('error', () => undefined);
			this.send({
				kind: 'hello',
				secret,
				build_identity: buildIdentity,
				protocol_digest: NATIVE_AGENT_PROTOCOL_DIGEST
			});
		});
	}

	private receive(message: AgentMessage): void {
		if (message.kind === 'hello_ack') {
			this.fail('protocol');
			return;
		}
		if (message.kind === 'response') {
			const pending = this.pending.get(message.request_id);
			if (pending === undefined) {
				this.fail('protocol');
				return;
			}
			this.pending.delete(message.request_id);
			clearTimeout(pending.timer);
			pending.resolve(message.response);
			return;
		}
		if (message.message_number <= this.lastMessageNumber) {
			this.fail('protocol');
			return;
		}
		this.lastMessageNumber = message.message_number;
		this.scheduleAcknowledge();
		const notification = message.notification;
		if (notification.kind === 'heartbeat') {
			this.armHeartbeat();
			return;
		}
		if (notification.kind === 'fatal') {
			this.fail('fatal');
			return;
		}
		this._onDidNotify.fire(notification);
	}

	private scheduleAcknowledge(): void {
		if (this.acknowledgeScheduled) return;
		this.acknowledgeScheduled = true;
		setImmediate(() => {
			this.acknowledgeScheduled = false;
			if (!this.ended) this.send({ kind: 'acknowledge', up_to: this.lastMessageNumber });
		});
	}

	private armHeartbeat(): void {
		this.stopHeartbeat();
		if (this.ended) return;
		this.heartbeatTimer = setTimeout(
			() => this.fail('hung'),
			NATIVE_AGENT_HEARTBEAT_TIMEOUT_MS
		);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer);
		this.heartbeatTimer = undefined;
	}

	private send(message: MainMessage): void {
		if (this.ended || this.child.stdin.destroyed) return;
		this.child.stdin.write(encodeNativeAgentFrame(message));
	}

	/** Fails once: rejects pending requests, kills the process, and reports unless closing. */
	private fail(failure: NativeAgentFailure): void {
		if (this.failed) return;
		this.failed = true;
		this.stopHeartbeat();
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new NativeAgentConnectionError(failure));
		}
		this.pending.clear();
		if (!this.ended) this.child.kill('SIGKILL');
		if (!this.closing) this._onDidFail.fire(failure);
	}

	private endProcess(): Promise<void> {
		this.stopHeartbeat();
		if (this.ended) return Promise.resolve();
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.child.kill('SIGKILL');
			}, NATIVE_AGENT_CLOSE_TIMEOUT_MS);
			this.child.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
			this.child.stdin.end();
		});
	}
}
