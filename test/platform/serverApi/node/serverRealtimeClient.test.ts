import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServerApiError } from '../../../../src/prctr/platform/serverApi/common/serverApi.js';
import {
	ServerRealtimeClient,
	RealtimeCommandError,
	type RealtimeDial,
	type RealtimePolicy
} from '../../../../src/prctr/platform/serverApi/node/serverRealtimeClient.js';
import type {
	RealtimeMessage,
	RealtimeRequest
} from '../../../../src/prctr/platform/serverApi/node/serverRealtime.js';
const id = 'y'.repeat(26);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const event = (sequence: number, name = 'changed'): RealtimeMessage => ({
	id,
	sequence,
	event: name
});
const hello = (sequence = 1, resumed = false): RealtimeMessage => ({
	id,
	sequence,
	event: 'hello',
	data: { connection_id: id, node_id: 'node-a', resumed }
});
function fixture(policy: RealtimePolicy = {}) {
	const dials: {
		checkpoint: Parameters<RealtimeDial>[0];
		message: Parameters<RealtimeDial>[2];
		close: Parameters<RealtimeDial>[3];
		sent: RealtimeRequest[];
		disposed: boolean;
	}[] = [];
	const client = new ServerRealtimeClient(async (checkpoint, _signal, message, close) => {
		const dial = { checkpoint, message, close, sent: [] as RealtimeRequest[], disposed: false };
		dials.push(dial);
		return {
			send: (request) => {
				dial.sent.push(request);
			},
			dispose: () => {
				dial.disposed = true;
			}
		};
	}, policy);
	return {
		client,
		dials,
		async open(message = hello()) {
			const start = client.start();
			await tick();
			dials.at(-1)!.message(message);
			await start;
			return dials.at(-1)!;
		}
	};
}
void test('realtime correlates out-of-order replies and never replays uncertain commands', async () => {
	const f = fixture();
	try {
		const dial = await f.open();
		const a = f.client.request('subscribe', { topic: 'a' });
		const b = f.client.request('subscribe', { topic: 'b' });
		dial.message({ status: 'ok', sequence: 2, data: 'b' });
		dial.message({
			status: 'error',
			sequence: 1,
			error: { code: 'denied', message: 'Denied' }
		});
		assert.equal((await b).data, 'b');
		await assert.rejects(
			a,
			(e: unknown) =>
				e instanceof RealtimeCommandError &&
				e.outcome === 'rejected' &&
				e.reply?.error?.code === 'denied'
		);
		const pending = f.client.request('change');
		const rejected = assert.rejects(
			pending,
			(e: unknown) => e instanceof RealtimeCommandError && e.outcome === 'unconfirmed'
		);
		dial.close(new ServerApiError('network'));
		await rejected;
		const next = await f.open(hello(2, true));
		assert.deepEqual(next.sent, []);
		assert.deepEqual(next.checkpoint, { connectionId: id, sequence: 1 });
	} finally {
		f.client.dispose();
	}
});
void test('realtime accepts replay before hello and fences sequence gaps until authoritative resync', async () => {
	const f = fixture();
	const seen: number[] = [];
	f.client.onEvent((e) => seen.push(e.sequence));
	try {
		const first = await f.open();
		first.message(event(2));
		first.close(new ServerApiError('network'));
		const start = f.client.start();
		await tick();
		const next = f.dials.at(-1)!;
		next.message(event(3));
		next.message(hello(4, true));
		await start;
		assert.deepEqual(seen, [1, 2, 3, 4]);
		next.message(event(6));
		assert.equal(f.client.state.needsResync, true);
		assert.equal(next.disposed, true);
		const fresh = await f.open();
		assert.equal(fresh.checkpoint, undefined);
		await assert.rejects(
			f.client.request('change'),
			(e: unknown) => e instanceof RealtimeCommandError && e.outcome === 'notSent'
		);
		f.client.acknowledgeResync();
		const command = f.client.request('change');
		fresh.message({ status: 'ok', sequence: fresh.sent[0]!.sequence });
		await command;
	} finally {
		f.client.dispose();
	}
});
void test('rejected resume retains resync requirement and server resync signals are sticky', async () => {
	const f = fixture();
	try {
		const first = await f.open();
		first.close(new ServerApiError('network'));
		const next = await f.open();
		assert.equal(f.client.state.needsResync, true);
		f.client.acknowledgeResync();
		next.message(event(2, 'resync_required'));
		assert.equal(f.client.state.needsResync, true);
	} finally {
		f.client.dispose();
	}
});
void test('realtime heartbeat waits for a reply deadline, reconnects with opt-in, and stops offline or revoked', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture({
		reconnect: true,
		retryMinMs: 10,
		retryMaxMs: 10,
		heartbeatMs: 100,
		timeoutMs: 20
	});
	try {
		const first = await f.open();
		context.mock.timers.tick(100);
		assert.equal(first.sent[0]?.action, 'ping');
		first.message({ status: 'ok', sequence: 1, data: { pong: true } });
		await tick();
		context.mock.timers.tick(100);
		assert.equal(first.sent.length, 2);
		context.mock.timers.tick(20);
		await tick();
		assert.equal(f.client.state.phase, 'waiting');
		context.mock.timers.tick(10);
		await tick();
		assert.equal(f.dials.length, 2);
		f.dials[1]!.message(hello(2, true));
		await tick();
		f.client.setOnline(false);
		context.mock.timers.tick(1000);
		await tick();
		assert.equal(f.dials.length, 2);
		f.client.setOnline(true);
		await tick();
		f.dials[2]!.message(hello(3, true));
		await tick();
		f.dials[2]!.close(new ServerApiError('sessionEnded'));
		context.mock.timers.tick(1000);
		await tick();
		assert.equal(f.dials.length, 3);
		assert.equal(f.client.state.phase, 'closed');
		await assert.rejects(
			f.client.start(),
			(error: unknown) => error instanceof ServerApiError && error.kind === 'sessionEnded'
		);
	} finally {
		f.client.dispose();
	}
});
void test('command timeout and cancellation settle as unconfirmed; disconnected commands are not sent', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture({ timeoutMs: 20 });
	try {
		await assert.rejects(
			f.client.request('change'),
			(e: unknown) => e instanceof RealtimeCommandError && e.outcome === 'notSent'
		);
		const dial = await f.open();
		const timed = assert.rejects(
			f.client.request('change'),
			(e: unknown) => e instanceof RealtimeCommandError && e.outcome === 'unconfirmed'
		);
		context.mock.timers.tick(20);
		await timed;
		const abort = new AbortController();
		const cancelled = assert.rejects(
			f.client.request('change', undefined, { signal: abort.signal }),
			(e: unknown) => e instanceof RealtimeCommandError && e.outcome === 'unconfirmed'
		);
		abort.abort();
		await cancelled;
		dial.message({ status: 'ok', sequence: 1 });
		assert.equal(f.client.state.phase, 'connected');
	} finally {
		f.client.dispose();
	}
});
void test('hello timeout bounds an unresponsive dial and disposes its late socket', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	let finish!: (socket: Awaited<ReturnType<RealtimeDial>>) => void;
	let disposed = false;
	const client = new ServerRealtimeClient(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
		{ timeoutMs: 10 }
	);
	const start = assert.rejects(
		client.start(),
		(e: unknown) => e instanceof ServerApiError && e.kind === 'timeout'
	);
	await tick();
	context.mock.timers.tick(10);
	await start;
	finish({
		send() {},
		dispose() {
			disposed = true;
		}
	});
	await tick();
	assert.equal(disposed, true);
	client.dispose();
});
void test('early hello and reentrant disposal do not escape lifecycle ownership', async () => {
	let disposed = false;
	const client = new ServerRealtimeClient(async (_checkpoint, _signal, message) => {
		message(hello());
		return {
			send() {},
			dispose() {
				disposed = true;
			}
		};
	});
	client.onState((state) => {
		if (state.phase === 'connected') client.dispose();
	});
	await assert.rejects(client.start(), ServerApiError);
	assert.equal(disposed, true);
	const before = new ServerRealtimeClient(async () => {
		throw new Error('should not dial');
	});
	before.onState(() => before.dispose());
	await assert.rejects(before.start(), ServerApiError);
});
