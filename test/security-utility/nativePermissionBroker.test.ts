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
    macos: [
      ...Array(10).fill('not_required'),
      'unavailable', 'unavailable'
    ],
    windows: [...Array(10).fill('not_required'), 'unavailable', 'unavailable'],
    linux: Array(12).fill('not_required')
  } as const satisfies Record<PlatformFamily, readonly NativePermissionAdapter['mode'][]>;
  const expectedPermissions = {
    macos: [...Array(10).fill('granted'),
      'unavailable', 'unavailable'],
    windows: [...Array(10).fill('granted'), 'unavailable', 'unavailable'],
    linux: Array(12).fill('granted')
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
      (await broker.inspectPreflight(BASELINE_NATIVE_PERMISSION_CAPABILITIES))
        .permissions.map(fact => fact.permission),
      expectedPermissions[platform]
    );
  }
});

test('preflight inspection returns a bounded immutable receipt', async () => {
  const broker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters('windows'),
    monotonicNow: () => 42
  });

  const receipt = await broker.inspectPreflight(BASELINE_NATIVE_PERMISSION_CAPABILITIES);

  assert.deepEqual(receipt, {
    platform: 'windows',
    checkedAtMonotonicMs: 42,
    capabilities: BASELINE_NATIVE_PERMISSION_CAPABILITIES,
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
      },
      {
        capability: 'process-application',
        mode: 'not_required',
        permission: 'granted',
        requestable: false
      },
      ...BASELINE_NATIVE_PERMISSION_CAPABILITIES.slice(4, 10).map(capability => ({
        capability,
        mode: 'not_required' as const,
        permission: 'granted' as const,
        requestable: false
      })),
      ...BASELINE_NATIVE_PERMISSION_CAPABILITIES.slice(10).map(capability => ({
        capability,
        mode: 'unavailable' as const,
        permission: 'unavailable' as const,
        requestable: false
      }))
    ]
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.permissions), true);
  assert.ok(receipt.permissions.every(permission => Object.isFrozen(permission)));
});

test('camera and microphone permissions remain independently inspectable and requestable', async () => {
  const requested: string[] = [];
  const adapters = createBaselineNativePermissionAdapters('macos', {
    inspect: capability => capability === 'camera' ? 'not_determined' : 'granted',
    requestDuringPreflight: capability => {
      requested.push(capability);
      return 'granted';
    }
  });
  const broker = new NativePermissionBroker({ adapters, monotonicNow: () => 42 });

  const receipt = await broker.inspectPreflight(['camera', 'microphone']);
  assert.equal(receipt.permissions.find(fact => fact.capability === 'camera')?.permission,
    'not_determined');
  assert.equal(receipt.permissions.find(fact => fact.capability === 'microphone')?.permission,
    'granted');
  assert.equal((await broker.requestDuringPreflight('camera')).permission, 'granted');
  assert.deepEqual(requested, ['camera']);
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
  await broker.inspectPreflight(['capture-session']);
  calls.length = 0;

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
  await broker.inspectPreflight(['capture-session']);

  const result = await broker.requestDuringPreflight('capture-session');

  assert.equal(requests, 0);
  assert.equal(result.permission, 'granted');
});

test('a capability with no accepted OS prompt fails without invoking another adapter', async () => {
  const broker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters('macos')
  });
  await broker.inspectPreflight(['capture-session']);

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

  const sealing = broker.sealPreflight(['capture-session']);
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

  const inspecting = broker.inspectPreflight(['capture-session']);
  await assert.rejects(
    broker.sealPreflight(['capture-session']),
    error => hasErrorCode(error, 'preflight_operation_in_progress')
  );
  releaseInspection?.();
  await inspecting;
  await broker.sealPreflight(['capture-session']);
});

test('only the current opaque seal can reopen preflight and release is idempotent', async () => {
  const broker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters('windows')
  });
  const sealed = await broker.sealPreflight(BASELINE_NATIVE_PERMISSION_CAPABILITIES);
  const staleSeal = Object.freeze({}) as NativePermissionPreflightSeal;

  assert.throws(
    () => broker.cancelPreflight(),
    error => hasErrorCode(error, 'preflight_sealed')
  );
  assert.throws(
    () => broker.releasePreflightSeal(staleSeal),
    error => hasErrorCode(error, 'stale_preflight_seal')
  );
  broker.releasePreflightSeal(sealed.seal);
  broker.releasePreflightSeal(sealed.seal);
  await broker.inspectPreflight(BASELINE_NATIVE_PERMISSION_CAPABILITIES);
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
    adapters: adapters.map(adapter =>
      adapter.capability === malformed.capability ? malformed : adapter)
  });

  await assert.rejects(
    broker.inspectPreflight(BASELINE_NATIVE_PERMISSION_CAPABILITIES),
    error => hasErrorCode(error, 'invalid_permission_state')
  );
});

test('a failed OS request restores preflight instead of leaving it sealed', async () => {
  const broker = brokerWithAdapter(osPermissionAdapter('macos', 'capture-session', {
    inspect: () => 'not_determined',
    request: () => { throw new Error('OS request failed'); }
  }));
  await broker.inspectPreflight(['capture-session']);

  await assert.rejects(
    broker.requestDuringPreflight('capture-session'),
    error => hasErrorCode(error, 'permission_request_failed')
  );
  await broker.inspectPreflight(['capture-session']);
});

test('invalid receipt timing fails closed and restores preflight', async () => {
  const broker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters('windows'),
    monotonicNow: () => Number.NaN
  });

  await assert.rejects(
    broker.inspectPreflight(BASELINE_NATIVE_PERMISSION_CAPABILITIES),
    error => hasErrorCode(error, 'invalid_monotonic_time')
  );
  await assert.rejects(
    broker.inspectPreflight(BASELINE_NATIVE_PERMISSION_CAPABILITIES),
    error => hasErrorCode(error, 'invalid_monotonic_time')
  );
});

test('preflight inspects only the frozen selection and rejects scope drift', async () => {
  const inspected: NativePermissionCapability[] = [];
  const adapters = createBaselineNativePermissionAdapters('macos', {
    inspect: capability => {
      inspected.push(capability);
      return 'granted';
    }
  });
  const broker = new NativePermissionBroker({ adapters, monotonicNow: () => 42 });

  const receipt = await broker.inspectPreflight(['camera']);

  assert.deepEqual(receipt.capabilities, ['camera']);
  assert.deepEqual(inspected, ['camera']);
  await assert.rejects(
    broker.requestDuringPreflight('microphone'),
    error => hasErrorCode(error, 'capability_outside_preflight_scope')
  );
  await assert.rejects(
    broker.sealPreflight(['microphone']),
    error => hasErrorCode(error, 'preflight_scope_mismatch')
  );
});

test('unsealed cancellation drops the frozen scope and permits a new selection', async () => {
  const broker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters('windows'),
    monotonicNow: () => 42
  });
  await broker.inspectPreflight(['display-topology']);

  broker.cancelPreflight();

  const receipt = await broker.inspectPreflight(['candidate-window']);
  assert.deepEqual(receipt.capabilities, ['candidate-window']);
});

test('cancellation invalidates an in-flight inspection before it can publish a receipt', async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const broker = brokerWithAdapter(osPermissionAdapter('macos', 'capture-session', {
    inspect: async () => { await pending; return 'granted'; },
    request: () => 'granted'
  }));

  const inspecting = broker.inspectPreflight(['capture-session']);
  broker.cancelPreflight();
  release?.();

  await assert.rejects(inspecting, error => hasErrorCode(error, 'preflight_cancelled'));
  const receipt = await broker.inspectPreflight(['display-topology']);
  assert.deepEqual(receipt.capabilities, ['display-topology']);
});

test('cancellation invalidates an in-flight OS permission request', async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let initialInspection = true;
  const broker = brokerWithAdapter(osPermissionAdapter('macos', 'capture-session', {
    inspect: () => {
      if (initialInspection) {
        initialInspection = false;
        return 'not_determined';
      }
      return 'not_determined';
    },
    request: async () => { await pending; return 'granted'; }
  }));
  await broker.inspectPreflight(['capture-session']);

  const requesting = broker.requestDuringPreflight('capture-session');
  await Promise.resolve();
  broker.cancelPreflight();
  await assert.rejects(
    broker.inspectPreflight(['candidate-window']),
    error => hasErrorCode(error, 'preflight_operation_in_progress')
  );
  release?.();

  await assert.rejects(requesting, error => hasErrorCode(error, 'preflight_cancelled'));
  const receipt = await broker.inspectPreflight(['candidate-window']);
  assert.deepEqual(receipt.capabilities, ['candidate-window']);
});

test('cancellation invalidates an in-flight seal before launch authorization exists', async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const broker = brokerWithAdapter(osPermissionAdapter('macos', 'capture-session', {
    inspect: async () => { await pending; return 'granted'; },
    request: () => 'granted'
  }));

  const sealing = broker.sealPreflight(['capture-session']);
  broker.cancelPreflight();
  release?.();

  await assert.rejects(sealing, error => hasErrorCode(error, 'preflight_cancelled'));
  assert.throws(
    () => broker.releasePreflightSeal(Object.freeze({}) as NativePermissionPreflightSeal),
    error => hasErrorCode(error, 'no_active_preflight_seal')
  );
  const sealed = await broker.sealPreflight(['display-topology']);
  assert.deepEqual(sealed.receipt.capabilities, ['display-topology']);
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
