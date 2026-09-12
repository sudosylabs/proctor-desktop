import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	NativeServiceRegistration,
	NativeServiceRegistrationError,
	type NativeServiceRegistrationApp,
	type NativeServiceRegistrationOptions
} from '../../src/prctr/platform/native/electron-main/nativeServiceRegistration.js';

function fixture(overrides: Partial<Omit<NativeServiceRegistrationOptions, 'app'>> = {}) {
	let status: unknown = 'not-registered';
	let blocked = false;
	let ready = true;
	let packaged = true;
	let reads = 0;
	let onRead = () => {};
	let onWrite = () => {};
	const writes: {
		readonly type: string;
		readonly serviceName: string;
		readonly openAtLogin: boolean;
	}[] = [];
	const app: NativeServiceRegistrationApp = {
		get isPackaged() {
			return packaged;
		},
		isReady: () => ready,
		getLoginItemSettings: (options) => {
			assert.deepEqual(options, {
				type: 'daemonService',
				serviceName: 'com.proctor.native.plist'
			});
			reads++;
			onRead();
			return { status };
		},
		setLoginItemSettings: (settings) => {
			writes.push(settings);
			onWrite();
			status = settings.openAtLogin ? 'requires-approval' : 'not-registered';
		}
	};
	const manager = new NativeServiceRegistration({
		app,
		platform: 'darwin',
		darwinMajor: 22,
		isSetupBlocked: () => blocked,
		...overrides
	});
	return {
		manager,
		writes,
		reads: () => reads,
		setStatus: (value: unknown) => {
			status = value;
		},
		setBlocked: (value: boolean) => {
			blocked = value;
		},
		setReady: (value: boolean) => {
			ready = value;
		},
		setPackaged: (value: boolean) => {
			packaged = value;
		},
		onRead: (callback: () => void) => {
			onRead = callback;
		},
		onWrite: (callback: () => void) => {
			onWrite = callback;
		}
	};
}

function errorCode(code: NativeServiceRegistrationError['code']) {
	return (error: unknown) =>
		error instanceof NativeServiceRegistrationError && error.code === code;
}

void test('construction and status inspection never register or imply source readiness', () => {
	const value = fixture();
	assert.equal(value.reads(), 0);
	for (const state of ['not-registered', 'enabled', 'requires-approval', 'not-found']) {
		value.setStatus(state);
		const status = value.manager.inspect();
		assert.deepEqual(status, { state });
		assert.ok(Object.isFrozen(status));
	}
	assert.deepEqual(value.writes, []);
});

void test('explicit setup uses only the fixed daemon service and reports actual approval state', () => {
	const value = fixture();
	assert.deepEqual(value.manager.registerDuringSetup(), { state: 'requires-approval' });
	assert.deepEqual(value.writes, [
		{ type: 'daemonService', serviceName: 'com.proctor.native.plist', openAtLogin: true }
	]);
	value.setStatus('enabled');
	assert.deepEqual(value.manager.unregisterDuringSetup(), { state: 'not-registered' });
	assert.deepEqual(value.writes[1], {
		type: 'daemonService',
		serviceName: 'com.proctor.native.plist',
		openAtLogin: false
	});
});

void test('already registered or unregistered setup is idempotent', () => {
	const value = fixture();
	value.manager.unregisterDuringSetup();
	value.setStatus('enabled');
	value.manager.registerDuringSetup();
	assert.deepEqual(value.writes, []);
});

void test('unsupported platforms, development and early startup never query or mutate service APIs', () => {
	for (const overrides of [
		{ platform: 'win32' },
		{ platform: 'linux' },
		{ darwinMajor: 21 },
		{ darwinMajor: NaN }
	]) {
		const value = fixture(overrides);
		assert.deepEqual(value.manager.inspect(), {
			state: 'unavailable',
			reason: 'unsupported_platform'
		});
		assert.throws(
			() => value.manager.registerDuringSetup(),
			errorCode('registration_unavailable')
		);
		assert.equal(value.reads(), 0);
		assert.deepEqual(value.writes, []);
	}
	for (const reason of ['development_build', 'application_not_ready'] as const) {
		const value = fixture();
		if (reason === 'development_build') value.setPackaged(false);
		else value.setReady(false);
		assert.deepEqual(value.manager.inspect(), { state: 'unavailable', reason });
		assert.throws(
			() => value.manager.unregisterDuringSetup(),
			errorCode('registration_unavailable')
		);
		assert.equal(value.reads(), 0);
		assert.deepEqual(value.writes, []);
	}
});

void test('active participation, Candidate or preflight guard blocks both setup actions before inspection', () => {
	const value = fixture();
	value.setBlocked(true);
	assert.throws(() => value.manager.registerDuringSetup(), errorCode('setup_blocked'));
	assert.throws(() => value.manager.unregisterDuringSetup(), errorCode('setup_blocked'));
	assert.equal(value.reads(), 0);
	assert.deepEqual(value.writes, []);
	assert.deepEqual(value.manager.inspect(), { state: 'not-registered' });
});

void test('guard is rechecked after status inspection and before the OS write', () => {
	const value = fixture();
	value.onRead(() => value.setBlocked(true));
	assert.throws(() => value.manager.registerDuringSetup(), errorCode('setup_blocked'));
	assert.deepEqual(value.writes, []);
});

void test('reentrant setup fails while the original mutation remains owned', () => {
	const value = fixture();
	value.onWrite(() =>
		assert.throws(() => value.manager.unregisterDuringSetup(), errorCode('setup_blocked'))
	);
	assert.deepEqual(value.manager.registerDuringSetup(), { state: 'requires-approval' });
	assert.equal(value.writes.length, 1);
});

void test('unknown and failed inspection never manufacture a usable registration state', () => {
	const value = fixture();
	for (const status of [undefined, null, 'future-state', true]) {
		value.setStatus(status);
		assert.deepEqual(value.manager.inspect(), {
			state: 'unavailable',
			reason: 'inspection_failed'
		});
		assert.throws(
			() => value.manager.registerDuringSetup(),
			errorCode('registration_unavailable')
		);
	}
	value.onRead(() => {
		throw new Error('private native details');
	});
	assert.deepEqual(value.manager.inspect(), {
		state: 'unavailable',
		reason: 'inspection_failed'
	});
	assert.deepEqual(value.writes, []);
});

void test('missing packaged plist cannot trigger a registration fallback', () => {
	const value = fixture();
	value.setStatus('not-found');
	assert.throws(() => value.manager.registerDuringSetup(), errorCode('registration_unavailable'));
	assert.deepEqual(value.writes, []);
});

void test('failed mutation reports a closed error and releases the setup lock', () => {
	const value = fixture();
	value.onWrite(() => {
		throw new Error('private native details');
	});
	assert.throws(() => value.manager.registerDuringSetup(), errorCode('registration_failed'));
	value.setStatus('enabled');
	assert.throws(() => value.manager.unregisterDuringSetup(), errorCode('unregistration_failed'));
	value.onWrite(() => {});
	assert.deepEqual(value.manager.unregisterDuringSetup(), { state: 'not-registered' });
});
