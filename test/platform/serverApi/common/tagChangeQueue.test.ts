import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	anyTagCovered,
	tagCovers,
	tagsOverlap
} from '../../../../src/prctr/platform/serverApi/common/serverDataTags.js';
import {
	MAX_QUEUED_CHANGES_PER_TAG,
	TagChangeQueue
} from '../../../../src/prctr/platform/serverApi/common/tagChangeQueue.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A change that runs until the test releases it, recording when it starts. */
function gate(started: string[], name: string) {
	let release!: (value: string) => void;
	let fail!: (error: Error) => void;
	const done = new Promise<string>((resolve, reject) => {
		release = resolve;
		fail = reject;
	});
	return {
		task: () => {
			started.push(name);
			return done;
		},
		release: () => release(name),
		fail: () => fail(new Error(name))
	};
}

void test('a written tag covers itself and what lies below it, never what lies above', () => {
	assert.ok(tagCovers('user', 'user'));
	assert.ok(tagCovers('user', 'user/a'));
	assert.ok(tagCovers('user/a', 'user/a/sessions'));
	assert.ok(!tagCovers('user/a', 'user'));
	assert.ok(!tagCovers('user', 'users'), 'a tag is a path, not a prefix of characters');
	assert.ok(!tagCovers('user/a', 'user/ab'));
	assert.ok(tagsOverlap('user', 'user/a') && tagsOverlap('user/a', 'user'));
	assert.ok(!tagsOverlap('user/a', 'user/b'));
	assert.ok(anyTagCovered(['job', 'user/a'], ['mail', 'user/a/photo']));
	assert.ok(!anyTagCovered(['user/a/sessions'], ['user/a']));
});

void test('changes with unrelated tags run together; the same tag runs first in, first out', async () => {
	const queue = new TagChangeQueue();
	const started: string[] = [];
	const a = gate(started, 'a');
	const b = gate(started, 'b');
	const c = gate(started, 'c');
	const ra = queue.run(['user/1'], a.task);
	const rb = queue.run(['user/2'], b.task);
	const rc = queue.run(['user/1'], c.task);
	await tick();
	assert.deepEqual(started, ['a', 'b'], 'user/2 does not wait for user/1');
	b.release();
	assert.equal(await rb, 'b');
	assert.deepEqual(started, ['a', 'b'], 'the second user/1 change still waits');
	a.release();
	assert.equal(await ra, 'a');
	await tick();
	assert.deepEqual(started, ['a', 'b', 'c']);
	c.release();
	assert.equal(await rc, 'c');
	assert.equal(queue.size, 0);
});

void test('a collection lock waits for its entities, and an entity waits for the collection', async () => {
	const queue = new TagChangeQueue();
	const started: string[] = [];
	const one = gate(started, 'one');
	const all = gate(started, 'all');
	const two = gate(started, 'two');
	const r1 = queue.run(['user/1'], one.task);
	const rAll = queue.run(['user'], all.task);
	const r2 = queue.run(['user/2'], two.task);
	await tick();
	assert.deepEqual(started, ['one']);
	one.release();
	await r1;
	await tick();
	assert.deepEqual(started, ['one', 'all'], 'user/2 queued behind the collection');
	all.release();
	await rAll;
	await tick();
	assert.deepEqual(started, ['one', 'all', 'two']);
	two.release();
	await r2;
});

void test('a failed change releases its lock, and a change with no locks starts at once', async () => {
	const queue = new TagChangeQueue();
	const started: string[] = [];
	const bad = gate(started, 'bad');
	const next = gate(started, 'next');
	const free = gate(started, 'free');
	const rBad = queue.run(['job/1'], bad.task);
	const rNext = queue.run(['job/1'], next.task);
	const rFree = queue.run([], free.task);
	await tick();
	assert.deepEqual(started, ['bad', 'free']);
	bad.fail();
	await assert.rejects(rBad, /bad/u);
	await tick();
	assert.deepEqual(started, ['bad', 'free', 'next']);
	next.release();
	free.release();
	await Promise.all([rNext, rFree]);
});

void test(`a tag with ${MAX_QUEUED_CHANGES_PER_TAG} changes waiting refuses the next as busy`, async () => {
	const queue = new TagChangeQueue();
	const started: string[] = [];
	const running = gate(started, 'running');
	const runs = [queue.run(['user/1'], running.task)];
	const waiting = Array.from({ length: MAX_QUEUED_CHANGES_PER_TAG }, (_, n) =>
		gate(started, `waiting${n}`)
	);
	for (const change of waiting) runs.push(queue.run(['user/1'], change.task));
	let ran = false;
	assert.equal(
		await queue.run(['user/1'], async () => {
			ran = true;
			return 'extra';
		}),
		'busy'
	);
	assert.equal(
		await queue.run(['user'], async () => 'collection'),
		'busy',
		'the collection overlaps every waiting change'
	);
	assert.ok(!ran);
	assert.equal(await queue.run(['user/2'], async () => 'other'), 'other');
	running.release();
	for (const change of waiting) {
		await tick();
		change.release();
	}
	await Promise.all(runs);
	assert.equal(queue.size, 0);
});
