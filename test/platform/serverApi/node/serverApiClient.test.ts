import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import {
	operationContract,
	operationContracts,
	resolveSchema,
	validateNamedSchema,
	validateSchema
} from '../../../../src/prctr/platform/serverApi/node/serverContract.js';
import {
	prepareApiRequest,
	readApiResponse
} from '../../../../src/prctr/platform/serverApi/node/apiRequest.js';
import { ServerApiClient } from '../../../../src/prctr/platform/serverApi/node/serverApiClient.js';
import {
	ServerHttpTransport,
	type HttpResponse
} from '../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js';
import {
	ServerApiError,
	type ApiInput,
	type ApiQueryState
} from '../../../../src/prctr/platform/serverApi/common/serverApi.js';
import { connectServerRealtime } from '../../../../src/prctr/platform/serverApi/node/serverRealtime.js';

const origin = 'https://institution.test';
const id = 'y'.repeat(26);
const json = (value: unknown, status = 200, headers = {}): HttpResponse => ({
	status,
	headers: { 'content-type': 'application/json', ...headers },
	bytes: new TextEncoder().encode(JSON.stringify(value))
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

void test('every packaged operation has executable request/response schemas, including conditional and non-JSON routes', () => {
	const operations = [...operationContracts()];
	assert.equal(operations.length, 301);
	assert.equal(new Set(operations.map((operation) => operation.path)).size, 247);
	const compiles = (operation: string, run: () => void) => {
		try {
			run();
		} catch (error) {
			assert.ok(error instanceof ServerApiError, `${operation}: ${String(error)}`);
		}
	};
	for (const operation of operations) {
		for (const parameter of operation.parameters)
			compiles(operation.id, () => validateSchema(parameter.schema, undefined));
		for (const media of Object.values(operation.requestBody?.content ?? {}))
			if (media.schema)
				compiles(operation.id, () => validateSchema(media.schema!, undefined));
		for (const response of Object.values(operation.responses))
			for (const media of Object.values(response.content ?? {}))
				if (media.schema)
					compiles(operation.id, () =>
						validateSchema(media.schema!, undefined, 'response')
					);
	}
});

void test('the runtime contract carries no prose and names strict-integer operations', () => {
	assert.equal(operationContract('appendNativeDelivery').strictIntegers, true);
	assert.equal(operationContract('getCurrentUserProfile').strictIntegers, false);
	for (const operation of operationContracts())
		assert.ok(
			!('description' in operation) && !('summary' in operation),
			`${operation.id} keeps prose`
		);
});

void test('operation inputs reject unknown routes/parameters, traversal and renderer-supplied authentication', () => {
	const request = prepareApiRequest(origin, 'getUserProfilePicture', { path: { user_id: id } });
	assert.equal(request.url, `${origin}/api/v1/users/${id}/profile-picture`);
	for (const value of ['..', '../me', 'l'.repeat(26)])
		assert.throws(() =>
			prepareApiRequest(origin, 'getUserProfilePicture', { path: { user_id: value } })
		);
	assert.throws(() =>
		prepareApiRequest(origin, 'getUserProfilePicture', {
			path: { user_id: id },
			query: { token: 'secret' }
		})
	);
	assert.throws(() =>
		prepareApiRequest(origin, 'exchangeDesktopAuthorizationCode', {
			header: { DPoP: 'secret' }
		})
	);
});

void test('multipart content keeps bytes and metadata encoding separate', async () => {
	const operation = operationContract('createCandidateExamWorkspaceFile');
	const schema = resolveSchema(operation.requestBody!.content['multipart/form-data'].schema!);
	assert.ok(schema.properties?.content);
	// Invalid metadata is rejected before any network request.
	assert.throws(() =>
		prepareApiRequest(origin, operation.id, {
			path: { exam_attempt_id: id },
			body: { content: new Uint8Array([0, 255]), metadata: {} }
		})
	);
	const upload = prepareApiRequest(origin, 'createCandidateExamWorkspaceFile', {
		path: { exam_attempt_id: id },
		header: {
			'X-Proctor-Attempt-Credential': 'a'.repeat(43),
			'X-Proctor-Attempt-Connection-ID': id,
			'Idempotency-Key': 'upload-1'
		},
		body: {
			content: new Uint8Array([0, 255]),
			metadata: {
				participation_id: id,
				generation: 1,
				path: 'main.ts',
				media_type: 'text/plain',
				size: 2,
				sha256: 'a'.repeat(64)
			}
		}
	});
	assert.ok(upload.body instanceof FormData);
	assert.deepEqual([...upload.body.keys()], ['metadata', 'content']);
	const metadata = upload.body.get('metadata');
	const content = upload.body.get('content');
	assert.ok(metadata instanceof Blob && content instanceof Blob);
	assert.equal(JSON.parse(await metadata.text()).size, 2);
	const encoded = await new Request(upload.url, {
		method: upload.method,
		body: upload.body
	}).text();
	assert.match(encoded, /name="metadata"\r\nContent-Type: application\/json/);
	assert.ok(encoded.indexOf('name="metadata"') < encoded.indexOf('name="content"'));
	const correction = prepareApiRequest(origin, 'stageExamSittingCorrectionResourceContent', {
		path: { exam_id: id, exam_sitting_id: id },
		header: { 'Idempotency-Key': 'stage-1' },
		body: {
			metadata: {
				base_revision_id: id,
				target_kind: 'addition',
				media_type: 'text/plain',
				size: 2,
				sha256: 'a'.repeat(64)
			},
			content: new Uint8Array([1, 2])
		}
	});
	const correctionWire = await new Request(correction.url, {
		method: correction.method,
		body: correction.body
	}).text();
	assert.match(correctionWire, /name="metadata"\r\nContent-Type: application\/json/);
	assert.ok(correctionWire.includes('"target_kind":"addition"'));

	assert.deepEqual(new Uint8Array(await content.arrayBuffer()), new Uint8Array([0, 255]));

	const photo = prepareApiRequest(origin, 'uploadUserProfilePicture', {
		path: { user_id: id },
		header: { 'If-Match': `"${'a'.repeat(64)}"` },
		mediaType: 'image/png',
		body: new Uint8Array([1, 2, 3])
	});
	assert.deepEqual(photo.body, new Uint8Array([1, 2, 3]));
	assert.equal(photo.headers?.['Content-Type'], 'image/png');
});

void test('errors preserve problem fields and Retry-After while malformed responses fail validation', () => {
	const operation = operationContract('getCurrentUserProfile');
	const problem = {
		type: 'about:blank',
		title: 'Invalid',
		status: 429,
		code: 'authentication.rate_limited',
		fields: { name: 'required' },
		request_id: 'request-1'
	};
	assert.throws(
		() => readApiResponse(operation, json(problem, 429, { 'retry-after': '3' })),
		(error: unknown) =>
			error instanceof ServerApiError &&
			error.problem?.fields?.name === 'required' &&
			error.retryAfterMs === 3000
	);
	assert.throws(
		() => readApiResponse(operation, json({}, 200)),
		(error: unknown) => error instanceof ServerApiError && error.kind === 'invalidResponse'
	);
	assert.throws(() => readApiResponse(operation, json({ ...problem, status: 400 }, 429)));
});

void test('binary and 304 responses preserve their transport meaning', () => {
	const operation = operationContract('getUserProfilePicture');
	const bytes = new Uint8Array([0, 255, 10]);
	assert.deepEqual(
		readApiResponse(operation, {
			status: 200,
			bytes,
			headers: { 'content-type': 'image/webp', etag: 'v1' }
		}).value,
		bytes
	);
	assert.equal(
		readApiResponse(operation, {
			status: 304,
			bytes: new Uint8Array(),
			headers: { etag: 'v1' }
		}).value,
		undefined
	);
	assert.throws(() =>
		readApiResponse(operation, { status: 200, bytes, headers: { 'content-type': 'text/html' } })
	);
});

void test('transport fences redirects, excessive bodies, cancellation and deadline separately', async () => {
	for (const response of [
		new Response(null, { status: 302, headers: { Location: 'https://other.test' } }),
		new Response('large')
	]) {
		const transport = new ServerHttpTransport(async () => response);
		await assert.rejects(
			transport.send({ url: origin, method: 'GET', maxResponseBytes: 2 }),
			ServerApiError
		);
	}
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		new ServerHttpTransport().send({ url: origin, method: 'GET', signal: controller.signal }),
		(error: unknown) => error instanceof ServerApiError && error.kind === 'cancelled'
	);
	const transport = new ServerHttpTransport(
		(_url, options) =>
			new Promise((_resolve, reject) =>
				options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
			)
	);
	await assert.rejects(
		transport.send({ url: origin, method: 'GET', timeoutMs: 5 }),
		(error: unknown) => error instanceof ServerApiError && error.kind === 'timeout'
	);
});

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

void test('runtime schemas retain DTO properties named like schema annotations', () => {
	validateNamedSchema('CreatePersonalAccessTokenRequest', {
		description: 'Automation',
		expires_at: new Date(Date.now() + 60000).toISOString(),
		scopes: ['exam.view']
	});
	assert.throws(
		() =>
			validateNamedSchema('CreatePersonalAccessTokenRequest', {
				description: 5,
				expires_at: new Date(Date.now() + 60000).toISOString(),
				scopes: ['exam.view']
			}),
		ServerApiError
	);
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

void test('gateway failures retain HTTP status and backoff without exposing HTML or inconsistent problem details', () => {
	const operation = operationContract('getCurrentUserProfile');
	for (const response of [
		{
			status: 503,
			headers: { 'content-type': 'text/html', 'retry-after': '4' },
			bytes: new TextEncoder().encode('<html>private proxy</html>')
		},
		json({ status: 400, title: 'bad' }, 503, { 'retry-after': '4' })
	]) {
		assert.throws(
			() => readApiResponse(operation, response),
			(e: unknown) =>
				e instanceof ServerApiError &&
				e.kind === 'server' &&
				e.status === 503 &&
				e.retryAfterMs === 4000 &&
				e.problem === undefined &&
				!e.message.includes('private')
		);
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
