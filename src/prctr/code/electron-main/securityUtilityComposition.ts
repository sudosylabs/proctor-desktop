import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	MessageChannelMain,
	systemPreferences,
	utilityProcess,
	type UtilityProcess
} from 'electron';
import type {
	CandidateWindowHostEvent,
	CandidateWindowState,
	PlatformFamily
} from '../../platform/native/common/nativeObservation.generated.js';
import {
	SECURITY_UTILITY_STARTUP_TIMEOUT_MS,
	isSelectedNativeSources,
	isSelectedSourceCategories,
	type NativeSupervisorPoll,
	type NativeSupervisorStop,
	type NativeSourceId,
	type NativeSourceCategory,
	type SecurityUtilityReady
} from '../../platform/native/common/securityUtilityProtocol.js';
import { electronSecurityUtilityPort } from '../../platform/native/electron-main/electronSecurityUtilityPort.js';
import { SecurityUtilityLifecycle } from '../../platform/native/electron-main/securityUtilityLifecycle.js';
import {
	SecurityUtilityClient,
	type SecurityUtilityClientFailure
} from '../../platform/native/electron-main/securityUtilityClient.js';
import {
	NativePermissionBroker,
	createBaselineNativePermissionAdapters,
	type NativeMediaPermissionCapability,
	type NativeMediaPermissionServices,
	type NativePermissionCapability,
	type NativePermissionFact,
	type NativePermissionPreflightReceipt,
	type NativePermissionPreflightSeal
} from '../../platform/native/electron-main/nativePermissionBroker.js';

declare const __PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__: string;
declare const __PRCTR_ALLOW_UNSIGNED_SECURITY_UTILITY_NATIVE__: boolean;
declare const __PRCTR_SECURITY_UTILITY_TEST_DIAGNOSTICS__: boolean;

const UTILITY_ENTRYPOINT = fileURLToPath(new URL('./security-utility.js', import.meta.url));

export interface LaunchSecurityUtilityOptions {
	readonly participationGeneration: string;
	readonly collectionSessionId: string;
	readonly queueCapacity: number;
	readonly selectedSources: readonly NativeSourceId[];
	readonly selectedSourceCategories: readonly NativeSourceCategory[];
	readonly initialCandidateWindow: CandidateWindowState;
	readonly onPoll: (poll: NativeSupervisorPoll) => void;
	readonly onFailure: (failure: SecurityUtilityClientFailure) => void;
}

export interface SecurityUtilityConnection {
	readonly sendCandidateWindowEvent: (event: CandidateWindowHostEvent) => void;
	readonly shutdown: (
		finalCandidateWindow: CandidateWindowState
	) => Promise<NativeSupervisorStop>;
}

export interface NativePermissionPreflightSelection {
	readonly selectedSources: readonly NativeSourceId[];
	readonly selectedSourceCategories: readonly NativeSourceCategory[];
}

export type NativeSecurityCompositionErrorCode =
	| 'permission_preflight_active'
	| 'permission_preflight_not_sealed'
	| 'permission_preflight_scope_mismatch'
	| 'security_utility_active'
	| 'security_utility_not_active';

export class NativeSecurityCompositionError extends Error {
	public readonly code: NativeSecurityCompositionErrorCode;

	public constructor(code: NativeSecurityCompositionErrorCode) {
		super(`native security composition failed: ${code}`);
		this.name = 'NativeSecurityCompositionError';
		this.code = code;
	}
}

export interface NativeSecurityComposition {
	readonly inspectPermissionPreflight: (
		selection: NativePermissionPreflightSelection
	) => Promise<NativePermissionPreflightReceipt>;
	readonly requestPermissionDuringPreflight: (
		capability: NativePermissionCapability
	) => Promise<NativePermissionFact>;
	readonly sealPermissionPreflight: (
		selection: NativePermissionPreflightSelection
	) => Promise<NativePermissionPreflightReceipt>;
	readonly cancelPermissionPreflight: () => void;
	readonly launchSecurityUtility: (options: LaunchSecurityUtilityOptions) => Promise<{
		readonly connection: SecurityUtilityConnection;
		readonly ready: SecurityUtilityReady;
	}>;
}

export function createNativeSecurityComposition(): NativeSecurityComposition {
	const composition = new ElectronMainNativeSecurityComposition();
	return Object.freeze({
		inspectPermissionPreflight: (selection: NativePermissionPreflightSelection) =>
			composition.inspectPermissionPreflight(selection),
		requestPermissionDuringPreflight: (capability: NativePermissionCapability) =>
			composition.requestPermissionDuringPreflight(capability),
		sealPermissionPreflight: (selection: NativePermissionPreflightSelection) =>
			composition.sealPermissionPreflight(selection),
		cancelPermissionPreflight: () => composition.cancelPermissionPreflight(),
		launchSecurityUtility: (options: LaunchSecurityUtilityOptions) =>
			composition.launchSecurityUtility(options)
	});
}

class ElectronMainNativeSecurityComposition {
	readonly #permissionBroker = new NativePermissionBroker({
		adapters: createBaselineNativePermissionAdapters(
			currentPlatformFamily(),
			createElectronMediaPermissionServices()
		)
	});
	#permissionSeal: NativePermissionPreflightSeal | undefined;
	#permissionSelection: NativePermissionPreflightSelection | undefined;
	readonly #utilityLifecycle = new SecurityUtilityLifecycle();

	public async inspectPermissionPreflight(
		selection: NativePermissionPreflightSelection
	): Promise<NativePermissionPreflightReceipt> {
		const normalized = this.#normalizePermissionSelection(selection);
		const receipt = await this.#permissionBroker.inspectPreflight(
			permissionCapabilities(normalized)
		);
		this.#permissionSelection ??= normalized;
		return receipt;
	}

	public requestPermissionDuringPreflight(
		capability: NativePermissionCapability
	): Promise<NativePermissionFact> {
		return this.#permissionBroker.requestDuringPreflight(capability);
	}

	public async sealPermissionPreflight(
		selection: NativePermissionPreflightSelection
	): Promise<NativePermissionPreflightReceipt> {
		const normalized = this.#normalizePermissionSelection(selection);
		const sealed = await this.#permissionBroker.sealPreflight(
			permissionCapabilities(normalized)
		);
		this.#permissionSelection ??= normalized;
		this.#permissionSeal = sealed.seal;
		return sealed.receipt;
	}

	public cancelPermissionPreflight(): void {
		if (this.#utilityLifecycle.state !== 'idle') {
			throw new NativeSecurityCompositionError('permission_preflight_active');
		}
		if (this.#permissionSeal !== undefined) {
			this.#releasePermissionSeal();
			return;
		}
		this.#permissionBroker.cancelPreflight();
		this.#permissionSelection = undefined;
	}

	public async launchSecurityUtility(options: LaunchSecurityUtilityOptions): Promise<{
		readonly connection: SecurityUtilityConnection;
		readonly ready: SecurityUtilityReady;
	}> {
		if (this.#permissionSeal === undefined) {
			throw new NativeSecurityCompositionError('permission_preflight_not_sealed');
		}
		const permissionSelection = this.#permissionSelection;
		if (
			permissionSelection === undefined ||
			!samePermissionSelection(permissionSelection, options)
		) {
			throw new NativeSecurityCompositionError('permission_preflight_scope_mismatch');
		}
		const launchGeneration = this.#utilityLifecycle.beginLaunch();
		if (launchGeneration === undefined) {
			throw new NativeSecurityCompositionError('security_utility_active');
		}
		try {
			const launched = await launchSecurityUtilityProcess({
				...options,
				selectedSources: permissionSelection.selectedSources,
				selectedSourceCategories: permissionSelection.selectedSourceCategories,
				onFailure: (failure) => {
					this.#utilityLifecycle.fail(launchGeneration);
					options.onFailure(failure);
				}
			});
			if (!this.#utilityLifecycle.activate(launchGeneration)) {
				launched.abort();
				throw new NativeSecurityCompositionError('security_utility_not_active');
			}
			const connection = launched.connection;
			return Object.freeze({
				ready: launched.ready,
				connection: Object.freeze({
					sendCandidateWindowEvent: (event: CandidateWindowHostEvent) => {
						this.#assertUtilityActive(launchGeneration);
						connection.sendCandidateWindowEvent(event);
					},
					shutdown: (finalCandidateWindow: CandidateWindowState) =>
						this.#shutdownNormally(connection, finalCandidateWindow, launchGeneration)
				})
			});
		} catch (error) {
			this.#utilityLifecycle.fail(launchGeneration);
			throw error;
		}
	}

	async #shutdownNormally(
		connection: SecurityUtilityConnection,
		finalCandidateWindow: CandidateWindowState,
		launchGeneration: number
	): Promise<NativeSupervisorStop> {
		if (!this.#utilityLifecycle.beginStopping(launchGeneration)) {
			throw new NativeSecurityCompositionError('security_utility_not_active');
		}
		try {
			const stopped = await connection.shutdown(finalCandidateWindow);
			if (!this.#utilityLifecycle.completeStop(launchGeneration)) {
				throw new NativeSecurityCompositionError('security_utility_not_active');
			}
			this.#releasePermissionSeal();
			return stopped;
		} catch (error) {
			this.#utilityLifecycle.fail(launchGeneration);
			throw error;
		}
	}

	#assertUtilityActive(launchGeneration: number): void {
		if (!this.#utilityLifecycle.isActive(launchGeneration)) {
			throw new NativeSecurityCompositionError('security_utility_not_active');
		}
	}

	#releasePermissionSeal(): void {
		if (this.#permissionSeal === undefined) {
			throw new Error('native permission preflight is not sealed');
		}
		const seal = this.#permissionSeal;
		this.#permissionBroker.releasePreflightSeal(seal);
		this.#permissionSeal = undefined;
		this.#permissionSelection = undefined;
	}

	#normalizePermissionSelection(
		selection: NativePermissionPreflightSelection
	): NativePermissionPreflightSelection {
		if (
			!isSelectedNativeSources(selection.selectedSources) ||
			!isSelectedSourceCategories(
				selection.selectedSourceCategories,
				selection.selectedSources
			)
		) {
			throw new NativeSecurityCompositionError('permission_preflight_scope_mismatch');
		}
		const normalized = Object.freeze({
			selectedSources: Object.freeze([...selection.selectedSources]),
			selectedSourceCategories: Object.freeze([...selection.selectedSourceCategories])
		});
		if (
			this.#permissionSelection !== undefined &&
			!samePermissionSelection(this.#permissionSelection, normalized)
		) {
			throw new NativeSecurityCompositionError('permission_preflight_scope_mismatch');
		}
		return this.#permissionSelection ?? normalized;
	}
}

function permissionCapabilities(
	selection: NativePermissionPreflightSelection
): readonly NativePermissionCapability[] {
	const capabilities = BASELINE_PERMISSION_ORDER.filter((capability) => {
		if (capability === 'camera' || capability === 'microphone') {
			return selection.selectedSourceCategories.includes(capability);
		}
		return selection.selectedSources.includes(capability);
	});
	return Object.freeze(capabilities);
}

const BASELINE_PERMISSION_ORDER = [
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
] as const satisfies readonly NativePermissionCapability[];

function samePermissionSelection(
	left: NativePermissionPreflightSelection,
	right: NativePermissionPreflightSelection
): boolean {
	return (
		left.selectedSources.length === right.selectedSources.length &&
		left.selectedSources.every((source, index) => right.selectedSources[index] === source) &&
		left.selectedSourceCategories.length === right.selectedSourceCategories.length &&
		left.selectedSourceCategories.every(
			(category, index) => right.selectedSourceCategories[index] === category
		)
	);
}

class SecurityUtilityProcessConnection implements SecurityUtilityConnection {
	readonly #child: UtilityProcess;
	readonly #client: SecurityUtilityClient;
	#stopped = false;

	public constructor(child: UtilityProcess, client: SecurityUtilityClient) {
		this.#child = child;
		this.#client = client;
	}

	public sendCandidateWindowEvent(event: CandidateWindowHostEvent): void {
		this.#client.sendCandidateWindowEvent(event);
	}

	public async shutdown(
		finalCandidateWindow: CandidateWindowState
	): Promise<NativeSupervisorStop> {
		const result = await this.#client.shutdown(finalCandidateWindow);
		this.#stopped = true;
		return result;
	}

	public processExited(): void {
		if (!this.#stopped) this.#client.abort('process_exit');
	}

	public processErrored(): void {
		this.#client.abort('process_error');
	}

	public killAfterFailure(): void {
		if (!this.#stopped) this.#child.kill();
	}
}

async function launchSecurityUtilityProcess(options: LaunchSecurityUtilityOptions): Promise<{
	readonly abort: () => void;
	readonly connection: SecurityUtilityConnection;
	readonly ready: SecurityUtilityReady;
}> {
	const startupDeadline = performance.now() + SECURITY_UTILITY_STARTUP_TIMEOUT_MS;
	const child = utilityProcess.fork(UTILITY_ENTRYPOINT, [], {
		allowLoadingUnsignedLibraries: __PRCTR_ALLOW_UNSIGNED_SECURITY_UTILITY_NATIVE__,
		cwd: dirname(UTILITY_ENTRYPOINT),
		env: {},
		execArgv: [],
		serviceName: 'Proctor Exam Security',
		stdio: __PRCTR_SECURITY_UTILITY_TEST_DIAGNOSTICS__ ? 'inherit' : 'ignore'
	});
	const channel = new MessageChannelMain();
	let connection: SecurityUtilityProcessConnection | undefined;
	const client = new SecurityUtilityClient({
		port: electronSecurityUtilityPort(channel.port1),
		challenge: randomBytes(32).toString('base64url'),
		buildIdentity: __PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__,
		participationGeneration: options.participationGeneration,
		collectionSessionId: options.collectionSessionId,
		queueCapacity: options.queueCapacity,
		selectedSources: options.selectedSources,
		selectedSourceCategories: options.selectedSourceCategories,
		initialCandidateWindow: options.initialCandidateWindow,
		onPoll: options.onPoll,
		onFailure: (failure) => {
			connection?.killAfterFailure();
			options.onFailure(failure);
		}
	});
	connection = new SecurityUtilityProcessConnection(child, client);
	child.on('error', () => connection?.processErrored());
	child.on('exit', () => connection?.processExited());
	try {
		await waitForSpawn(child, startupDeadline);
		child.postMessage({ kind: 'security-utility-port', protocol_version: 1 }, [channel.port2]);
		const ready = await client.start(remainingStartupTimeout(startupDeadline));
		const processConnection = connection;
		const publicConnection: SecurityUtilityConnection = Object.freeze({
			sendCandidateWindowEvent: (event: CandidateWindowHostEvent) => {
				processConnection.sendCandidateWindowEvent(event);
			},
			shutdown: (finalCandidateWindow: CandidateWindowState) => {
				return processConnection.shutdown(finalCandidateWindow);
			}
		});
		return {
			abort: () => {
				processConnection.killAfterFailure();
				client.abort('process_error');
			},
			connection: publicConnection,
			ready
		};
	} catch (error) {
		client.abort('process_error');
		throw error;
	}
}

function waitForSpawn(child: UtilityProcess, startupDeadline: number): Promise<void> {
	const timeoutMs = remainingStartupTimeout(startupDeadline);
	if (child.pid !== undefined) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => finish(new Error('security utility spawn timed out')),
			timeoutMs
		);
		const spawned = (): void => finish();
		const exited = (): void => finish(new Error('security utility exited before spawn'));
		const errored = (): void => finish(new Error('security utility failed before spawn'));
		const finish = (error?: Error): void => {
			clearTimeout(timer);
			child.off('spawn', spawned);
			child.off('exit', exited);
			child.off('error', errored);
			if (error === undefined) resolve();
			else reject(error);
		};
		child.once('spawn', spawned);
		child.once('exit', exited);
		child.once('error', errored);
	});
}

function remainingStartupTimeout(startupDeadline: number): number {
	const remaining = Math.floor(startupDeadline - performance.now());
	if (!Number.isSafeInteger(remaining) || remaining <= 0) {
		throw new Error('security utility startup timed out');
	}
	return Math.min(remaining, SECURITY_UTILITY_STARTUP_TIMEOUT_MS);
}

function currentPlatformFamily(): PlatformFamily {
	if (process.platform === 'darwin') return 'macos';
	if (process.platform === 'win32') return 'windows';
	if (process.platform === 'linux') return 'linux';
	throw new Error(`unsupported Electron platform: ${process.platform}`);
}

function createElectronMediaPermissionServices(): NativeMediaPermissionServices | undefined {
	if (process.platform !== 'darwin' && process.platform !== 'win32') return undefined;
	return Object.freeze({
		inspect: (capability: NativeMediaPermissionCapability) =>
			electronMediaPermissionState(systemPreferences.getMediaAccessStatus(capability)),
		...(process.platform === 'darwin'
			? {
					requestDuringPreflight: async (capability: NativeMediaPermissionCapability) => {
						const granted = await systemPreferences.askForMediaAccess(capability);
						if (granted) return 'granted' as const;
						return electronMediaPermissionState(
							systemPreferences.getMediaAccessStatus(capability)
						);
					}
				}
			: {})
	});
}

function electronMediaPermissionState(
	status: ReturnType<typeof systemPreferences.getMediaAccessStatus>
): 'not_determined' | 'granted' | 'denied' | 'restricted' | 'unavailable' {
	switch (status) {
		case 'not-determined':
			return 'not_determined';
		case 'granted':
			return 'granted';
		case 'denied':
			return 'denied';
		case 'restricted':
			return 'restricted';
		case 'unknown':
			return 'unavailable';
	}
}
