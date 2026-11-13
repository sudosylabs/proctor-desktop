import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	isCandidateWindowState,
	type CandidateWindowHostEvent,
	type CandidateWindowState,
	type PlatformFamily
} from '../../src/prctr/platform/native/electron-main/candidateWindowState.ts';
import {
	CandidateWindowEnforcementError,
	CandidateWindowEnforcer,
	type CandidateWindowConstraintVerification,
	type CandidateWindowEnforcementFailure,
	type CandidateWindowEnforcementHost
} from '../../src/prctr/platform/native/electron-main/candidateWindowEnforcer.ts';

const generation = 'participation-generation-test-0001';

void test('prepare applies and verifies the closed CandidateWindow invariant', () => {
	const host = new FakeCandidateWindowHost();
	const events: CandidateWindowHostEvent[] = [];
	const failures: CandidateWindowEnforcementFailure[] = [];
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: (event) => events.push(event),
		onFailure: (failure) => failures.push(failure),
		monotonicNow: () => 42
	});

	const receipt = enforcer.prepare(generation);

	assert.equal(host.applyCount, 1);
	assert.equal(receipt.participationGeneration, generation);
	assert.equal(receipt.platform, 'macos');
	assert.equal(receipt.verifiedAtMonotonicMs, 42);
	assert.deepEqual(receipt.constraints, completeConstraints());
	assert.deepEqual(receipt.window, presentWindow());
	assert.deepEqual(events, []);
	assert.deepEqual(failures, []);
});

void test('verified receipts reject incomplete, unknown, absent, or misplaced windows', async (context) => {
	const { display_target_id: _displayTargetId, ...withoutDisplayTarget } = presentWindow();
	const cases: readonly [string, CandidateWindowState][] = [
		['partial', { ...presentWindow(), certainty: 'partial' }],
		[
			'unknown',
			{
				certainty: 'unknown',
				presence: 'unknown',
				focus: 'unknown',
				visibility: 'unknown',
				placement: 'unknown'
			}
		],
		['absent', absentWindow()],
		['misplaced', { ...presentWindow(), placement: 'normal' }],
		['unbound display', withoutDisplayTarget],
		[
			'over-bound geometry',
			{
				...presentWindow(),
				bounds: { x: 0, y: 0, width: 262_145, height: 900 }
			}
		],
		[
			'unknown field',
			{
				...presentWindow(),
				untrusted: true
			} as CandidateWindowState
		]
	];

	for (const [name, window] of cases) {
		await context.test(name, () => {
			const host = new FakeCandidateWindowHost();
			host.window = window;
			const enforcer = new CandidateWindowEnforcer({
				host,
				onEvent: () => undefined,
				onFailure: () => undefined
			});

			assert.throws(
				() => enforcer.prepare(generation),
				(error) => hasErrorCode(error, 'window_verification_failed')
			);
		});
	}
});

void test('state drift is observed, blocks verification, and requires an explicit fresh verify', () => {
	const host = new FakeCandidateWindowHost();
	const events: CandidateWindowHostEvent[] = [];
	const failures: CandidateWindowEnforcementFailure[] = [];
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: (event) => events.push(event),
		onFailure: (failure) => failures.push(failure)
	});
	enforcer.prepare(generation);

	host.constraints = { ...completeConstraints(), maximized: false };
	host.window = { ...presentWindow(), placement: 'normal' };
	host.fireStateTransition();

	assert.deepEqual(events, [{ kind: 'state_transition', window: host.window }]);
	assert.deepEqual(failures, ['constraint_drift']);
	assert.equal(host.snapshotCount, 2);
	host.window = presentWindow();
	assert.throws(
		() => enforcer.verify(generation),
		(error) => hasErrorCode(error, 'constraint_verification_failed')
	);

	host.constraints = completeConstraints();
	host.window = presentWindow();
	assert.equal(enforcer.verify(generation).constraints.maximized, true);

	host.constraints = { ...completeConstraints(), maximized: false };
	host.fireStateTransition();
	assert.deepEqual(failures, ['constraint_drift', 'constraint_drift']);
});

void test('malformed native transitions are bounded before delivery and block enforcement', () => {
	const host = new FakeCandidateWindowHost();
	const events: CandidateWindowHostEvent[] = [];
	const failures: CandidateWindowEnforcementFailure[] = [];
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: (event) => events.push(event),
		onFailure: (failure) => failures.push(failure)
	});
	enforcer.prepare(generation);
	host.window = {
		...presentWindow(),
		bounds: { x: 0, y: 0, width: 262_145, height: 900 }
	};

	host.fireStateTransition();

	assert.deepEqual(events, [{ kind: 'state_transition', window: unknownWindow() }]);
	assert.deepEqual(failures, ['constraint_drift']);
	assert.equal(host.snapshotCount, 2);
});

void test('ordinary close attempts become mechanical events and never release the window', () => {
	const host = new FakeCandidateWindowHost();
	const events: CandidateWindowHostEvent[] = [];
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: (event) => events.push(event),
		onFailure: () => assert.fail('close attempt is not an enforcement failure')
	});
	enforcer.prepare(generation);

	host.fireCloseAttempt();

	assert.deepEqual(events, [{ kind: 'close_attempt' }]);
	assert.equal(host.releaseCount, 0);
});

void test('event delivery failure is contained without escaping the native callback', () => {
	const host = new FakeCandidateWindowHost();
	const failures: CandidateWindowEnforcementFailure[] = [];
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => {
			throw new Error('closed port');
		},
		onFailure: (failure) => failures.push(failure)
	});
	enforcer.prepare(generation);

	assert.doesNotThrow(() => host.fireCloseAttempt());
	assert.deepEqual(failures, ['event_delivery_failed']);
	assert.throws(
		() => enforcer.verify(generation),
		(error) => hasErrorCode(error, 'event_delivery_unavailable')
	);
	assert.deepEqual(enforcer.release(generation), absentWindow());
});

void test('an observation delivery failure during preparation prevents a verified admission receipt', () => {
	const host = new FakeCandidateWindowHost();
	host.fireStateDuringApply = true;
	const failures: CandidateWindowEnforcementFailure[] = [];
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => {
			throw new Error('utility not accepting events');
		},
		onFailure: (failure) => failures.push(failure)
	});

	assert.throws(
		() => enforcer.prepare(generation),
		(error) => hasErrorCode(error, 'prepare_failed')
	);
	assert.deepEqual(failures, ['event_delivery_failed']);
	assert.equal(host.disposedListenerCount, 0);
	assert.deepEqual(enforcer.release(generation), absentWindow());
});

void test('only the current generation can perform an idempotent terminal release', () => {
	const host = new FakeCandidateWindowHost();
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => undefined,
		onFailure: () => undefined
	});
	enforcer.prepare(generation);

	assert.throws(
		() => enforcer.release('participation-generation-stale-0002'),
		(error) => hasErrorCode(error, 'stale_participation_generation')
	);
	const released = enforcer.release(generation);
	assert.deepEqual(released, absentWindow());
	assert.deepEqual(enforcer.release(generation), absentWindow());
	assert.equal(host.releaseCount, 1);
	assert.equal(host.completeReleaseCount, 1);
	assert.equal(host.disposedListenerCount, 4);
});

void test('unexpected native destruction is observed and never treated as authoritative release', () => {
	const host = new FakeCandidateWindowHost();
	const events: CandidateWindowHostEvent[] = [];
	const failures: CandidateWindowEnforcementFailure[] = [];
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: (event) => events.push(event),
		onFailure: (failure) => failures.push(failure)
	});
	enforcer.prepare(generation);

	host.window = absentWindow();
	host.fireDestroyed();

	assert.deepEqual(events, [{ kind: 'state_transition', window: absentWindow() }]);
	assert.deepEqual(failures, ['unexpected_window_destruction']);
	assert.equal(host.releaseCount, 0);
	assert.throws(
		() => enforcer.verify(generation),
		(error) => hasErrorCode(error, 'window_unavailable')
	);
	assert.deepEqual(enforcer.release(generation), absentWindow());
});

void test('a bounded native restoration failure blocks until constraints are freshly verified', () => {
	const host = new FakeCandidateWindowHost();
	const failures: CandidateWindowEnforcementFailure[] = [];
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => undefined,
		onFailure: (failure) => failures.push(failure)
	});
	enforcer.prepare(generation);

	host.fireEnforcementFailure();

	assert.deepEqual(failures, ['constraint_drift']);
	assert.equal(enforcer.verify(generation).constraints.maximized, true);
});

void test('release stays blocked unless the host proves the CandidateWindow is absent', () => {
	const host = new FakeCandidateWindowHost();
	host.releaseLeavesWindowPresent = true;
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => undefined,
		onFailure: () => undefined
	});
	enforcer.prepare(generation);

	assert.throws(
		() => enforcer.release(generation),
		(error) => hasErrorCode(error, 'release_failed')
	);
	assert.equal(host.disposedListenerCount, 0);
});

void test('release rejects malformed terminal state and retries with a schema-valid absence', () => {
	const host = new FakeCandidateWindowHost();
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => undefined,
		onFailure: () => undefined
	});
	enforcer.prepare(generation);
	host.snapshotOverride = {
		...absentWindow(),
		untrusted: true
	} as CandidateWindowState;

	assert.throws(
		() => enforcer.release(generation),
		(error) => hasErrorCode(error, 'release_failed')
	);
	assert.equal(host.disposedListenerCount, 0);
	assert.equal(host.completeReleaseCount, 0);

	host.snapshotOverride = undefined;
	assert.deepEqual(enforcer.release(generation), absentWindow());
	assert.equal(host.releaseCount, 1);
	assert.equal(host.disposedListenerCount, 4);
});

void test('release contains a terminal snapshot failure and retries without another destroy', () => {
	const host = new FakeCandidateWindowHost();
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => undefined,
		onFailure: () => undefined
	});
	enforcer.prepare(generation);
	host.snapshotFailuresRemaining = 1;

	assert.throws(
		() => enforcer.release(generation),
		(error) => hasErrorCode(error, 'release_failed')
	);
	assert.equal(host.releaseCount, 1);
	assert.equal(host.disposedListenerCount, 0);

	assert.deepEqual(enforcer.release(generation), absentWindow());
	assert.equal(host.releaseCount, 1);
	assert.equal(host.disposedListenerCount, 4);
});

void test('release retries unfinished listener cleanup without repeating window destruction', () => {
	const host = new FakeCandidateWindowHost();
	host.disposeFailuresRemaining = 1;
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => undefined,
		onFailure: () => undefined
	});
	enforcer.prepare(generation);

	assert.throws(
		() => enforcer.release(generation),
		(error) => hasErrorCode(error, 'release_failed')
	);
	assert.equal(host.releaseCount, 1);
	assert.equal(host.disposedListenerCount, 0);

	assert.deepEqual(enforcer.release(generation), absentWindow());
	assert.equal(host.releaseCount, 1);
	assert.equal(host.completeReleaseCount, 1);
	assert.equal(host.disposedListenerCount, 4);
});

void test('release retries application-scoped cleanup without repeating prior cleanup', () => {
	const host = new FakeCandidateWindowHost();
	host.completeReleaseFailuresRemaining = 1;
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => undefined,
		onFailure: () => undefined
	});
	enforcer.prepare(generation);

	assert.throws(
		() => enforcer.release(generation),
		(error) => hasErrorCode(error, 'release_failed')
	);
	assert.equal(host.releaseCount, 1);
	assert.equal(host.completeReleaseCount, 1);
	assert.equal(host.disposedListenerCount, 4);

	assert.deepEqual(enforcer.release(generation), absentWindow());
	assert.equal(host.releaseCount, 1);
	assert.equal(host.completeReleaseCount, 2);
	assert.equal(host.disposedListenerCount, 4);
});

void test('failed preparation remains contained and can only be authoritatively released', () => {
	const host = new FakeCandidateWindowHost();
	host.constraints = { ...completeConstraints(), contentProtection: 'failed' };
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => undefined,
		onFailure: () => undefined
	});

	assert.throws(
		() => enforcer.prepare(generation),
		(error) => hasErrorCode(error, 'constraint_verification_failed')
	);
	assert.equal(host.disposedListenerCount, 0);
	assert.deepEqual(enforcer.release(generation), absentWindow());
});

void test('participation generations are bounded before any listener is registered', () => {
	const host = new FakeCandidateWindowHost();
	const enforcer = new CandidateWindowEnforcer({
		host,
		onEvent: () => undefined,
		onFailure: () => undefined
	});

	assert.throws(
		() => enforcer.prepare('too-short'),
		(error) => hasErrorCode(error, 'invalid_participation_generation')
	);
	assert.equal(host.applyCount, 0);
	assert.equal(host.disposedListenerCount, 0);
});

class FakeCandidateWindowHost implements CandidateWindowEnforcementHost {
	public readonly platform: PlatformFamily = 'macos';
	public constraints: CandidateWindowConstraintVerification = completeConstraints();
	public window: CandidateWindowState = presentWindow();
	public snapshotOverride: CandidateWindowState | undefined;
	public snapshotFailuresRemaining = 0;
	public applyCount = 0;
	public snapshotCount = 0;
	public releaseCount = 0;
	public completeReleaseCount = 0;
	public disposedListenerCount = 0;
	public releaseLeavesWindowPresent = false;
	public fireStateDuringApply = false;
	public disposeFailuresRemaining = 0;
	public completeReleaseFailuresRemaining = 0;
	readonly #enforcementFailureListeners = new Set<() => void>();
	readonly #stateListeners = new Set<() => void>();
	readonly #closeListeners = new Set<() => void>();
	readonly #destroyedListeners = new Set<() => void>();

	public applyConstraints(): void {
		this.applyCount += 1;
		if (this.fireStateDuringApply) this.fireStateTransition();
	}

	public verifyConstraints(): CandidateWindowConstraintVerification {
		return this.constraints;
	}

	public snapshot(): CandidateWindowState {
		this.snapshotCount += 1;
		if (this.snapshotFailuresRemaining > 0) {
			this.snapshotFailuresRemaining -= 1;
			throw new Error('candidate window snapshot failed');
		}
		return this.snapshotOverride ?? this.window;
	}

	public isValidWindowState(value: unknown): value is CandidateWindowState {
		return isCandidateWindowState(value);
	}

	public onEnforcementFailure(listener: () => void): { readonly dispose: () => void } {
		return this.#listen(this.#enforcementFailureListeners, listener);
	}

	public onStateTransition(listener: () => void): { readonly dispose: () => void } {
		return this.#listen(this.#stateListeners, listener);
	}

	public onCloseAttempt(listener: () => void): { readonly dispose: () => void } {
		return this.#listen(this.#closeListeners, listener);
	}

	public onDestroyed(listener: () => void): { readonly dispose: () => void } {
		return this.#listen(this.#destroyedListeners, listener);
	}

	public releaseWindow(): void {
		if (this.window.presence === 'absent') return;
		this.releaseCount += 1;
		if (this.releaseLeavesWindowPresent) return;
		this.window = absentWindow();
		for (const listener of this.#destroyedListeners) listener();
	}

	public completeRelease(): void {
		this.completeReleaseCount += 1;
		if (this.completeReleaseFailuresRemaining > 0) {
			this.completeReleaseFailuresRemaining -= 1;
			throw new Error('application-scoped cleanup failed');
		}
	}

	public fireEnforcementFailure(): void {
		for (const listener of this.#enforcementFailureListeners) listener();
	}

	public fireStateTransition(): void {
		for (const listener of this.#stateListeners) listener();
	}

	public fireCloseAttempt(): void {
		for (const listener of this.#closeListeners) listener();
	}

	public fireDestroyed(): void {
		for (const listener of this.#destroyedListeners) listener();
	}

	#listen(listeners: Set<() => void>, listener: () => void): { readonly dispose: () => void } {
		listeners.add(listener);
		return {
			dispose: () => {
				if (this.disposeFailuresRemaining > 0) {
					this.disposeFailuresRemaining -= 1;
					throw new Error('listener cleanup failed');
				}
				if (listeners.delete(listener)) this.disposedListenerCount += 1;
			}
		};
	}
}

function completeConstraints(): CandidateWindowConstraintVerification {
	return {
		alwaysOnTopDisabled: true,
		closePrevented: true,
		contentProtection: 'enabled',
		fullscreenPrevented: true,
		kioskDisabled: true,
		maximized: true,
		maximizePrevented: true,
		menuHidden: true,
		minimizePrevented: true,
		movePrevented: true,
		nativeControlsAbsent: true,
		resizePrevented: true
	};
}

function presentWindow(): CandidateWindowState {
	return {
		certainty: 'complete',
		presence: 'present',
		focus: 'focused',
		visibility: 'visible',
		placement: 'maximized',
		bounds: { x: 0, y: 0, width: 1_440, height: 900 },
		display_target_id: 'display-1'
	};
}

function absentWindow(): CandidateWindowState {
	return {
		certainty: 'complete',
		presence: 'absent',
		focus: 'not_focused',
		visibility: 'not_visible',
		placement: 'unknown'
	};
}

function unknownWindow(): CandidateWindowState {
	return {
		certainty: 'unknown',
		presence: 'unknown',
		focus: 'unknown',
		visibility: 'unknown',
		placement: 'unknown'
	};
}

function hasErrorCode(error: unknown, code: CandidateWindowEnforcementError['code']): boolean {
	return error instanceof CandidateWindowEnforcementError && error.code === code;
}
