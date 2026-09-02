import {
	isPermissionState,
	isPlatformFamily,
	type PermissionState,
	type PlatformFamily
} from '../common/nativeObservation.generated.js';

export const BASELINE_NATIVE_PERMISSION_CAPABILITIES = [
	'display-topology',
	'candidate-window',
	'capture-session',
	'process-application',
	'interactive-session',
	'clipboard',
	'print-spooler',
	'removable-storage',
	'virtualization',
	'network-configuration',
	'camera',
	'microphone'
] as const;

export type NativePermissionCapability = (typeof BASELINE_NATIVE_PERMISSION_CAPABILITIES)[number];

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
	readonly capabilities: readonly NativePermissionCapability[];
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
	| 'invalid_preflight_scope'
	| 'capability_outside_preflight_scope'
	| 'preflight_scope_mismatch'
	| 'invalid_monotonic_time'
	| 'invalid_permission_state'
	| 'permission_inspection_failed'
	| 'permission_request_failed'
	| 'permission_request_unavailable'
	| 'preflight_cancelled'
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

export type NativeMediaPermissionCapability = 'camera' | 'microphone';

export interface NativeMediaPermissionServices {
	readonly inspect: (
		capability: NativeMediaPermissionCapability
	) => PermissionState | Promise<PermissionState>;
	readonly requestDuringPreflight?: (
		capability: NativeMediaPermissionCapability
	) => PermissionState | Promise<PermissionState>;
}

type BrokerState = 'preflight' | 'inspecting' | 'requesting' | 'sealing' | 'sealed';

export class NativePermissionBroker {
	readonly #adapters: readonly NativePermissionAdapter[];
	readonly #platform: PlatformFamily;
	readonly #monotonicNow: () => number;
	#state: BrokerState = 'preflight';
	#preflightScope: readonly NativePermissionCapability[] | undefined;
	#activeSeal: NativePermissionPreflightSeal | undefined;
	#releasedSeal: NativePermissionPreflightSeal | undefined;
	#cancellationEpoch = 0;

	public constructor(options: NativePermissionBrokerOptions) {
		this.#platform = validateAdapterManifest(options.adapters);
		this.#adapters = Object.freeze(options.adapters.map(freezeAdapter));
		this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
	}

	public async inspectPreflight(
		capabilities: readonly NativePermissionCapability[]
	): Promise<NativePermissionPreflightReceipt> {
		this.#assertPreflightOpen();
		const scope = this.#establishScope(capabilities);
		const epoch = this.#cancellationEpoch;
		this.#state = 'inspecting';
		try {
			return await this.#inspectReceipt(scope, epoch);
		} finally {
			if (this.#state === 'inspecting') this.#state = 'preflight';
		}
	}

	public async requestDuringPreflight(
		capability: NativePermissionCapability
	): Promise<NativePermissionFact> {
		this.#assertPreflightOpen();
		if (this.#preflightScope === undefined || !this.#preflightScope.includes(capability)) {
			throw new NativePermissionBrokerError('capability_outside_preflight_scope');
		}
		const adapter = this.#adapter(capability);
		if (adapter.mode !== 'os_permission') {
			throw new NativePermissionBrokerError('permission_request_unavailable');
		}
		const epoch = this.#cancellationEpoch;
		this.#state = 'requesting';
		try {
			const current = await inspectAdapter(adapter);
			this.#assertCurrentEpoch(epoch);
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
			this.#assertCurrentEpoch(epoch);
			if (!isPermissionState(requested)) {
				throw new NativePermissionBrokerError('invalid_permission_state');
			}
			return permissionFact(adapter, requested);
		} finally {
			if (this.#state === 'requesting') this.#state = 'preflight';
		}
	}

	public async sealPreflight(
		capabilities: readonly NativePermissionCapability[]
	): Promise<SealedNativePermissionPreflight> {
		this.#assertPreflightOpen();
		const scope = this.#establishScope(capabilities);
		const epoch = this.#cancellationEpoch;
		this.#state = 'sealing';
		this.#releasedSeal = undefined;
		try {
			const receipt = await this.#inspectReceipt(scope, epoch);
			this.#assertCurrentEpoch(epoch);
			const seal = Object.freeze({}) as NativePermissionPreflightSeal;
			this.#activeSeal = seal;
			this.#state = 'sealed';
			return Object.freeze({ receipt, seal });
		} catch (error) {
			if (this.#state === 'sealing') this.#state = 'preflight';
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
		this.#preflightScope = undefined;
		this.#state = 'preflight';
	}

	public cancelPreflight(): void {
		if (this.#state === 'sealed') {
			throw new NativePermissionBrokerError('preflight_sealed');
		}
		const operationInProgress =
			this.#state === 'inspecting' ||
			this.#state === 'requesting' ||
			this.#state === 'sealing';
		this.#cancellationEpoch += 1;
		if (!operationInProgress) this.#state = 'preflight';
		this.#activeSeal = undefined;
		this.#preflightScope = undefined;
		this.#releasedSeal = undefined;
	}

	async #inspectReceipt(
		capabilities: readonly NativePermissionCapability[],
		epoch: number
	): Promise<NativePermissionPreflightReceipt> {
		const permissions = Object.freeze(
			await Promise.all(
				capabilities.map(async (capability) => {
					const adapter = this.#adapter(capability);
					const permission = await inspectAdapter(adapter);
					this.#assertCurrentEpoch(epoch);
					return permissionFact(adapter, permission);
				})
			)
		);
		this.#assertCurrentEpoch(epoch);
		return Object.freeze({
			platform: this.#platform,
			checkedAtMonotonicMs: this.#checkedAtMonotonicMs(),
			capabilities,
			permissions
		});
	}

	#assertCurrentEpoch(epoch: number): void {
		if (epoch !== this.#cancellationEpoch) {
			throw new NativePermissionBrokerError('preflight_cancelled');
		}
	}

	#establishScope(
		capabilities: readonly NativePermissionCapability[]
	): readonly NativePermissionCapability[] {
		const scope = validatePreflightScope(capabilities);
		if (this.#preflightScope !== undefined && !sameCapabilities(this.#preflightScope, scope)) {
			throw new NativePermissionBrokerError('preflight_scope_mismatch');
		}
		this.#preflightScope ??= scope;
		return this.#preflightScope;
	}

	#checkedAtMonotonicMs(): number {
		const value = this.#monotonicNow();
		if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
			throw new NativePermissionBrokerError('invalid_monotonic_time');
		}
		return value;
	}

	#adapter(capability: NativePermissionCapability): NativePermissionAdapter {
		const adapter = this.#adapters.find((candidate) => candidate.capability === capability);
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

function validatePreflightScope(
	capabilities: readonly NativePermissionCapability[]
): readonly NativePermissionCapability[] {
	if (
		capabilities.length === 0 ||
		capabilities.length > BASELINE_NATIVE_PERMISSION_CAPABILITIES.length
	) {
		throw new NativePermissionBrokerError('invalid_preflight_scope');
	}
	const expected = BASELINE_NATIVE_PERMISSION_CAPABILITIES.filter((capability) =>
		capabilities.includes(capability)
	);
	if (
		expected.length !== capabilities.length ||
		!expected.every((capability, index) => capabilities[index] === capability)
	) {
		throw new NativePermissionBrokerError('invalid_preflight_scope');
	}
	return Object.freeze([...expected]);
}

function sameCapabilities(
	left: readonly NativePermissionCapability[],
	right: readonly NativePermissionCapability[]
): boolean {
	return (
		left.length === right.length &&
		left.every((capability, index) => right[index] === capability)
	);
}

export function createBaselineNativePermissionAdapters(
	platform: PlatformFamily,
	mediaPermissions?: NativeMediaPermissionServices
): readonly NativePermissionAdapter[] {
	if (!isPlatformFamily(platform)) {
		throw new NativePermissionBrokerError('invalid_adapter_manifest');
	}
	return Object.freeze([
		fixedAdapter(platform, 'display-topology', 'not_required'),
		fixedAdapter(platform, 'candidate-window', 'not_required'),
		fixedAdapter(platform, 'capture-session', 'not_required'),
		fixedAdapter(platform, 'process-application', 'not_required'),
		fixedAdapter(platform, 'interactive-session', 'not_required'),
		fixedAdapter(platform, 'clipboard', 'not_required'),
		fixedAdapter(platform, 'print-spooler', 'not_required'),
		fixedAdapter(platform, 'removable-storage', 'not_required'),
		fixedAdapter(platform, 'virtualization', 'not_required'),
		fixedAdapter(platform, 'network-configuration', 'not_required'),
		mediaPermissionAdapter(platform, 'camera', mediaPermissions),
		mediaPermissionAdapter(platform, 'microphone', mediaPermissions)
	]);
}

function mediaPermissionAdapter(
	platform: PlatformFamily,
	capability: NativeMediaPermissionCapability,
	services: NativeMediaPermissionServices | undefined
): NativePermissionAdapter {
	if (platform === 'linux') {
		return fixedAdapter(platform, capability, 'not_required');
	}
	if (services === undefined) {
		return fixedAdapter(platform, capability, 'unavailable');
	}
	return Object.freeze({
		capability,
		platform,
		mode: 'os_permission',
		inspect: () => services.inspect(capability),
		...(services.requestDuringPreflight === undefined
			? {}
			: {
					requestDuringPreflight: () =>
						services.requestDuringPreflight?.(capability) ?? 'unavailable'
				})
	});
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
	if (adapter === undefined || adapter.platform !== platform || adapter.capability !== capability)
		return false;
	if (adapter.mode !== 'os_permission')
		return adapter.mode === 'not_required' || adapter.mode === 'unavailable';
	return (
		typeof adapter.inspect === 'function' &&
		(adapter.requestDuringPreflight === undefined ||
			typeof adapter.requestDuringPreflight === 'function')
	);
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
		requestable:
			adapter.mode === 'os_permission' && adapter.requestDuringPreflight !== undefined
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
