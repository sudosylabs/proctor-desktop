import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { ServerApiClient } from '../../../../src/prctr/platform/serverApi/node/serverApiClient.js';
import type { HttpResponse } from '../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js';
import {
	ServerApiError,
	type ApiInput,
	type ApiQueryState
} from '../../../../src/prctr/platform/serverApi/common/serverApi.js';
import { connectServerRealtime } from '../../../../src/prctr/platform/serverApi/node/serverRealtime.js';

const origin = 'https://institution.test';
const id = 'y'.repeat(26);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

void test('shared reads deduplicate, stay fresh, and invalidate observed data after mutations', async () => {
	const client = new ServerApiClient(origin);
	let calls = 0;
	const read = async () => ({ value: ++calls });
	try {
		const values = await Promise.all([
			client.fetchTask(['profile'], read),
			client.fetchTask(['profile'], read)
		]);
		assert.equal(calls, 1);
		assert.deepEqual(values, [{ value: 1 }, { value: 1 }]);
		await client.fetchTask(['profile'], read);
		assert.equal(calls, 1);
		const states: ApiQueryState<{ value: number }>[] = [];
		const observation = client.observeTask(['profile'], read, (state) => states.push(state));
		await client.invalidate(['profile']);
		assert.equal(calls, 2);
		assert.equal(states.at(-1)?.data?.value, 2);
		assert.ok(states.some((state) => state.fetching && state.data?.value === 1));
		observation.dispose();
		await client.invalidate();
		assert.equal(calls, 2);
	} finally {
		client.dispose();
	}
});

void test('stale focus/reconnection refetches active queries and disposal fences late completions', async () => {
	const client = new ServerApiClient(origin);
	let calls = 0;
	const observation = client.observeTask(
		['list'],
		async () => ++calls,
		() => {},
		{ staleTime: 0 }
	);
	await tick();
	assert.equal(calls, 1);
	client.setFocused(false);
	client.setFocused(true);
	await tick();
	assert.equal(calls, 2);
	client.setOnline(false);
	client.setOnline(true);
	await tick();
	assert.equal(calls, 3);
	observation.dispose();
	client.dispose();
	assert.throws(() => client.fetchTask(['list'], async () => 1), ServerApiError);
	let finish!: (response: HttpResponse) => void;
	const pendingClient = new ServerApiClient(
		origin,
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const request = pendingClient.request('getUserProfilePicture', { path: { user_id: id } });
	pendingClient.dispose();
	finish({ status: 200, bytes: new Uint8Array(), headers: { 'content-type': 'image/webp' } });
	await assert.rejects(
		request,
		(error: unknown) => error instanceof ServerApiError && error.kind === 'sessionEnded'
	);
});

void test('real WebSocket upgrade receives hello without a race, sends bounded commands and closes on disposal', async () => {
	const server = createServer();
	const sockets = new WebSocketServer({ server });
	sockets.on('connection', (socket, request) => {
		assert.equal(request.headers.authorization, 'DPoP test');
		socket.send(
			JSON.stringify({
				id,
				event: 'hello',
				sequence: 1,
				data: { connection_id: id, node_id: id, resumed: false }
			})
		);
		socket.on('message', (message) => {
			const request = JSON.parse(String(message));
			socket.send(JSON.stringify({ status: 'ok', sequence: request.sequence }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const messages: unknown[] = [];
	let received!: () => void;
	const reply = new Promise<void>((resolve) => {
		received = resolve;
	});
	const controller = new AbortController();
	const connection = await connectServerRealtime(
		`http://127.0.0.1:${address.port}/api/v1/websocket`,
		async () => ({ Authorization: 'DPoP test' }),
		controller.signal,
		(message) => {
			messages.push(message);
			if ('status' in message) received();
		},
		() => {}
	);
	try {
		connection.send({ sequence: 1, action: 'ping' });
		await reply;
		assert.equal(messages.length, 2);
		assert.throws(() => connection.send({ sequence: 0, action: 'ping' }));
	} finally {
		connection.dispose();
		for (const socket of sockets.clients) socket.terminate();
		await new Promise<void>((resolve) => sockets.close(() => server.close(() => resolve())));
	}
});

// Compile-time examples cover optional arguments, required route IDs and generated result fields.
const profileInput: ApiInput<'getCurrentUserProfile'> = {};
void profileInput;
// @ts-expect-error a path ID is required
const missingPath: ApiInput<'getUserProfilePicture'> = {};
void missingPath;

void test('Attempt credentials never enter query keys or the shared cache; mutations are never retried', async () => {
	let calls = 0;
	const client = new ServerApiClient(origin, async () => {
		calls++;
		throw new ServerApiError('network');
	});
	const input: ApiInput<'getCandidateExamWorkspaceContent'> = {
		path: { exam_attempt_id: id, attempt_workspace_entry_id: id },
		header: {
			'X-Proctor-Attempt-Credential': 'a'.repeat(43),
			'X-Proctor-Attempt-Connection-ID': id
		}
	};
	try {
		assert.throws(
			() => client.fetch('getCandidateExamWorkspaceContent', input),
			ServerApiError
		);
		assert.equal(calls, 0);
		await assert.rejects(
			client.request('getCandidateExamWorkspaceContent', input),
			ServerApiError
		);
		assert.equal(calls, 1);
		await assert.rejects(
			client.request('uploadUserProfilePicture', {
				path: { user_id: id },
				header: { 'If-Match': `"${'a'.repeat(64)}"` },
				mediaType: 'image/png',
				body: new Uint8Array([1])
			}),
			ServerApiError
		);
		assert.equal(calls, 2);
	} finally {
		client.dispose();
	}
});

void test('Node polling pauses when hidden and stops with its observation', async (context) => {
	context.mock.timers.enable({ apis: ['setInterval'] });
	const client = new ServerApiClient(origin);
	let calls = 0;
	const observer = client.observeTask(
		['poll'],
		async () => ++calls,
		() => {},
		{ pollIntervalMs: 1000 }
	);
	try {
		await tick();
		assert.equal(calls, 1);
		context.mock.timers.tick(1000);
		await tick();
		assert.equal(calls, 2);
		client.setFocused(false);
		context.mock.timers.tick(3000);
		await tick();
		assert.equal(calls, 2);
		client.setFocused(true);
		observer.dispose();
		context.mock.timers.tick(3000);
		await tick();
		assert.equal(calls, 2);
	} finally {
		observer.dispose();
		client.dispose();
	}
});

void test('privileged executor failures expose only normalized API errors', async () => {
	const client = new ServerApiClient(origin, async () => {
		throw new Error('private transport details');
	});
	try {
		await assert.rejects(
			client.request('getCurrentUserProfile', {}),
			(error: unknown) =>
				error instanceof ServerApiError &&
				error.kind === 'network' &&
				!error.message.includes('private')
		);
	} finally {
		client.dispose();
	}
});

void test('invalidation fences pending initial and background reads before publishing authoritative data', async () => {
	for (const cached of [false, true]) {
		const client = new ServerApiClient(origin);
		const states: ApiQueryState<number>[] = [];
		const pending: ((value: number) => void)[] = [];
		try {
			if (cached) await client.fetchTask(['race'], async () => 0);
			const observer = client.observeTask(
				['race'],
				() => new Promise<number>((resolve) => pending.push(resolve)),
				(state) => states.push(state),
				{ staleTime: 0 }
			);
			await tick();
			assert.equal(pending.length, 1);
			const invalidated = client.invalidate(['race']);
			await tick();
			assert.equal(pending.length, 2);
			pending[0]!(1);
			await tick();
			assert.ok(!states.some((s) => s.data === 1));
			pending[1]!(2);
			await invalidated;
			assert.equal(states.at(-1)?.data, 2);
			observer.dispose();
		} finally {
			client.dispose();
		}
	}
});

void test('throwing or reentrant observation callbacks leave no polling timer or active observer', async (context) => {
	context.mock.timers.enable({ apis: ['setInterval'] });
	for (const reentrant of [false, true]) {
		const client = new ServerApiClient(origin);
		let calls = 0;
		let publications = 0;
		const observer = client.observeTask(
			['ownership'],
			async () => ++calls,
			() => {
				publications++;
				if (reentrant) client.dispose();
				else throw new Error('listener failed');
			},
			{ pollIntervalMs: 1000 }
		);
		await tick();
		const initial = calls;
		context.mock.timers.tick(5000);
		await tick();
		assert.equal(calls, initial);
		assert.equal(publications, 1);
		await assert.rejects(observer.refresh(), ServerApiError);
		observer.dispose();
		client.dispose();
	}
});

void test('mutation completion is fenced when session ends during the awaited cache refresh', async () => {
	const client = new ServerApiClient(origin, async () => ({
		status: 204,
		headers: {},
		bytes: new Uint8Array()
	}));
	let finish!: () => void;
	let reads = 0;
	const observer = client.observeTask(
		['late'],
		async () => {
			if (++reads > 1)
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
			return reads;
		},
		() => {}
	);
	await tick();
	const mutation = client.request('archiveAcademicUnit', { path: { academic_unit_id: id } });
	const rejected = assert.rejects(
		mutation,
		(e: unknown) => e instanceof ServerApiError && e.kind === 'sessionEnded'
	);
	await tick();
	assert.equal(reads, 2);
	client.dispose();
	finish();
	await rejected;
	observer.dispose();
});

void test('realtime bursts refresh only affected queries and allow slow reads to finish before the next pass', async () => {
	const server = createServer();
	const sockets = new WebSocketServer({ server });
	let sequence = 1;
	sockets.on('connection', (socket) =>
		socket.send(
			JSON.stringify({
				id,
				event: 'hello',
				sequence: 1,
				data: { connection_id: id, node_id: 'node-a', resumed: false }
			})
		)
	);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const client = new ServerApiClient(
		`http://127.0.0.1:${address.port}`,
		undefined,
		async () => ({})
	);
	const reads: { signal: AbortSignal; finish: (value: number) => void }[] = [];
	const states: ApiQueryState<number>[] = [];
	let unrelated = 0;
	const changed = client.observeTask(
		['affected'],
		(signal) => new Promise<number>((finish) => reads.push({ signal, finish })),
		(state) => states.push(state)
	);
	const other = client.observeTask(
		['unrelated'],
		async () => ++unrelated,
		() => {}
	);
	const realtime = client.createRealtime({
		invalidate: (event) => (event.event === 'changed' ? [['affected']] : [])
	});
	const burst = async () => {
		const last = sequence + 20;
		const delivered = new Promise<void>((resolve) => {
			const subscription = realtime.onEvent((event) => {
				if (event.sequence === last) {
					subscription.dispose();
					resolve();
				}
			});
		});
		for (let n = 0; n < 20; n++) {
			sequence++;
			for (const socket of sockets.clients)
				socket.send(JSON.stringify({ id, event: 'changed', sequence }));
		}
		await delivered;
		await tick();
	};
	try {
		await realtime.start();
		assert.equal(reads.length, 1);
		await burst();
		assert.equal(reads.length, 1);
		assert.equal(reads[0]!.signal.aborted, false);
		reads[0]!.finish(0);
		await tick();
		assert.equal(reads.length, 2);
		await burst();
		assert.equal(reads.length, 2);
		assert.equal(reads[1]!.signal.aborted, false);
		reads[1]!.finish(1);
		await tick();
		assert.equal(states.at(-1)?.data, 1);
		assert.equal(reads.length, 3);
		reads[2]!.finish(2);
		await tick();
		assert.equal(states.at(-1)?.data, 2);
		assert.equal(unrelated, 1);
	} finally {
		changed.dispose();
		other.dispose();
		client.dispose();
		for (const socket of sockets.clients) socket.terminate();
		await new Promise<void>((resolve) => sockets.close(() => server.close(() => resolve())));
	}
});
