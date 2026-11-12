/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** The largest frame body either side accepts; matches the agent's `MAX_FRAME_BYTES`. */
export const MAX_NATIVE_AGENT_FRAME_BYTES = 1024 * 1024;
const PREFIX_BYTES = 4;

/** A frame was invalid; the connection must be closed because the stream is no longer trusted. */
export class NativeAgentFrameError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'NativeAgentFrameError';
	}
}

/** Encodes one message as a complete frame: a 4-byte big-endian length, then UTF-8 JSON. */
export function encodeNativeAgentFrame(message: unknown): Uint8Array {
	const body = new TextEncoder().encode(JSON.stringify(message));
	if (body.length === 0 || body.length > MAX_NATIVE_AGENT_FRAME_BYTES) {
		throw new NativeAgentFrameError(`invalid frame length ${body.length}`);
	}
	const frame = new Uint8Array(PREFIX_BYTES + body.length);
	new DataView(frame.buffer).setUint32(0, body.length, false);
	frame.set(body, PREFIX_BYTES);
	return frame;
}

/** Accumulates bytes and yields complete parsed messages. Oversized lengths fail before the body. */
export class NativeAgentFrameDecoder {
	private buffer = new Uint8Array(0);

	public push(chunk: Uint8Array): void {
		const next = new Uint8Array(this.buffer.length + chunk.length);
		next.set(this.buffer, 0);
		next.set(chunk, this.buffer.length);
		this.buffer = next;
	}

	/** The next complete message, or `undefined` when more bytes are needed. */
	public next(): unknown {
		if (this.buffer.length < PREFIX_BYTES) return undefined;
		const declared = new DataView(this.buffer.buffer, this.buffer.byteOffset).getUint32(
			0,
			false
		);
		if (declared === 0 || declared > MAX_NATIVE_AGENT_FRAME_BYTES) {
			throw new NativeAgentFrameError(`invalid frame length ${declared}`);
		}
		const end = PREFIX_BYTES + declared;
		if (this.buffer.length < end) return undefined;
		const body = this.buffer.subarray(PREFIX_BYTES, end);
		this.buffer = this.buffer.slice(end);
		try {
			return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
		} catch {
			throw new NativeAgentFrameError('invalid frame body');
		}
	}
}
