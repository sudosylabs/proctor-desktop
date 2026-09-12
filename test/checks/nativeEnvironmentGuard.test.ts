import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
	NativeEnvironmentGuard,
	NATIVE_ENVIRONMENT_INTERRUPTION_EVENTS
} from '../../src/prctr/platform/native/electron-main/nativeEnvironmentGuard.ts';

void test('each OS lifetime boundary fences synchronously and removes every callback', () => {
	for (const event of NATIVE_ENVIRONMENT_INTERRUPTION_EVENTS) {
		const source = new EventEmitter();
		const seen: string[] = [];
		const guard = new NativeEnvironmentGuard(source, (reason) => {
			seen.push(reason);
			source.emit('resume');
		});
		source.emit(event);
		assert.deepEqual(seen, [event]);
		for (const name of NATIVE_ENVIRONMENT_INTERRUPTION_EVENTS) {
			assert.equal(source.listenerCount(name), 0);
			source.emit(name);
		}
		assert.deepEqual(seen, [event]);
		guard.dispose();
	}
});

void test('normal source shutdown removes guard without reporting interruption', () => {
	const source = new EventEmitter();
	const guard = new NativeEnvironmentGuard(source, () => assert.fail('disposed lifetime'));
	guard.dispose();
	guard.dispose();
	source.emit('suspend');
	assert.deepEqual(source.eventNames(), []);
});

void test('a throwing containment owner cannot retain OS callbacks', () => {
	const source = new EventEmitter();
	new NativeEnvironmentGuard(source, () => {
		throw new Error('containment failed');
	});
	assert.throws(() => source.emit('suspend'), /containment failed/);
	assert.deepEqual(source.eventNames(), []);
});

void test('partial listener registration rolls back before startup failure escapes', () => {
	const source = new EventEmitter();
	const add = source.on.bind(source);
	source.on = (name, callback) => {
		add(name, callback);
		if (name === 'lock-screen') throw new Error('registration failed');
		return source;
	};
	assert.throws(() => new NativeEnvironmentGuard(source, () => {}), /registration failed/);
	assert.deepEqual(source.eventNames(), []);
});
