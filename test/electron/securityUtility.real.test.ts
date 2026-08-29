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
  const capturePermission = process.platform === 'win32' ? 'granted' : 'unavailable';
  const captureMode = process.platform === 'win32' ? 'not_required' : 'unavailable';
  const permissionPlatform = process.platform === 'darwin'
    ? 'macos'
    : process.platform === 'win32' ? 'windows' : 'linux';
  assert.deepEqual(result, {
    ready: 'ready',
    sources: ['candidate_window', 'capture_session', 'display_topology'],
    permission_platform: permissionPlatform,
    permission_modes: ['not_required', 'not_required', captureMode],
    permission_states: ['granted', 'granted', capturePermission],
    permission_prompt_blocked: true,
    permission_startup_failure_retained_seal: true,
    permission_unsealed_launch_rejected: true,
    permission_active_release_rejected: true,
    permission_preflight_reopened: true,
    constraints: {
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
    },
    close_vetoed: true,
    close_attempt_observed: true,
    stopped: 'stopped',
    process_replacement_required: false,
    released: 'absent',
    application_menu_restored: true,
    listener_setup_failed_closed: true,
    listener_rollback_cleanup_precedence: true,
    listener_cleanup_retried: true,
    listener_failure_released: true,
    restoration_failure_contained: true,
    restoration_failure_blocked: true,
    restoration_failure_recovered: true,
    restoration_failure_released: true,
    failures: []
  });
});
