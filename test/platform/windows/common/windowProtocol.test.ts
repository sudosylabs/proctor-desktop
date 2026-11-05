import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import {
	validateWindowDescriptor,
	validateWindowIntent
} from '../../../../src/prctr/platform/windows/common/windowProtocol.ts';

suite('Product window protocol', () => {
	test('normalizes HTTPS origins and rejects credentials, paths, and malformed identities', () => {
		const descriptor = validateWindowDescriptor({
			kind: 'authenticated',
			windowId: 'w1',
			institutionOrigin: 'https://EXAMPLE.edu:443/',
			principalId: 'p1',
			sessionId: 's1',
			initialDestination: 'home'
		});
		assert.strictEqual(descriptor.institutionOrigin, 'https://example.edu');
		for (const origin of [
			'http://example.edu',
			'https://user@example.edu',
			'https://example.edu/path'
		]) {
			assert.throws(() =>
				validateWindowDescriptor({
					kind: 'launch',
					windowId: 'w1',
					institutionOrigin: origin
				})
			);
		}
		assert.throws(() => validateWindowDescriptor({ kind: 'candidate', windowId: 'w1' }));
	});

	test('development HTTP is explicit, loopback-only, and cannot enter CandidateWindow', () => {
		const descriptor = {
			kind: 'authenticated',
			windowId: 'w-dev',
			principalId: 'p1',
			sessionId: 's1',
			initialDestination: 'account',
			institutionOrigin: 'http://127.0.0.1:8080'
		};
		assert.throws(() => validateWindowDescriptor(descriptor));
		assert.strictEqual(
			validateWindowDescriptor({ ...descriptor, developmentOrigin: true }).institutionOrigin,
			descriptor.institutionOrigin
		);
		assert.throws(() =>
			validateWindowDescriptor({
				...descriptor,
				developmentOrigin: true,
				institutionOrigin: 'http://example.edu'
			})
		);
		assert.throws(() =>
			validateWindowDescriptor({
				...descriptor,
				developmentOrigin: true,
				kind: 'candidate',
				attemptId: 'a1',
				attemptConfigurationRevision: 'r1',
				attemptConfigurationDigest: 'a'.repeat(64)
			})
		);
	});

	test('accepts only exact capability-specific intents', () => {
		assert.deepStrictEqual(
			validateWindowIntent('authenticated', {
				kind: 'authenticated.joinAttempt',
				attemptId: 'a1'
			}),
			{ kind: 'authenticated.joinAttempt', attemptId: 'a1' }
		);
		assert.throws(() => validateWindowIntent('launch', { kind: 'authenticated.signOut' }));
		assert.throws(() => validateWindowIntent('launch', { kind: 'launch.signIn' }));
		assert.throws(() => validateWindowIntent('launch', { kind: 'launch.changeServer' }));
		assert.throws(() =>
			validateWindowIntent('candidate', { kind: 'candidate.requestDeparture', extra: true })
		);
	});
});
