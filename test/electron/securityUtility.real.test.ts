import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { strict as assert } from 'node:assert';
import test from 'node:test';

test('authenticated Electron utility process opens and stops the Rust baseline', () => {
  const electronExecutable: unknown = createRequire(import.meta.url)('electron');
  assert.equal(typeof electronExecutable, 'string');
  const output = execFileSync(electronExecutable, ['.build/security-utility'], {
    encoding: 'utf8',
    timeout: 30_000
  }).trim();
  const result: unknown = JSON.parse(output);
  assert.deepEqual(result, {
    ready: 'ready',
    sources: ['candidate_window', 'capture_session', 'display_topology'],
    stopped: 'stopped',
    process_replacement_required: false,
    failures: []
  });
});
