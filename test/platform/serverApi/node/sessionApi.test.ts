import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { SessionApi } from '../../../../src/prctr/platform/serverApi/node/sessionApi.js';
import {
	TAG_HINT_INTERVAL_MS,
	type ReadState
} from '../../../../src/prctr/platform/serverApi/node/sessionReads.js';
import type { HttpResponse } from '../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js';
import {
	ServerApiError,
	type ApiInput
} from '../../../../src/prctr/platform/serverApi/common/serverApi.js';

const origin = 'https://institution.test';
const id = 'y'.repeat(26);
const testBinding = { principalId: 'p'.repeat(26), sessionId: 's'.repeat(26) };
const unanswered = (): Promise<never> => Promise.reject(new ServerApiError('network'));
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

void test('shared reads deduplicate, stay fresh, and invalidate observed data after mutations', async () => {
	const client = new SessionApi({ binding: testBinding, origin: origin, execute: unanswered });
	let calls = 0;
	const read = async () => ({ value: ++calls });
	try {
		const values = await Promise.all([
			client.reads.read(['profile'], read),
			client.reads.read(['profile'], read)
		]);
		assert.equal(calls, 1);
		assert.deepEqual(values, [{ value: 1 }, { value: 1 }]);
		await client.reads.read(['profile'], read);
		assert.equal(calls, 1);
		const states: ReadState<{ value: number }>[] = [];
		const observation = client.reads.observe(['profile'], read, (state) => states.push(state));
		await client.reads.invalidate(['profile']);
		assert.equal(calls, 2);
		assert.equal(states.at(-1)?.value?.value, 2);
		assert.ok(states.some((state) => state.fetching && state.value?.value === 1));
		observation.dispose();
		await client.reads.invalidate();
		assert.equal(calls, 2);
	} finally {
		client.dispose();
	}
});

void test('stale focus/reconnection refetches active queries and disposal fences late completions', async () => {
	const client = new SessionApi({ binding: testBinding, origin: origin, execute: unanswered });
	let calls = 0;
	const observation = client.reads.observe(
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
	assert.throws(() => client.reads.read(['list'], async () => 1), ServerApiError);
	let finish!: (response: HttpResponse) => void;
	const pendingClient = new SessionApi({
		binding: testBinding,
		origin: origin,
		execute: () =>
			new Promise((resolve) => {
				finish = resolve;
			})
	});
	const request = pendingClient.request('getUserProfilePicture', { path: { user_id: id } });
	pendingClient.dispose();
	finish({ status: 200, bytes: new Uint8Array(), headers: { 'content-type': 'image/webp' } });
	await assert.rejects(
		request,
		(error: unknown) => error instanceof ServerApiError && error.kind === 'sessionEnded'
	);
});

// Compile-time examples cover optional arguments, required route IDs and generated result fields.
const profileInput: ApiInput<'getCurrentUserProfile'> = {};
void profileInput;
// @ts-expect-error a path ID is required
const missingPath: ApiInput<'getUserProfilePicture'> = {};
void missingPath;

void test('Attempt credentials never enter query keys or the shared cache; mutations are never retried', async () => {
	let calls = 0;
	const client = new SessionApi({
		binding: testBinding,
		origin: origin,
		execute: async () => {
			calls++;
			throw new ServerApiError('network');
		}
	});
	const input: ApiInput<'getCandidateExamWorkspaceContent'> = {
		path: { exam_attempt_id: id, attempt_workspace_entry_id: id },
		header: {
			'X-Proctor-Attempt-Credential': 'a'.repeat(43),
			'X-Proctor-Attempt-Connection-ID': id
		}
	};
	try {
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
	const client = new SessionApi({ binding: testBinding, origin: origin, execute: unanswered });
	let calls = 0;
	const observer = client.reads.observe(
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
	const client = new SessionApi({
		binding: testBinding,
		origin: origin,
		execute: async () => {
			throw new Error('private transport details');
		}
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
		const client = new SessionApi({
			binding: testBinding,
			origin: origin,
			execute: unanswered
		});
		const states: ReadState<number>[] = [];
		const pending: ((value: number) => void)[] = [];
		try {
			if (cached) await client.reads.read(['race'], async () => 0);
			const observer = client.reads.observe(
				['race'],
				() => new Promise<number>((resolve) => pending.push(resolve)),
				(state) => states.push(state),
				{ staleTime: 0 }
			);
			await tick();
			assert.equal(pending.length, 1);
			const invalidated = client.reads.invalidate(['race']);
			await tick();
			assert.equal(pending.length, 2);
			pending[0]!(1);
			await tick();
			assert.ok(!states.some((s) => s.value === 1));
			pending[1]!(2);
			await invalidated;
			assert.equal(states.at(-1)?.value, 2);
			observer.dispose();
		} finally {
			client.dispose();
		}
	}
});

void test('throwing or reentrant observation callbacks leave no polling timer or active observer', async (context) => {
	context.mock.timers.enable({ apis: ['setInterval'] });
	for (const reentrant of [false, true]) {
		const client = new SessionApi({
			binding: testBinding,
			origin: origin,
			execute: unanswered
		});
		let calls = 0;
		let publications = 0;
		const observer = client.reads.observe(
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
	const client = new SessionApi({
		binding: testBinding,
		origin: origin,
		execute: async () => ({
			status: 204,
			headers: {},
			bytes: new Uint8Array()
		})
	});
	let finish!: () => void;
	let reads = 0;
	const observer = client.reads.observe(
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

void test('event hints refresh only the hinted reads and let slow reads finish before the next pass', async () => {
	const client = new SessionApi({ binding: testBinding, origin, execute: unanswered });
	const reads: { signal: AbortSignal; finish: (value: number) => void }[] = [];
	const states: ReadState<number>[] = [];
	let unrelated = 0;
	const changed = client.reads.observe(
		['affected'],
		(signal) => new Promise<number>((finish) => reads.push({ signal, finish })),
		(state) => states.push(state)
	);
	const other = client.reads.observe(
		['unrelated'],
		async () => ++unrelated,
		() => {}
	);
	const burst = async () => {
		for (let n = 0; n < 20; n++) client.reads.refresh(['affected']);
		await tick();
	};
	try {
		await tick();
		assert.equal(reads.length, 1);
		await burst();
		assert.equal(reads.length, 1);
		assert.equal(reads[0]!.signal.aborted, false);
		reads[0]!.finish(0);
		await tick();
		await tick();
		assert.equal(reads.length, 2);
		await burst();
		assert.equal(reads.length, 2);
		assert.equal(reads[1]!.signal.aborted, false);
		reads[1]!.finish(1);
		await tick();
		await tick();
		assert.equal(states.at(-1)?.value, 1);
		assert.equal(reads.length, 3);
		reads[2]!.finish(2);
		await tick();
		assert.equal(states.at(-1)?.value, 2);
		assert.equal(unrelated, 1);
	} finally {
		changed.dispose();
		other.dispose();
		client.dispose();
	}
});

void test('a server event refreshes the read it names; a fresh reconnect refreshes every observed read', async () => {
	const http = createServer();
	const sockets = new WebSocketServer({ server: http });
	let connections = 0;
	sockets.on('connection', (socket) => {
		const connectionId = String(++connections).repeat(26);
		socket.send(
			JSON.stringify({
				event: 'hello',
				sequence: 1,
				data: { connection_id: connectionId, node_id: 'node-a', resumed: false }
			})
		);
	});
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	const address = http.address();
	assert.ok(address && typeof address !== 'string');
	const client = new SessionApi({
		binding: testBinding,
		origin: `http://127.0.0.1:${address.port}`,
		execute: unanswered,
		authorizeUpgrade: async () => ({ Authorization: 'DPoP test' })
	});
	let photos = 0;
	let others = 0;
	const photo = client.reads.observe(
		['account', 'photo'],
		async () => ++photos,
		() => {}
	);
	const other = client.reads.observe(
		['account', 'other'],
		async () => ++others,
		() => {}
	);
	const changes = client.events.on('user_profile_picture_changed', undefined, () =>
		client.reads.refresh(['account', 'photo'])
	);
	const until = async (condition: () => boolean) => {
		for (let attempt = 0; attempt < 500 && !condition(); attempt++)
			await new Promise((resolve) => setTimeout(resolve, 5));
		assert.ok(condition());
	};
	try {
		await until(() => client.events.state === 'live' && photos === 1 && others === 1);
		for (const socket of sockets.clients)
			socket.send(
				JSON.stringify({
					event: 'user_profile_picture_changed',
					sequence: 2,
					user_id: 'ybndrfg8ejkmcpqxot1uwisza3',
					resource: { type: '', id: '' },
					data: {
						active_file_entry_id: 'ybndrfg8ejkmcpqxot1uwisza3',
						revision: 2,
						changed_at: '2026-11-12T09:30:00Z'
					}
				})
			);
		await until(() => photos === 2);
		assert.equal(others, 1, 'an event refreshes only the read it names');
		// Authorization changed: the server drops the connection and the client cannot resume.
		for (const socket of sockets.clients) socket.close(4003);
		await until(() => connections === 2 && photos === 3 && others === 2);
	} finally {
		changes.dispose();
		photo.dispose();
		other.dispose();
		client.dispose();
		for (const socket of sockets.clients) socket.terminate();
		await new Promise<void>((resolve) => sockets.close(() => http.close(() => resolve())));
	}
});

void test('a change that names its tags re-reads only the reads it covers, including listed rows', async () => {
	const client = new SessionApi({
		binding: testBinding,
		origin,
		execute: async () => ({ status: 204, headers: {}, bytes: new Uint8Array() })
	});
	const calls = { list: 0, profile: 0, other: 0, untagged: 0 };
	const observe = (name: keyof typeof calls, policy: object) =>
		client.reads.observe(
			[name],
			async () => ({ items: [{ id: 'a' }], n: ++calls[name] }),
			() => {},
			policy
		);
	const observations = [
		observe('list', {
			tags: ['user'],
			valueTags: (value: unknown) =>
				(value as { items: { id: string }[] }).items.map((item) => `user/${item.id}`)
		}),
		observe('profile', { tags: ['user/a'] }),
		observe('other', { tags: ['user/b', 'job'] }),
		observe('untagged', {})
	];
	try {
		await tick();
		assert.deepEqual(calls, { list: 1, profile: 1, other: 1, untagged: 1 });
		await client.request(
			'archiveAcademicUnit',
			{ path: { academic_unit_id: id } },
			{ fence: ['user/a'] }
		);
		assert.deepEqual(
			calls,
			{ list: 2, profile: 2, other: 1, untagged: 1 },
			'the list holds row user/a; user/b, jobs and untagged reads keep their data'
		);
		await client.reads.invalidateTags(['user/a/sessions']);
		assert.deepEqual(calls, { list: 2, profile: 2, other: 1, untagged: 1 }, 'nothing holds it');
		await client.request('archiveAcademicUnit', { path: { academic_unit_id: id } });
		assert.deepEqual(calls, { list: 3, profile: 3, other: 2, untagged: 2 }, 'no tags: all');
	} finally {
		for (const observation of observations) observation.dispose();
		client.dispose();
	}
});

void test('a server event hints each tag at most once per interval and joins hints inside it', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
	const client = new SessionApi({ binding: testBinding, origin, execute: unanswered });
	let jobs = 0;
	let mail = 0;
	const observations = [
		client.reads.observe(
			['jobs'],
			async () => ++jobs,
			() => {},
			{ tags: ['job'] }
		),
		client.reads.observe(
			['mail'],
			async () => ++mail,
			() => {},
			{ tags: ['mail'] }
		)
	];
	const settle = async () => {
		for (let n = 0; n < 5; n++) await tick();
	};
	try {
		await settle();
		assert.equal(jobs, 1);
		client.reads.refreshTags(['job']);
		await settle();
		assert.equal(jobs, 2, 'the first hint refreshes at once');
		for (let n = 0; n < 10; n++) client.reads.refreshTags(['job']);
		client.reads.refreshTags(['mail']);
		await settle();
		assert.equal(jobs, 2, 'hints inside the interval wait');
		assert.equal(mail, 2, 'another tag is not held back');
		context.mock.timers.tick(TAG_HINT_INTERVAL_MS);
		await settle();
		assert.equal(jobs, 3, 'the waiting hints join one refresh');
		context.mock.timers.tick(TAG_HINT_INTERVAL_MS * 3);
		await settle();
		assert.equal(jobs, 3);
	} finally {
		for (const observation of observations) observation.dispose();
		client.dispose();
	}
});
