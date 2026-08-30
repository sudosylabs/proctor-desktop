import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PRIVATE_CLIPBOARD_BYTES,
  PrivateAttemptClipboard,
  PrivateAttemptClipboardError
} from '../../src/prctr/platform/native/common/privateAttemptClipboard.ts';

test('private clipboard keeps bounded text inside one disposable Attempt instance', () => {
  const clipboard = new PrivateAttemptClipboard('private_attempt');

  assert.equal(clipboard.readText(), undefined);
  assert.equal(clipboard.writeText('candidate text'), 'stored');
  assert.equal(clipboard.readText(), 'candidate text');
  assert.equal(clipboard.retainedByteLength, 14);
  clipboard.clear();
  assert.equal(clipboard.readText(), undefined);

  clipboard.writeText('replacement');
  clipboard.dispose();
  assert.equal(clipboard.retainedByteLength, 0);
  assert.throws(
    () => clipboard.readText(),
    error => hasClipboardError(error, 'clipboard_disposed')
  );
});

test('disabled clipboard never retains candidate text', () => {
  const clipboard = new PrivateAttemptClipboard('disabled');
  assert.equal(clipboard.writeText('must not be retained'), 'disabled');
  assert.equal(clipboard.readText(), undefined);
  assert.equal(clipboard.retainedByteLength, 0);
});

test('private clipboard rejects an oversized UTF-8 payload without replacing retained text', () => {
  const clipboard = new PrivateAttemptClipboard('private_attempt');
  clipboard.writeText('retained');

  assert.throws(
    () => clipboard.writeText('x'.repeat(MAX_PRIVATE_CLIPBOARD_BYTES + 1)),
    error => hasClipboardError(error, 'clipboard_payload_too_large')
  );
  assert.equal(clipboard.readText(), 'retained');
});

function hasClipboardError(error: unknown, code: PrivateAttemptClipboardError['code']): boolean {
  return error instanceof PrivateAttemptClipboardError && error.code === code;
}
