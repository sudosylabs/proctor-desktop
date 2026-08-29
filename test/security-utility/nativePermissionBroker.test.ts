import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  PermissionState,
  PlatformFamily
} from '../../src/prctr/platform/native/common/nativeObservation.generated.js';
import {
  BASELINE_NATIVE_PERMISSION_CAPABILITIES,
  NativePermissionBroker,
  NativePermissionBrokerError,
  createBaselineNativePermissionAdapters,
  type NativeOsPermissionAdapter,
  type NativePermissionAdapter,
  type NativePermissionCapability,
  type NativePermissionPreflightSeal
} from '../../src/prctr/platform/native/electron-main/nativePermissionBroker.js';

test('baseline adapters declare exact cross-platform permission requirements', async () => {
  const expectedModes = {
    macos: ['not_required', 'not_required', 'unavailable'],
    windows: ['not_required', 'not_required', 'not_required'],
    linux: ['not_required', 'not_required', 'unavailable']
  } as const satisfies Record<PlatformFamily, readonly NativePermissionAdapter['mode'][]>;
  const expectedPermissions = {
    macos: ['granted', 'granted', 'unavailable'],
    windows: ['granted', 'granted', 'granted'],
    linux: ['granted', 'granted', 'unavailable']
  } as const satisfies Record<PlatformFamily, readonly PermissionState[]>;

  for (const platform of ['macos', 'windows', 'linux'] as const) {
    const adapters = createBaselineNativePermissionAdapters(platform);
    assert.deepEqual(
      adapters.map(adapter => adapter.capability),
      BASELINE_NATIVE_PERMISSION_CAPABILITIES
    );
    assert.deepEqual(adapters.map(adapter => adapter.mode), expectedModes[platform]);
    assert.ok(adapters.every(adapter => adapter.platform === platform));

    const broker = new NativePermissionBroker({ adapters, monotonicNow: () => 42 });
    assert.deepEqual(
      (await broker.inspectPreflight()).permissions.map(fact => fact.permission),
      expectedPermissions[platform]
    );
  }
});

test('preflight inspection returns a bounded immutable receipt', async () => {
  const broker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters('windows'),
    monotonicNow: () => 42
  });

  const receipt = await broker.inspectPreflight();

  assert.deepEqual(receipt, {
    platform: 'windows',
    checkedAtMonotonicMs: 42,
    permissions: [
      {
        capability: 'display-topology',
        mode: 'not_required',
        permission: 'granted',
        requestable: false
      },
      {
        capability: 'candidate-window',
        mode: 'not_required',
        permission: 'granted',
        requestable: false
      },
      {
        capability: 'capture-session',
        mode: 'not_required',
        permission: 'granted',
        requestable: false
      }
    ]
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.permissions), true);
  assert.ok(receipt.permissions.every(permission => Object.isFrozen(permission)));
});

test('an explicit preflight request refreshes only the selected OS permission', async () => {
  const calls: string[] = [];
  let permission: PermissionState = 'not_determined';
  const broker = brokerWithAdapter(osPermissionAdapter('macos', 'capture-session', {
    inspect: () => {
      calls.push('inspect');
      return permission;
    },
    request: () => {
      calls.push('request');
      permission = 'granted';
      return permission;
    }
  }));

  const result = await broker.requestDuringPreflight('capture-session');

  assert.deepEqual(calls, ['inspect', 'request']);
  assert.deepEqual(result, {
    capability: 'capture-session',
    mode: 'os_permission',
    permission: 'granted',
    requestable: true
  });
});

test('a granted OS permission does not invoke its request callback again', async () => {
  let requests = 0;
  const broker = brokerWithAdapter(osPermissionAdapter('macos', 'capture-session', {
    inspect: () => 'granted',
    request: () => {
      requests += 1;
      return 'granted';
    }
  }));

  const result = await broker.requestDuringPreflight('capture-session');

  assert.equal(requests, 0);
  assert.equal(result.permission, 'granted');
});

test('a capability with no accepted OS prompt fails without invoking another adapter', async () => {
  const broker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters('macos')
  });

  await assert.rejects(
    broker.requestDuringPreflight('capture-session'),
    error => hasErrorCode(error, 'permission_request_unavailable')
  );
});

test('sealing preflight fences prompts before asynchronous inspection completes', async () => {
  let releaseInspection: (() => void) | undefined;
  const inspection = new Promise<void>(resolve => { releaseInspection = resolve; });
  const broker = brokerWithAdapter(osPermissionAdapter('macos', 'capture-session', {
    inspect: async (): Promise<PermissionState> => {
      await inspection;
      return 'granted';
    },
    request: () => 'granted'
  }));

  const sealing = broker.sealPreflight();
  await assert.rejects(
    broker.requestDuringPreflight('capture-session'),
    error => hasErrorCode(error, 'preflight_sealed')
  );
  releaseInspection?.();
  const sealed = await sealing;

  assert.equal(sealed.receipt.platform, 'macos');
  assert.equal(Object.isFrozen(sealed), true);
  assert.equal(Object.isFrozen(sealed.seal), true);
});

test('preflight inspection cannot overlap sealing', async () => {
  let releaseInspection: (() => void) | undefined;
  const inspection = new Promise<void>(resolve => { releaseInspection = resolve; });
  const broker = brokerWithAdapter(osPermissionAdapter('macos', 'capture-session', {
    inspect: async (): Promise<PermissionState> => {
      await inspection;
      return 'granted';
    },
    request: () => 'granted'
  }));

  const inspecting = broker.inspectPreflight();
  await assert.rejects(
    broker.sealPreflight(),
    error => hasErrorCode(error, 'preflight_operation_in_progress')
  );
  releaseInspection?.();
  await inspecting;
  await broker.sealPreflight();
});

test('only the current opaque seal can reopen preflight and release is idempotent', async () => {
  const broker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters('windows')
  });
  const sealed = await broker.sealPreflight();
  const staleSeal = Object.freeze({}) as NativePermissionPreflightSeal;

  assert.throws(
    () => broker.releasePreflightSeal(staleSeal),
    error => hasErrorCode(error, 'stale_preflight_seal')
  );
  broker.releasePreflightSeal(sealed.seal);
  broker.releasePreflightSeal(sealed.seal);
  await broker.inspectPreflight();
  assert.throws(
    () => broker.releasePreflightSeal(staleSeal),
    error => hasErrorCode(error, 'no_active_preflight_seal')
  );
});

test('malformed adapter manifests and OS permission results fail closed', async () => {
  assert.throws(
    () => new NativePermissionBroker({
      adapters: createBaselineNativePermissionAdapters('windows').slice(0, 2)
    }),
    error => hasErrorCode(error, 'invalid_adapter_manifest')
  );

  const adapters = createBaselineNativePermissionAdapters('windows');
  const malformed: NativeOsPermissionAdapter = {
    capability: 'capture-session',
    platform: 'windows',
    mode: 'os_permission',
    inspect: () => 'unexpected' as PermissionState
  };
  const broker = new NativePermissionBroker({
    adapters: [adapters[0], adapters[1], malformed]
  });

  await assert.rejects(
    broker.inspectPreflight(),
    error => hasErrorCode(error, 'invalid_permission_state')
  );
});

test('a failed OS request restores preflight instead of leaving it sealed', async () => {
  const broker = brokerWithAdapter(osPermissionAdapter('macos', 'capture-session', {
    inspect: () => 'not_determined',
    request: () => { throw new Error('OS request failed'); }
  }));

  await assert.rejects(
    broker.requestDuringPreflight('capture-session'),
    error => hasErrorCode(error, 'permission_request_failed')
  );
  await broker.inspectPreflight();
});

test('invalid receipt timing fails closed and restores preflight', async () => {
  const broker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters('windows'),
    monotonicNow: () => Number.NaN
  });

  await assert.rejects(
    broker.inspectPreflight(),
    error => hasErrorCode(error, 'invalid_monotonic_time')
  );
  await assert.rejects(
    broker.inspectPreflight(),
    error => hasErrorCode(error, 'invalid_monotonic_time')
  );
});

function brokerWithAdapter(adapter: NativePermissionAdapter): NativePermissionBroker {
  const adapters = createBaselineNativePermissionAdapters(adapter.platform)
    .map(candidate => candidate.capability === adapter.capability ? adapter : candidate);
  return new NativePermissionBroker({ adapters });
}

function osPermissionAdapter(
  platform: PlatformFamily,
  capability: NativePermissionCapability,
  callbacks: {
    readonly inspect: () => PermissionState | Promise<PermissionState>;
    readonly request: () => PermissionState | Promise<PermissionState>;
  }
): NativeOsPermissionAdapter {
  return Object.freeze({
    platform,
    capability,
    mode: 'os_permission',
    inspect: callbacks.inspect,
    requestDuringPreflight: callbacks.request
  });
}

function hasErrorCode(
  error: unknown,
  code: NativePermissionBrokerError['code']
): boolean {
  return error instanceof NativePermissionBrokerError && error.code === code;
}
