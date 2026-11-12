import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { ServerApiError } from '../../../../src/prctr/platform/serverApi/common/serverApi.js';
import {
	openRealtimeConnection,
	type RealtimeClose,
	type RealtimeFrame
} from '../../../../src/prctr/platform/serverApi/node/serverRealtimeConnection.js';

const id = 'y'.repeat(26);
const nonce = 'n'.repeat(43);

type Verify = (
	request: IncomingMessage,
	done: (ok: boolean, code?: number, message?: string, headers?: Record<string, string>) => void
) => void;
async function server(onConnection: (socket: WebSocket) => void, verify?: Verify) {
	const http = createServer();
	const sockets = new WebSocketServer({
		server: http,
		...(verify ? { verifyClient: (info, done) => verify(info.req, done) } : {})
	});
	sockets.on('connection', onConnection);
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	const address = http.address();
	assert.ok(address && typeof address !== 'string');
	return {
		url: `http://127.0.0.1:${address.port}/api/v1/websocket`,
		async close() {
			for (const socket of sockets.clients) socket.terminate();
			await new Promise<void>((resolve) => sockets.close(() => http.close(() => resolve())));
		}
	};
}
function collector() {
	const frames: RealtimeFrame[] = [];
	let closed!: (reason: RealtimeClose) => void;
	const reason = new Promise<RealtimeClose>((resolve) => (closed = resolve));
	return {
		frames,
		reason,
		sink: { frame: (frame: RealtimeFrame) => frames.push(frame), closed }
	};
}
const until = async (condition: () => boolean) => {
	for (let attempt = 0; attempt < 500 && !condition(); attempt++)
		await new Promise((resolve) => setTimeout(resolve, 2));
	assert.ok(condition());
};

void test('a hello sent with the upgrade is received, and commands are bounded', async () => {
	const s = await server((socket) => {
		socket.send(
			JSON.stringify({
				id,
				event: 'hello',
				sequence: 1,
				data: { connection_id: id, node_id: 'node-a', resumed: false }
			})
		);
		socket.on('message', (message) => {
			const request = JSON.parse(String(message));
			socket.send(
				JSON.stringify({ status: 'ok', sequence: request.sequence, data: { pong: true } })
			);
		});
	});
	const c = collector();
	const controller = new AbortController();
	const connection = await openRealtimeConnection(
		s.url,
		async () => ({ Authorization: 'DPoP test' }),
		c.sink,
		controller.signal
	);
	try {
		await until(() => c.frames.length === 1);
		assert.equal(c.frames[0]!.kind, 'event');
		connection.send({ sequence: 1, action: 'ping' });
		await until(() => c.frames.length === 2);
		assert.deepEqual(c.frames[1], {
			kind: 'reply',
			sequence: 1,
			ok: true,
			data: { pong: true }
		});
		assert.throws(() => connection.send({ sequence: 0, action: 'ping' }), ServerApiError);
		assert.throws(
			() => connection.send({ sequence: 2, action: 'not allowed!' }),
			ServerApiError
		);
		assert.throws(
			() => connection.send({ sequence: 3, action: 'ping', data: 'x'.repeat(300 * 1024) }),
			ServerApiError
		);
	} finally {
		connection.dispose();
		await s.close();
	}
});

void test('a refused upgrade with a fresh nonce is signed again once; redirects are refused', async () => {
	let upgrades = 0;
	const challenges: (string | undefined)[] = [];
	const s = await server(
		() => {},
		(_request, done) => {
			upgrades++;
			done(false, 401, 'Unauthorized', { 'DPoP-Nonce': nonce });
		}
	);
	try {
		await assert.rejects(
			openRealtimeConnection(
				s.url,
				async (_url, challenge) => {
					challenges.push(challenge?.nonce);
					return {};
				},
				collector().sink,
				new AbortController().signal
			),
			(error) => error instanceof ServerApiError && error.status === 401
		);
		assert.equal(upgrades, 2);
		assert.deepEqual(challenges, [undefined, nonce]);
	} finally {
		await s.close();
	}
	const redirect = await server(
		() => {},
		(_request, done) => done(false, 302, 'Found', { Location: 'https://elsewhere.test/' })
	);
	try {
		await assert.rejects(
			openRealtimeConnection(
				redirect.url,
				async () => ({}),
				collector().sink,
				new AbortController().signal
			),
			(error) => error instanceof ServerApiError && error.kind === 'redirectBlocked'
		);
	} finally {
		await redirect.close();
	}
});

void test('a malformed frame closes the connection without a resume', async () => {
	for (const bad of [
		'{"event":"hello","sequence":1,"sequence":2}',
		`{"event":"x","sequence":${2 ** 60}}`,
		'{"status":"error","sequence":1}',
		Buffer.from([1, 2, 3])
	]) {
		const s = await server((socket) => socket.send(bad));
		const c = collector();
		const connection = await openRealtimeConnection(
			s.url,
			async () => ({}),
			c.sink,
			new AbortController().signal
		);
		try {
			assert.equal(await c.reason, 'fresh');
			assert.equal(c.frames.length, 0);
		} finally {
			connection.dispose();
			await s.close();
		}
	}
});

void test('server close codes decide whether and how to reconnect', async () => {
	for (const [code, expected] of [
		[4001, 'ended'],
		[4003, 'fresh'],
		[4005, 'throttled'],
		[4002, 'resume'],
		[1000, 'resume']
	] as const) {
		const s = await server((socket) => socket.close(code));
		const c = collector();
		const connection = await openRealtimeConnection(
			s.url,
			async () => ({}),
			c.sink,
			new AbortController().signal
		);
		try {
			assert.equal(await c.reason, expected, `close ${code}`);
		} finally {
			connection.dispose();
			await s.close();
		}
	}
});
