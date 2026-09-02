import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import { validateWindowDescriptor, validateWindowIntent } from '../../../../src/prctr/platform/windows/common/windowProtocol.ts';

suite('Product window protocol', () => {
  test('normalizes HTTPS origins and rejects credentials, paths, and malformed identities', () => {
    const descriptor = validateWindowDescriptor({ protocolVersion: 1, kind: 'authenticated', windowId: 'w1', institutionOrigin: 'https://EXAMPLE.edu:443/', principalId: 'p1', sessionId: 's1', initialDestination: 'home' });
    assert.strictEqual(descriptor.institutionOrigin, 'https://example.edu');
    for (const origin of ['http://example.edu', 'https://user@example.edu', 'https://example.edu/path']) {
      assert.throws(() => validateWindowDescriptor({ protocolVersion: 1, kind: 'launch', windowId: 'w1', institutionOrigin: origin }));
    }
    assert.throws(() => validateWindowDescriptor({ protocolVersion: 1, kind: 'candidate', windowId: 'w1' }));
  });

  test('accepts only exact capability-specific intents', () => {
    assert.deepStrictEqual(validateWindowIntent('authenticated', { kind: 'authenticated.joinAttempt', attemptId: 'a1' }), { kind: 'authenticated.joinAttempt', attemptId: 'a1' });
    assert.throws(() => validateWindowIntent('launch', { kind: 'authenticated.signOut' }));
    assert.throws(() => validateWindowIntent('candidate', { kind: 'candidate.requestDeparture', extra: true }));
  });
});
