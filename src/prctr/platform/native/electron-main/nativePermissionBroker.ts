import {
  isPermissionState,
  isPlatformFamily,
  type PermissionState,
  type PlatformFamily
} from '../common/nativeObservation.generated.js';

export const BASELINE_NATIVE_PERMISSION_CAPABILITIES = [
  'display-topology',
  'candidate-window',
  'capture-session'
] as const;

export type NativePermissionCapability =
  typeof BASELINE_NATIVE_PERMISSION_CAPABILITIES[number];

interface NativePermissionAdapterIdentity {
  readonly capability: NativePermissionCapability;
  readonly platform: PlatformFamily;
}

export interface NativePermissionNotRequiredAdapter extends NativePermissionAdapterIdentity {
  readonly mode: 'not_required';
}

export interface NativePermissionUnavailableAdapter extends NativePermissionAdapterIdentity {
  readonly mode: 'unavailable';
}

export interface NativeOsPermissionAdapter extends NativePermissionAdapterIdentity {
  readonly mode: 'os_permission';
  readonly inspect: () => PermissionState | Promise<PermissionState>;
  readonly requestDuringPreflight?: () => PermissionState | Promise<PermissionState>;
}

export type NativePermissionAdapter =
  | NativePermissionNotRequiredAdapter
  | NativePermissionUnavailableAdapter
  | NativeOsPermissionAdapter;

export interface NativePermissionFact {
  readonly capability: NativePermissionCapability;
  readonly mode: NativePermissionAdapter['mode'];
  readonly permission: PermissionState;
  readonly requestable: boolean;
}

export interface NativePermissionPreflightReceipt {
  readonly platform: PlatformFamily;
  readonly checkedAtMonotonicMs: number;
  readonly permissions: readonly NativePermissionFact[];
}

declare const nativePermissionSealBrand: unique symbol;

export interface NativePermissionPreflightSeal {
  readonly [nativePermissionSealBrand]: true;
}

export interface SealedNativePermissionPreflight {
  readonly receipt: NativePermissionPreflightReceipt;
  readonly seal: NativePermissionPreflightSeal;
}

export type NativePermissionBrokerErrorCode =
  | 'invalid_adapter_manifest'
  | 'invalid_monotonic_time'
  | 'invalid_permission_state'
  | 'permission_inspection_failed'
  | 'permission_request_failed'
  | 'permission_request_unavailable'
  | 'preflight_operation_in_progress'
  | 'preflight_sealed'
  | 'no_active_preflight_seal'
  | 'stale_preflight_seal';

export class NativePermissionBrokerError extends Error {
  public readonly code: NativePermissionBrokerErrorCode;

  public constructor(code: NativePermissionBrokerErrorCode, options?: ErrorOptions) {
    super(`native permission broker failed: ${code}`, options);
    this.name = 'NativePermissionBrokerError';
    this.code = code;
  }
}

export interface NativePermissionBrokerOptions {
  readonly adapters: readonly NativePermissionAdapter[];
  readonly monotonicNow?: () => number;
}

type BrokerState =
  | 'preflight'
  | 'inspecting'
  | 'requesting'
  | 'sealing'
  | 'sealed';

export class NativePermissionBroker {
  readonly #adapters: readonly NativePermissionAdapter[];
  readonly #platform: PlatformFamily;
  readonly #monotonicNow: () => number;
  #state: BrokerState = 'preflight';
  #activeSeal: NativePermissionPreflightSeal | undefined;
  #releasedSeal: NativePermissionPreflightSeal | undefined;

  public constructor(options: NativePermissionBrokerOptions) {
    this.#platform = validateAdapterManifest(options.adapters);
    this.#adapters = Object.freeze(options.adapters.map(freezeAdapter));
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  public async inspectPreflight(): Promise<NativePermissionPreflightReceipt> {
    this.#assertPreflightOpen();
    this.#state = 'inspecting';
    try {
      return await this.#inspectReceipt();
    } finally {
      this.#state = 'preflight';
    }
  }

  public async requestDuringPreflight(
    capability: NativePermissionCapability
  ): Promise<NativePermissionFact> {
    this.#assertPreflightOpen();
    const adapter = this.#adapter(capability);
    if (adapter.mode !== 'os_permission') {
      throw new NativePermissionBrokerError('permission_request_unavailable');
    }
    this.#state = 'requesting';
    try {
      const current = await inspectAdapter(adapter);
      if (current === 'granted') return permissionFact(adapter, current);
      if (adapter.requestDuringPreflight === undefined) {
        throw new NativePermissionBrokerError('permission_request_unavailable');
      }
      let requested: PermissionState;
      try {
        requested = await adapter.requestDuringPreflight();
      } catch (cause) {
        throw new NativePermissionBrokerError('permission_request_failed', { cause });
      }
      if (!isPermissionState(requested)) {
        throw new NativePermissionBrokerError('invalid_permission_state');
      }
      return permissionFact(adapter, requested);
    } finally {
      this.#state = 'preflight';
    }
  }

  public async sealPreflight(): Promise<SealedNativePermissionPreflight> {
    this.#assertPreflightOpen();
    this.#state = 'sealing';
    this.#releasedSeal = undefined;
    try {
      const receipt = await this.#inspectReceipt();
      const seal = Object.freeze({}) as NativePermissionPreflightSeal;
      this.#activeSeal = seal;
      this.#state = 'sealed';
      return Object.freeze({ receipt, seal });
    } catch (error) {
      this.#state = 'preflight';
      throw error;
    }
  }

  public releasePreflightSeal(seal: NativePermissionPreflightSeal): void {
    if (this.#state === 'preflight' && seal === this.#releasedSeal) return;
    if (this.#state !== 'sealed' || this.#activeSeal === undefined) {
      throw new NativePermissionBrokerError('no_active_preflight_seal');
    }
    if (seal !== this.#activeSeal) {
      throw new NativePermissionBrokerError('stale_preflight_seal');
    }
    this.#activeSeal = undefined;
    this.#releasedSeal = seal;
    this.#state = 'preflight';
  }

  async #inspectReceipt(): Promise<NativePermissionPreflightReceipt> {
    const permissions = Object.freeze(await Promise.all(
      this.#adapters.map(async adapter => permissionFact(adapter, await inspectAdapter(adapter)))
    ));
    return Object.freeze({
      platform: this.#platform,
      checkedAtMonotonicMs: this.#checkedAtMonotonicMs(),
      permissions
    });
  }

  #checkedAtMonotonicMs(): number {
    const value = this.#monotonicNow();
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new NativePermissionBrokerError('invalid_monotonic_time');
    }
    return value;
  }

  #adapter(capability: NativePermissionCapability): NativePermissionAdapter {
    const adapter = this.#adapters.find(candidate => candidate.capability === capability);
    if (adapter === undefined) {
      throw new NativePermissionBrokerError('invalid_adapter_manifest');
    }
    return adapter;
  }

  #assertPreflightOpen(): void {
    if (this.#state === 'sealing' || this.#state === 'sealed') {
      throw new NativePermissionBrokerError('preflight_sealed');
    }
    if (this.#state !== 'preflight') {
      throw new NativePermissionBrokerError('preflight_operation_in_progress');
    }
  }
}

export function createBaselineNativePermissionAdapters(
  platform: PlatformFamily
): readonly [NativePermissionAdapter, NativePermissionAdapter, NativePermissionAdapter] {
  if (!isPlatformFamily(platform)) {
    throw new NativePermissionBrokerError('invalid_adapter_manifest');
  }
  return Object.freeze([
    fixedAdapter(platform, 'display-topology', 'not_required'),
    fixedAdapter(platform, 'candidate-window', 'not_required'),
    fixedAdapter(
      platform,
      'capture-session',
      platform === 'windows' ? 'not_required' : 'unavailable'
    )
  ]);
}

function validateAdapterManifest(adapters: readonly NativePermissionAdapter[]): PlatformFamily {
  if (adapters.length !== BASELINE_NATIVE_PERMISSION_CAPABILITIES.length) {
    throw new NativePermissionBrokerError('invalid_adapter_manifest');
  }
  const platform = adapters[0]?.platform;
  if (!isPlatformFamily(platform)) {
    throw new NativePermissionBrokerError('invalid_adapter_manifest');
  }
  for (const [index, capability] of BASELINE_NATIVE_PERMISSION_CAPABILITIES.entries()) {
    const adapter = adapters[index];
    if (!isValidAdapter(adapter, platform, capability)) {
      throw new NativePermissionBrokerError('invalid_adapter_manifest');
    }
  }
  return platform;
}

function isValidAdapter(
  adapter: NativePermissionAdapter | undefined,
  platform: PlatformFamily,
  capability: NativePermissionCapability
): adapter is NativePermissionAdapter {
  if (adapter === undefined || adapter.platform !== platform
    || adapter.capability !== capability) return false;
  if (adapter.mode !== 'os_permission') return adapter.mode === 'not_required'
    || adapter.mode === 'unavailable';
  return typeof adapter.inspect === 'function'
    && (adapter.requestDuringPreflight === undefined
      || typeof adapter.requestDuringPreflight === 'function');
}

async function inspectAdapter(adapter: NativePermissionAdapter): Promise<PermissionState> {
  if (adapter.mode === 'not_required') return 'granted';
  if (adapter.mode === 'unavailable') return 'unavailable';
  let permission: PermissionState;
  try {
    permission = await adapter.inspect();
  } catch (cause) {
    throw new NativePermissionBrokerError('permission_inspection_failed', { cause });
  }
  if (!isPermissionState(permission)) {
    throw new NativePermissionBrokerError('invalid_permission_state');
  }
  return permission;
}

function permissionFact(
  adapter: NativePermissionAdapter,
  permission: PermissionState
): NativePermissionFact {
  return Object.freeze({
    capability: adapter.capability,
    mode: adapter.mode,
    permission,
    requestable: adapter.mode === 'os_permission'
      && adapter.requestDuringPreflight !== undefined
  });
}

function freezeAdapter(adapter: NativePermissionAdapter): NativePermissionAdapter {
  if (adapter.mode !== 'os_permission') {
    return Object.freeze({
      capability: adapter.capability,
      platform: adapter.platform,
      mode: adapter.mode
    });
  }
  const inspect = adapter.inspect.bind(adapter);
  const request = adapter.requestDuringPreflight?.bind(adapter);
  return Object.freeze({
    capability: adapter.capability,
    platform: adapter.platform,
    mode: adapter.mode,
    inspect,
    ...(request === undefined ? {} : { requestDuringPreflight: request })
  });
}

function fixedAdapter(
  platform: PlatformFamily,
  capability: NativePermissionCapability,
  mode: 'not_required' | 'unavailable'
): NativePermissionAdapter {
  return Object.freeze({ capability, platform, mode });
}
