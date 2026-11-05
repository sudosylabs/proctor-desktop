import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import {
	ProductWindowCoordinator,
	type ManagedProductWindow,
	type ProductWindowFactory
} from '../../../../src/prctr/platform/windows/common/windowCoordinator.ts';
import type {
	ProductWindowDescriptor,
	ProductWindowIntent
} from '../../../../src/prctr/platform/windows/common/windowProtocol.ts';

class FakeWindow implements ManagedProductWindow {
	destroyed = false;
	shown = false;
	veto = false;
	constructor(
		readonly descriptor: ProductWindowDescriptor,
		readonly accept: (intent: ProductWindowIntent) => void,
		readonly terminate: (reason: 'closed' | 'loadFailed') => void,
		readonly log: string[]
	) {}
	show(): void {
		this.shown = true;
		this.log.push(`show:${this.descriptor.kind}`);
	}
	destroy(): void {
		this.destroyed = true;
		this.log.push(`destroy:${this.descriptor.kind}`);
	}
	setCloseVeto(veto: boolean): void {
		this.veto = veto;
		this.log.push(`veto:${veto}`);
	}
}

suite('ProductWindowCoordinator', () => {
	test('destroys authenticated before candidate, preserves binding, and requires departure permission', () => {
		const log: string[] = [];
		const windows: FakeWindow[] = [];
		const intents: ProductWindowIntent[] = [];
		const factory: ProductWindowFactory = {
			create(descriptor, accept, terminate) {
				const window = new FakeWindow(descriptor, accept, terminate, log);
				windows.push(window);
				return window;
			}
		};
		const coordinator = new ProductWindowCoordinator(factory, {
			accept(_descriptor, intent) {
				intents.push(intent);
			}
		});
		coordinator.openInitial(auth('w-auth'));
		coordinator.enterCandidate(candidate('w-candidate'));
		assert.deepStrictEqual(log.slice(0, 5), [
			'show:authenticated',
			'destroy:authenticated',
			'show:candidate',
			'veto:true'
		]);
		assert.throws(() => coordinator.leaveCandidate(auth('w-return')));
		coordinator.allowCandidateDeparture();
		coordinator.leaveCandidate(auth('w-return'));
		assert.strictEqual(coordinator.current?.kind, 'authenticated');
		assert.strictEqual(windows[1]?.destroyed, true);
		windows[2]?.accept({ kind: 'authenticated.close' });
		assert.deepStrictEqual(intents, [{ kind: 'authenticated.close' }]);
		assert.throws(() => windows[1]?.accept({ kind: 'candidate.requestDeparture' }));
	});

	test('never accepts CandidateWindow as a relaunch entrypoint or a changed binding', () => {
		const coordinator = new ProductWindowCoordinator(
			{
				create(descriptor, accept, terminate) {
					return new FakeWindow(descriptor, accept, terminate, []);
				}
			},
			{ accept() {} }
		);
		assert.throws(() => coordinator.openInitial(candidate('w-candidate')));
		coordinator.openInitial(auth('w-auth'));
		assert.throws(() =>
			coordinator.enterCandidate({ ...candidate('w-candidate'), sessionId: 'other' })
		);
	});

	test('clears a failed renderer load and publishes an explicit recoverable termination', () => {
		const windows: FakeWindow[] = [];
		const terminations: unknown[] = [];
		const factory: ProductWindowFactory = {
			create(descriptor, accept, terminate) {
				const window = new FakeWindow(descriptor, accept, terminate, []);
				windows.push(window);
				return window;
			}
		};
		const coordinator = new ProductWindowCoordinator(factory, { accept() {} });
		coordinator.onDidTerminate((value) => terminations.push(value));
		coordinator.openInitial(auth('w-failed'));
		windows[0]?.terminate('loadFailed');
		assert.strictEqual(coordinator.current, undefined);
		assert.deepStrictEqual(coordinator.termination, {
			descriptor: auth('w-failed'),
			reason: 'loadFailed'
		});
		assert.deepStrictEqual(terminations, [coordinator.termination]);
		coordinator.openInitial(auth('w-recovered'));
		const recovered = coordinator.current as ProductWindowDescriptor | undefined;
		assert.strictEqual(recovered?.windowId, 'w-recovered');
		assert.strictEqual(coordinator.termination, undefined);
	});
});

function auth(windowId: string) {
	return {
		kind: 'authenticated',
		windowId,
		institutionOrigin: 'https://example.edu',
		principalId: 'p1',
		sessionId: 's1',
		initialDestination: 'home'
	} as const;
}
function candidate(windowId: string) {
	return {
		kind: 'candidate',
		windowId,
		institutionOrigin: 'https://example.edu',
		principalId: 'p1',
		sessionId: 's1',
		attemptId: 'a1',
		attemptConfigurationRevision: 'r1',
		attemptConfigurationDigest: 'sha256:abcdefgh'
	} as const;
}
