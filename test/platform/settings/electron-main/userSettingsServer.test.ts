import assert from 'node:assert/strict';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import { Emitter } from '../../../../src/prctr/base/common/event.ts';
import type { SessionApi } from '../../../../src/prctr/platform/serverApi/node/sessionApi.ts';
import { UserSettingsServer } from '../../../../src/prctr/platform/settings/electron-main/userSettingsServer.ts';

const binding = Object.freeze({ principalId: 'principal:one', sessionId: 'session:one' });

function fakeEvents() {
	const listeners = new Set<(event: { data: { revision: string } }) => void>();
	const continuity = new Emitter<void>();
	const names: string[] = [];
	const events = {
		on(
			name: string,
			_scope: undefined,
			listener: (event: { data: { revision: string } }) => void
		) {
			names.push(name);
			listeners.add(listener);
			return { accepted: Promise.resolve(true), dispose: () => listeners.delete(listener) };
		},
		onDidLoseContinuity: continuity.event
	};
	return {
		names,
		listeners,
		announce: (revision: string) =>
			listeners.forEach((listener) => listener({ data: { revision } })),
		loseContinuity: () => continuity.fire(),
		events: events as unknown as SessionApi['events']
	};
}

void suite('UserSettingsServer', () => {
	test('reports announced revisions and missed events until disposed', () => {
		const fake = fakeEvents();
		const server = new UserSettingsServer({
			apiForSession: () => ({ events: fake.events }) as Pick<SessionApi, 'request' | 'events'>
		});
		const seen: (string | undefined)[] = [];
		const changes = server.onDidChangeSettings(binding, (revision) => seen.push(revision));
		assert.deepEqual(fake.names, ['user_settings_changed']);
		fake.announce('r2');
		fake.loseContinuity();
		changes.dispose();
		fake.announce('r3');
		fake.loseContinuity();
		assert.deepEqual(seen, ['r2', undefined]);
		assert.equal(fake.listeners.size, 0);
	});

	test('a Session that already ended reports nothing', () => {
		const server = new UserSettingsServer({
			apiForSession: () => {
				throw new Error('session ended');
			}
		});
		const changes = server.onDidChangeSettings(binding, () =>
			assert.fail('no change expected')
		);
		changes.dispose();
	});
});
