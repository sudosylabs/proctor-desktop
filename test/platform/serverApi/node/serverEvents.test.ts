import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancellationTokenSource } from '../../../../src/prctr/base/common/cancellation.js';
import {
	errorHandler,
	setUnexpectedErrorHandler
} from '../../../../src/prctr/base/common/errors.js';
import { ServerApiError } from '../../../../src/prctr/platform/serverApi/common/serverApi.js';
import {
	ServerCommandError,
	type ServerEventsState
} from '../../../../src/prctr/platform/serverApi/common/serverEvents.js';
import {
	ServerEvents,
	type RealtimeCheckpoint,
	type ServerEventsOptions
} from '../../../../src/prctr/platform/serverApi/node/serverEvents.js';
import type {
	RealtimeFrame,
	RealtimeRequest,
	RealtimeSink
} from '../../../../src/prctr/platform/serverApi/node/serverRealtimeConnection.js';

const first = 'c'.repeat(26);
const second = 'd'.repeat(26);
const institution = 'i'.repeat(26);
/** An Institution this User may not watch. */
const forbidden = 's'.repeat(26);

interface Dial {
	readonly checkpoint: RealtimeCheckpoint | undefined;
	readonly sink: RealtimeSink;
	readonly sent: RealtimeRequest[];
	disposed: boolean;
}
const hello = (sequence: number, connectionId: string, resumed = false): RealtimeFrame => ({
	kind: 'event',
	sequence,
	name: 'hello',
	data: { connection_id: connectionId, node_id: 'node-a', resumed }
});
const event = (
	sequence: number,
	name: string,
	data: unknown = {},
	resource?: { type: string; id: string }
): RealtimeFrame => ({ kind: 'event', sequence, name, data, ...(resource ? { resource } : {}) });
const reply = (sequence: number, data?: unknown): RealtimeFrame => ({
	kind: 'reply',
	sequence,
	ok: true,
	data
});
const refused = (sequence: number, code = 'websocket.subscription.denied'): RealtimeFrame => ({
	kind: 'reply',
	sequence,
	ok: false,
	data: undefined,
	problem: { code, message: 'Refused' }
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 500; attempt++) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	throw new Error('Condition not reached');
}

function fixture(options: Partial<ServerEventsOptions> = {}, refuse?: () => unknown) {
	const dials: Dial[] = [];
	const events = new ServerEvents({
		dial: async (checkpoint, sink) => {
			if (refuse) throw refuse();
			const dial: Dial = { checkpoint, sink, sent: [], disposed: false };
			dials.push(dial);
			return {
				send: (request) => void dial.sent.push(request),
				dispose: () => void (dial.disposed = true)
			};
		},
		retryMinMs: 1,
		retryMaxMs: 1,
		throttledMs: 5,
		heartbeatMs: 60_000,
		timeoutMs: 2000,
		idleMs: 5,
		...options
	});
	const states: ServerEventsState[] = [];
	events.onDidChangeState((state) => states.push(state));
	let losses = 0;
	events.onDidLoseContinuity(() => losses++);
	const opened = new WeakSet<Dial>();
	return {
		events,
		dials,
		states,
		get losses() {
			return losses;
		},
		/** Waits for a dial that has no hello yet and completes it. */
		async open(connectionId = first, resumed = false, sequence = 1) {
			await until(() => dials.length > 0 && !opened.has(dials.at(-1)!));
			const dial = dials.at(-1)!;
			opened.add(dial);
			dial.sink.frame(hello(sequence, connectionId, resumed));
			await tick();
			return dial;
		}
	};
}
function lastRequest(dial: Dial, action: string): RealtimeRequest {
	const request = [...dial.sent].reverse().find((candidate) => candidate.action === action);
	assert.ok(request, `no ${action} was sent`);
	return request;
}

void test('typed user events arrive in order; unknown events advance the sequence silently', async () => {
	const f = fixture();
	const received: number[] = [];
	const subscription = f.events.on('user_profile_picture_changed', undefined, (value) =>
		received.push(value.data.revision)
	);
	try {
		assert.equal(await subscription.accepted, true);
		const dial = await f.open();
		assert.equal(f.events.state, 'live');
		dial.sink.frame(event(2, 'user_profile_picture_changed', { revision: 1, extra: true }));
		dial.sink.frame(event(3, 'something_new', { anything: 1 }));
		dial.sink.frame(event(4, 'user_profile_picture_changed', { revision: 2 }));
		assert.deepEqual(received, [1, 2]);
		assert.equal(f.dials.length, 1);
		assert.equal(f.losses, 0);
	} finally {
		subscription.dispose();
		f.events.dispose();
	}
});

void test('resource subscriptions are shared, authorized once and released with their last listener', async () => {
	const f = fixture();
	const seen: string[] = [];
	const a = f.events.on('access_policy_changed', { resourceId: institution }, () =>
		seen.push('a')
	);
	const b = f.events.on('access_policy_changed', { resourceId: institution }, () =>
		seen.push('b')
	);
	try {
		const dial = await f.open();
		const subscribes = dial.sent.filter((request) => request.action === 'subscribe');
		assert.equal(subscribes.length, 1);
		assert.deepEqual(subscribes[0]!.data, {
			action: 'access_policy.view',
			resource: { type: 'institution', id: institution }
		});
		dial.sink.frame(reply(subscribes[0]!.sequence));
		assert.equal(await a.accepted, true);
		assert.equal(await b.accepted, true);
		dial.sink.frame(
			event(
				2,
				'access_policy_changed',
				{ revision: 7 },
				{ type: 'institution', id: institution }
			)
		);
		dial.sink.frame(
			event(
				3,
				'access_policy_changed',
				{ revision: 8 },
				{ type: 'institution', id: 'x'.repeat(26) }
			)
		);
		assert.deepEqual(seen, ['a', 'b']);
		a.dispose();
		assert.equal(dial.sent.filter((request) => request.action === 'unsubscribe').length, 0);
		b.dispose();
		assert.deepEqual(lastRequest(dial, 'unsubscribe').data, subscribes[0]!.data);
		const denied = f.events.on('access_policy_changed', { resourceId: forbidden }, () => {});
		dial.sink.frame(refused(lastRequest(dial, 'subscribe').sequence));
		assert.equal(await denied.accepted, false);
		denied.dispose();
		assert.throws(
			() => f.events.on('access_policy_changed', { resourceId: '../other' }, () => {}),
			ServerApiError
		);
	} finally {
		f.events.dispose();
	}
});

void test('a fresh reconnect restores subscriptions before it reports lost continuity', async () => {
	const f = fixture();
	const subscription = f.events.on(
		'access_policy_changed',
		{ resourceId: institution },
		() => {}
	);
	const channel = f.events.openCommandChannel();
	let resynchronizations = 0;
	channel.onDidNeedResynchronization(() => resynchronizations++);
	try {
		const dial = await f.open();
		dial.sink.frame(reply(lastRequest(dial, 'subscribe').sequence));
		await tick();
		dial.sink.closed('resume');
		const next = await f.open(second, false);
		assert.deepEqual(next.checkpoint, { connectionId: first, sequence: 1 });
		const resubscribe = lastRequest(next, 'subscribe');
		await tick();
		assert.equal(f.losses, 0, 'continuity is reported only once subscriptions are back');
		next.sink.frame(reply(resubscribe.sequence));
		await until(() => f.losses === 1);
		assert.equal(channel.needsResynchronization, true);
		assert.equal(resynchronizations, 1);
	} finally {
		channel.dispose();
		subscription.dispose();
		f.events.dispose();
	}
});

void test('a resumed connection replays what was missed and keeps continuity', async () => {
	const f = fixture();
	const received: number[] = [];
	const subscription = f.events.on('user_profile_picture_changed', undefined, (value) =>
		received.push(value.data.revision)
	);
	try {
		const dial = await f.open();
		dial.sink.frame(event(2, 'user_profile_picture_changed', { revision: 1 }));
		dial.sink.closed('resume');
		await until(() => f.dials.length === 2);
		const next = f.dials[1]!;
		assert.deepEqual(next.checkpoint, { connectionId: first, sequence: 2 });
		// Replay arrives before the resumed hello.
		next.sink.frame(event(3, 'user_profile_picture_changed', { revision: 2 }));
		next.sink.frame(hello(4, first, true));
		await tick();
		next.sink.frame(event(5, 'user_profile_picture_changed', { revision: 3 }));
		assert.deepEqual(received, [1, 2, 3]);
		assert.equal(f.losses, 0);
	} finally {
		subscription.dispose();
		f.events.dispose();
	}
});

void test('a sequence gap reconnects fresh; resync_required and unreadable events lose continuity', async () => {
	const f = fixture();
	const subscription = f.events.on('user_profile_picture_changed', undefined, () => {});
	try {
		const dial = await f.open();
		dial.sink.frame(event(2, 'resync_required'));
		assert.equal(f.losses, 1);
		dial.sink.frame(event(3, 'user_profile_picture_changed', { revision: 'not a number' }));
		assert.equal(f.losses, 2, 'an event Desktop cannot read counts as missed');
		dial.sink.frame(event(9, 'user_profile_picture_changed', { revision: 1 }));
		const next = await f.open(second);
		assert.equal(next.checkpoint, undefined, 'a gap never resumes');
		await until(() => f.losses === 3);
	} finally {
		subscription.dispose();
		f.events.dispose();
	}
});

void test('a listener that throws is reported and never affects others or the connection', async () => {
	const errors: unknown[] = [];
	const previous = errorHandler.getUnexpectedErrorHandler();
	setUnexpectedErrorHandler((error) => errors.push(error));
	const f = fixture();
	const received: string[] = [];
	const failing = f.events.on('current_user.context.changed', undefined, () => {
		throw new Error('listener failed');
	});
	const working = f.events.on('current_user.context.changed', undefined, (value) =>
		received.push(value.name)
	);
	try {
		const dial = await f.open();
		dial.sink.frame(event(2, 'current_user.context.changed', { schema_version: 1 }));
		assert.deepEqual(received, ['current_user.context.changed']);
		assert.equal(errors.length, 1);
		assert.equal(f.dials.length, 1);
		assert.equal(dial.disposed, false);
	} finally {
		failing.dispose();
		working.dispose();
		f.events.dispose();
		setUnexpectedErrorHandler(previous);
	}
});

void test('commands correlate out of order, are never replayed and wait for resynchronization', async () => {
	const f = fixture();
	const channel = f.events.openCommandChannel();
	try {
		const dial = await f.open();
		const one = channel.send('exam_attempt.renew', { n: 1 });
		const two = channel.send('exam_attempt.renew', { n: 2 });
		const [a, b] = dial.sent.filter((request) => request.action === 'exam_attempt.renew');
		dial.sink.frame(reply(b!.sequence, 'second'));
		dial.sink.frame(refused(a!.sequence, 'exam.attempt.unavailable'));
		assert.equal(await two, 'second');
		await assert.rejects(
			one,
			(error) =>
				error instanceof ServerCommandError &&
				error.outcome === 'rejected' &&
				error.problem?.code === 'exam.attempt.unavailable'
		);
		const lost = channel.send('exam_attempt.renew', { n: 3 });
		dial.sink.closed('fresh');
		await assert.rejects(
			lost,
			(error) => error instanceof ServerCommandError && error.outcome === 'unconfirmed'
		);
		const next = await f.open(second);
		await until(() => f.losses === 1);
		assert.equal(
			next.sent.filter((request) => request.action === 'exam_attempt.renew').length,
			0,
			'nothing is replayed'
		);
		await assert.rejects(
			channel.send('exam_attempt.renew', {}),
			(error) => error instanceof ServerCommandError && error.outcome === 'notSent'
		);
		channel.resynchronized();
		const after = channel.send('exam_attempt.renew', {});
		next.sink.frame(reply(lastRequest(next, 'exam_attempt.renew').sequence, 'ok'));
		assert.equal(await after, 'ok');
		assert.throws(() => f.events.openCommandChannel(), ServerApiError);
	} finally {
		channel.dispose();
		f.events.dispose();
	}
});

void test('command timeout and cancellation settle unconfirmed; disconnected commands are not sent', async () => {
	const f = fixture();
	const channel = f.events.openCommandChannel();
	try {
		await assert.rejects(
			channel.send('exam_attempt.renew', {}),
			(error) => error instanceof ServerCommandError && error.outcome === 'notSent'
		);
		await f.open();
		await assert.rejects(
			channel.send('exam_attempt.renew', {}, { timeoutMs: 5 }),
			(error) => error instanceof ServerCommandError && error.outcome === 'unconfirmed'
		);
		const source = new CancellationTokenSource();
		const cancelled = channel.send('exam_attempt.renew', {}, { token: source.token });
		source.cancel();
		await assert.rejects(
			cancelled,
			(error) => error instanceof ServerCommandError && error.outcome === 'unconfirmed'
		);
		source.dispose();
		const pending = Array.from({ length: 128 }, () =>
			channel.send('exam_attempt.renew', {}).catch(() => undefined)
		);
		await assert.rejects(
			channel.send('exam_attempt.renew', {}),
			(error) => error instanceof ServerCommandError && error.outcome === 'notSent'
		);
		f.events.dispose();
		await Promise.all(pending);
	} finally {
		channel.dispose();
		f.events.dispose();
	}
});

void test('a revoked Session or refused upgrade ends events for good', async () => {
	const f = fixture();
	const subscription = f.events.on('current_user.context.changed', undefined, () => {});
	try {
		const dial = await f.open();
		dial.sink.closed('ended');
		assert.equal(f.events.state, 'ended');
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(f.dials.length, 1);
		const late = f.events.on('user_profile_picture_changed', undefined, () => {});
		assert.equal(await late.accepted, false);
	} finally {
		subscription.dispose();
		f.events.dispose();
	}
	for (const error of [
		new ServerApiError('server', { status: 403 }),
		new ServerApiError('redirectBlocked'),
		new ServerApiError('sessionEnded')
	]) {
		const refusedEvents = fixture({}, () => error);
		const listener = refusedEvents.events.on(
			'current_user.context.changed',
			undefined,
			() => {}
		);
		await until(() => refusedEvents.events.state === 'ended');
		listener.dispose();
		refusedEvents.events.dispose();
	}
});

void test('offline pauses reconnects; the connection closes once nothing needs it', async () => {
	const f = fixture();
	const subscription = f.events.on('current_user.context.changed', undefined, () => {});
	try {
		const dial = await f.open();
		f.events.setOnline(false);
		assert.equal(dial.disposed, true);
		assert.equal(f.events.state, 'offline');
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(f.dials.length, 1);
		f.events.setOnline(true);
		await f.open(first, true, 2);
		subscription.dispose();
		await until(() => f.events.state === 'idle');
		assert.equal(f.dials.at(-1)!.disposed, true);
	} finally {
		subscription.dispose();
		f.events.dispose();
	}
});

void test('a hello that never arrives, a second hello or early events on a fresh connection reconnect', async () => {
	const f = fixture({ timeoutMs: 10 });
	const subscription = f.events.on('current_user.context.changed', undefined, () => {});
	try {
		await until(() => f.dials.length === 2);
		assert.equal(f.dials[0]!.disposed, true, 'an unanswered dial is closed');
		f.dials[1]!.sink.frame(event(1, 'current_user.context.changed'));
		await until(() => f.dials.length === 3);
		const dial = f.dials[2]!;
		dial.sink.frame(hello(1, first));
		await tick();
		assert.equal(f.events.state, 'live');
		dial.sink.frame(hello(2, first));
		await until(() => f.dials.length === 4);
		assert.ok(f.states.includes('waiting'));
	} finally {
		subscription.dispose();
		f.events.dispose();
	}
});
