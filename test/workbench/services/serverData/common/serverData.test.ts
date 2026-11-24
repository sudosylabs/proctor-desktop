import assert from 'node:assert';
import { test } from 'node:test';
import {
	ServerDataService,
	stableKey,
	structuralShare,
	type ServerDataClients
} from '../../../../../src/prctr/workbench/services/serverData/common/serverData.ts';
import type { AdministrationResponse } from '../../../../../src/prctr/platform/administration/common/administrationProtocol.ts';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** An Administration client whose observations the test answers by hand. */
function fakeClients(options: { observable?: boolean } = {}) {
	const observations: {
		intent: unknown;
		listener: (response: AdministrationResponse) => void;
		disposed: boolean;
	}[] = [];
	const requests: unknown[] = [];
	let answer: (intent: unknown) => Promise<AdministrationResponse> = async () => ({
		kind: 'success'
	});
	const administration = {
		request: (intent: unknown) => {
			requests.push(intent);
			return answer(intent);
		},
		...(options.observable === false
			? {}
			: {
					observe: (
						intent: unknown,
						listener: (response: AdministrationResponse) => void
					) => {
						const observation = { intent, listener, disposed: false };
						observations.push(observation);
						return {
							dispose: () => {
								observation.disposed = true;
							}
						};
					}
				})
	};
	const clients = { administration, account: administration } as unknown as ServerDataClients;
	return {
		clients,
		observations,
		requests,
		answerWith: (next: typeof answer) => (answer = next)
	};
}
const page = (items: readonly { id: string; name: string }[]): AdministrationResponse =>
	({
		kind: 'data',
		data: { resource: 'users', value: { items } }
	}) as unknown as AdministrationResponse;

void test('views following the same read share one observation until the last lets go', () => {
	const fake = fakeClients();
	const service = new ServerDataService(fake.clients);
	const a = service.observe('administration', { kind: 'users', limit: 10, sort: 'name' });
	const b = service.observe('administration', { sort: 'name', limit: 10, kind: 'users' });
	const c = service.observe('administration', { kind: 'users', limit: 25 });
	assert.strictEqual(fake.observations.length, 2, 'field order does not make a second read');
	assert.strictEqual(a.state, b.state);
	a.dispose();
	a.dispose();
	assert.strictEqual(fake.observations[0]!.disposed, false, 'b still follows it');
	b.dispose();
	assert.strictEqual(fake.observations[0]!.disposed, true);
	c.dispose();
	service.dispose();
});

void test('an unchanged row keeps its object across answers, and a changed one is replaced', () => {
	const fake = fakeClients();
	const service = new ServerDataService(fake.clients);
	const users = service.observe('administration', { kind: 'users', limit: 10 });
	const listener = fake.observations[0]!.listener;
	listener(
		page([
			{ id: 'a', name: 'Ada' },
			{ id: 'b', name: 'Grace' }
		])
	);
	const first = users.data.get() as unknown as { data: { value: { items: object[] } } };
	listener(
		page([
			{ id: 'a', name: 'Ada' },
			{ id: 'b', name: 'Grace Hopper' }
		])
	);
	const second = users.data.get() as unknown as { data: { value: { items: object[] } } };
	assert.notStrictEqual(first, second);
	assert.strictEqual(
		second.data.value.items[0],
		first.data.value.items[0],
		'row a is the same object'
	);
	assert.notStrictEqual(second.data.value.items[1], first.data.value.items[1]);
	listener(
		page([
			{ id: 'a', name: 'Ada' },
			{ id: 'b', name: 'Grace Hopper' }
		])
	);
	assert.strictEqual(users.data.get(), second, 'an identical answer changes nothing');
	users.dispose();
	service.dispose();
});

void test('a read says it is slow, then fails; a later failure keeps the data as stale', async () => {
	const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
	const fake = fakeClients();
	let now = 1000;
	const service = new ServerDataService(fake.clients, {
		slowMs: 20,
		deadlineMs: 60,
		now: () => now
	});
	const slow = service.observe('administration', { kind: 'institution' });
	assert.deepStrictEqual(slow.state.get(), { kind: 'loading', slow: false });
	await wait(35);
	assert.deepStrictEqual(slow.state.get(), { kind: 'loading', slow: true });
	await wait(50);
	assert.deepStrictEqual(slow.state.get(), { kind: 'failed', reason: 'unavailable' });
	const answered = service.observe('administration', { kind: 'counts' });
	const listener = fake.observations[1]!.listener;
	listener({ kind: 'success' });
	assert.deepStrictEqual(answered.state.get(), { kind: 'ready' });
	await wait(80);
	assert.deepStrictEqual(
		answered.state.get(),
		{ kind: 'ready' },
		'an answered read has no deadline'
	);
	now = 5000;
	listener({ kind: 'error', reason: 'unavailable' });
	assert.deepStrictEqual(answered.state.get(), {
		kind: 'stale',
		reason: 'unavailable',
		since: 1000
	});
	assert.deepStrictEqual(answered.data.get(), { kind: 'success' }, 'the last good data stays');
	slow.dispose();
	answered.dispose();
	service.dispose();
});

void test('a read without an observation reads once, refreshes on demand and drops late answers', async () => {
	const fake = fakeClients({ observable: false });
	let release!: (response: AdministrationResponse) => void;
	fake.answerWith(
		() =>
			new Promise((resolve) => {
				release = resolve;
			})
	);
	const service = new ServerDataService(fake.clients);
	const read = service.observe('administration', { kind: 'institution' });
	assert.strictEqual(fake.requests.length, 1);
	release({ kind: 'success' });
	await tick();
	assert.deepStrictEqual(read.state.get(), { kind: 'ready' });
	const refreshing = read.refresh();
	assert.deepStrictEqual(
		read.state.get(),
		{ kind: 'refreshing' },
		'the data stays while it re-reads'
	);
	release({ kind: 'created', id: 'x' });
	await refreshing;
	assert.deepStrictEqual(read.data.get(), { kind: 'created', id: 'x' });
	void read.refresh();
	service.dispose();
	release({ kind: 'success' });
	await tick();
	assert.deepStrictEqual(
		read.data.get(),
		{ kind: 'created', id: 'x' },
		'nothing applies after sign-out'
	);
	assert.throws(() => service.observe('administration', { kind: 'institution' }));
});

void test('changes run together and a lost reply is unconfirmed', async () => {
	const fake = fakeClients();
	const pending: (() => void)[] = [];
	fake.answerWith(
		() =>
			new Promise((resolve) => {
				pending.push(() => resolve({ kind: 'success' }));
			})
	);
	const service = new ServerDataService(fake.clients);
	const one = service.change('administration', { kind: 'enableUser', id: 'a' });
	const two = service.change('administration', { kind: 'enableUser', id: 'b' });
	assert.strictEqual(fake.requests.length, 2, 'the second change is not held back here');
	for (const resolve of pending) resolve();
	assert.deepStrictEqual(await Promise.all([one, two]), [
		{ kind: 'success' },
		{ kind: 'success' }
	]);
	fake.answerWith(() => Promise.reject(new Error('lost')));
	assert.deepStrictEqual(await service.change('account', { kind: 'revokeOtherSessions' }), {
		kind: 'error',
		reason: 'unconfirmed'
	});
	service.dispose();
});

void test('structural sharing and keys follow values, not object identity or field order', () => {
	const previous = { a: [1, { b: 2 }], c: 'x' };
	assert.strictEqual(structuralShare(previous, { c: 'x', a: [1, { b: 2 }] }), previous);
	const next = structuralShare(previous, { a: [1, { b: 2 }], c: 'y' });
	assert.notStrictEqual(next, previous);
	assert.strictEqual(next.a, previous.a);
	const bytes = new Uint8Array([1]);
	assert.strictEqual(
		structuralShare(new Uint8Array([1]), bytes),
		bytes,
		'only plain data is compared'
	);
	assert.strictEqual(
		stableKey({ b: 1, a: { d: 2, c: 3 } }),
		stableKey({ a: { c: 3, d: 2 }, b: 1 })
	);
	assert.notStrictEqual(stableKey({ a: [1, 2] }), stableKey({ a: [2, 1] }));
});
