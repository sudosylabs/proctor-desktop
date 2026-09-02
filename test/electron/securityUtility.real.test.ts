import { execFileSync } from 'node:child_process';
import { electronExecutable as preparedElectron } from '../../build/lib/electron.ts';
import { repositoryRoot } from '../../build/lib/paths.ts';
import { strict as assert } from 'node:assert';
import test from 'node:test';

void test('authenticated Electron utility process opens and stops the Rust baseline', () => {
	const electronExecutable = preparedElectron();
	assert.equal(typeof electronExecutable, 'string');
	const output = execFileSync(electronExecutable, ['.build/security-utility'], {
		encoding: 'utf8',
		cwd: repositoryRoot,
		timeout: 30_000
	}).trim();
	const result: unknown = JSON.parse(output);
	const permissionPlatform =
		process.platform === 'darwin'
			? 'macos'
			: process.platform === 'win32'
				? 'windows'
				: 'linux';
	assert.ok(typeof result === 'object' && result !== null);
	const permissionStates = (result as { permission_states?: unknown }).permission_states;
	assert.ok(Array.isArray(permissionStates));
	assert.equal(permissionStates.length, 12);
	const mediaPermissionStates = permissionStates.slice(10);
	const mediaMode = process.platform === 'linux' ? 'not_required' : 'os_permission';
	if (process.platform === 'linux') {
		assert.deepEqual(mediaPermissionStates, ['granted', 'granted']);
	} else {
		const validMediaStates = new Set([
			'not_determined',
			'granted',
			'denied',
			'restricted',
			'unavailable'
		]);
		assert.ok(mediaPermissionStates.every((state) => validMediaStates.has(state)));
	}
	assert.deepEqual(result, {
		ready: 'ready',
		sources: [
			'candidate-window',
			'capture-session',
			'clipboard',
			'display-topology',
			'interactive-session',
			'media-device',
			'network-configuration',
			'print-spooler',
			'process-application',
			'removable-storage',
			'virtualization'
		],
		permission_platform: permissionPlatform,
		permission_modes: [...Array(10).fill('not_required'), mediaMode, mediaMode],
		permission_states: [...Array(10).fill('granted'), ...mediaPermissionStates],
		permission_prompt_blocked: true,
		permission_startup_failure_retained_seal: true,
		permission_unsealed_launch_rejected: true,
		permission_mismatched_launch_rejected: true,
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
