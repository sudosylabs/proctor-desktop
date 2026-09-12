/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import type {
	CandidateWindowHostEvent,
	CandidateWindowState
} from '../common/nativeObservation.generated.js';
import {
	isSelectedNativeSources,
	isSelectedSourceCategories,
	type NativeSupervisorStop,
	type SecurityUtilityReady
} from '../common/securityUtilityProtocol.js';
import {
	INativePermissionBroker,
	type NativePermissionCapability,
	type NativePermissionFact,
	type NativePermissionPreflightReceipt,
	type NativePermissionPreflightSeal
} from './nativePermissionBroker.js';
import {
	INativeServiceRegistration,
	type NativeServiceRegistrationStatus
} from './nativeServiceRegistration.js';
import { ISecurityUtilityLifecycle } from './securityUtilityLifecycle.js';
import {
	ISecurityUtilityProcessService,
	NativeSecurityCompositionError,
	type INativeSecurityService,
	type LaunchSecurityUtilityOptions,
	type NativePermissionPreflightSelection,
	type SecurityUtilityConnection
} from './nativeSecurity.js';

/** Coordinates sealed permissions and utility generations; OS adapters remain injected services. */
export class NativeSecurityService extends Disposable implements INativeSecurityService {
	declare readonly _serviceBrand: undefined;
	private disposed = false;
	private activeAbort: (() => void) | undefined;
	private readonly cancellation = this._register(new CancellationTokenSource());
	#preflightOperations = 0;

	public constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@INativeServiceRegistration
		private readonly serviceRegistration: INativeServiceRegistration,
		@INativePermissionBroker private readonly permissionBroker: INativePermissionBroker,
		@ISecurityUtilityLifecycle private readonly utilityLifecycle: ISecurityUtilityLifecycle,
		@ISecurityUtilityProcessService
		private readonly processService: ISecurityUtilityProcessService
	) {
		super();
		// This consumer owns its dedicated graph; it is not a container-owned singleton.
		this._register(instantiationService);
	}

	public isServiceSetupBlocked(): boolean {
		return (
			this.disposed ||
			this.utilityLifecycle.state !== 'idle' ||
			this.#permissionSelection !== undefined ||
			this.#permissionSeal !== undefined ||
			this.#preflightOperations !== 0
		);
	}

	public inspectServiceRegistration(): NativeServiceRegistrationStatus {
		this.assertNotDisposed();
		return this.serviceRegistration.inspect();
	}
	public registerServiceDuringSetup(): NativeServiceRegistrationStatus {
		this.assertNotDisposed();
		return this.serviceRegistration.registerDuringSetup();
	}
	public unregisterServiceDuringSetup(): NativeServiceRegistrationStatus {
		this.assertNotDisposed();
		return this.serviceRegistration.unregisterDuringSetup();
	}

	public override dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		try {
			try {
				this.cancellation.cancel();
			} finally {
				this.activeAbort?.();
				this.activeAbort = undefined;
			}
		} finally {
			super.dispose();
		}
	}

	private assertNotDisposed(): void {
		if (this.disposed) throw new NativeSecurityCompositionError('disposed');
	}

	async #duringPreflight<T>(operation: () => Promise<T>): Promise<T> {
		this.assertNotDisposed();
		this.#preflightOperations++;
		try {
			const result = await operation();
			this.assertNotDisposed();
			return result;
		} finally {
			this.#preflightOperations--;
		}
	}

	#permissionSeal: NativePermissionPreflightSeal | undefined;
	#permissionSelection: NativePermissionPreflightSelection | undefined;

	public async inspectPermissionPreflight(
		selection: NativePermissionPreflightSelection
	): Promise<NativePermissionPreflightReceipt> {
		const normalized = this.#normalizePermissionSelection(selection);
		return this.#duringPreflight(async () => {
			const receipt = await this.permissionBroker.inspectPreflight(
				permissionCapabilities(normalized)
			);
			this.#permissionSelection ??= normalized;
			return receipt;
		});
	}

	public requestPermissionDuringPreflight(
		capability: NativePermissionCapability
	): Promise<NativePermissionFact> {
		return this.#duringPreflight(() =>
			this.permissionBroker.requestDuringPreflight(capability)
		);
	}

	public async sealPermissionPreflight(
		selection: NativePermissionPreflightSelection
	): Promise<NativePermissionPreflightReceipt> {
		const normalized = this.#normalizePermissionSelection(selection);
		return this.#duringPreflight(async () => {
			const sealed = await this.permissionBroker.sealPreflight(
				permissionCapabilities(normalized)
			);
			this.#permissionSelection ??= normalized;
			this.#permissionSeal = sealed.seal;
			return sealed.receipt;
		});
	}

	public cancelPermissionPreflight(): void {
		this.assertNotDisposed();
		if (this.utilityLifecycle.state !== 'idle') {
			throw new NativeSecurityCompositionError('permission_preflight_active');
		}
		if (this.#permissionSeal !== undefined) {
			this.#releasePermissionSeal();
			return;
		}
		this.permissionBroker.cancelPreflight();
		this.#permissionSelection = undefined;
	}

	public async launchSecurityUtility(options: LaunchSecurityUtilityOptions): Promise<{
		readonly connection: SecurityUtilityConnection;
		readonly ready: SecurityUtilityReady;
	}> {
		this.assertNotDisposed();
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
		const launchGeneration = this.utilityLifecycle.beginLaunch();
		if (launchGeneration === undefined) {
			throw new NativeSecurityCompositionError('security_utility_active');
		}
		try {
			const launched = await this.processService.launch(
				{
					...options,
					selectedSources: permissionSelection.selectedSources,
					selectedSourceCategories: permissionSelection.selectedSourceCategories,
					onFailure: (failure) => {
						this.utilityLifecycle.fail(launchGeneration);
						options.onFailure(failure);
					}
				},
				this.cancellation.token
			);
			if (this.disposed) {
				launched.abort();
				throw new NativeSecurityCompositionError('disposed');
			}
			this.activeAbort = launched.abort;
			if (!this.utilityLifecycle.activate(launchGeneration)) {
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
			this.utilityLifecycle.fail(launchGeneration);
			throw error;
		}
	}

	async #shutdownNormally(
		connection: SecurityUtilityConnection,
		finalCandidateWindow: CandidateWindowState,
		launchGeneration: number
	): Promise<NativeSupervisorStop> {
		this.assertNotDisposed();
		if (!this.utilityLifecycle.beginStopping(launchGeneration)) {
			throw new NativeSecurityCompositionError('security_utility_not_active');
		}
		try {
			const stopped = await connection.shutdown(finalCandidateWindow);
			this.assertNotDisposed();
			if (!this.utilityLifecycle.completeStop(launchGeneration)) {
				throw new NativeSecurityCompositionError('security_utility_not_active');
			}
			this.#releasePermissionSeal();
			this.activeAbort = undefined;
			return stopped;
		} catch (error) {
			this.utilityLifecycle.fail(launchGeneration);
			throw error;
		}
	}

	#assertUtilityActive(launchGeneration: number): void {
		this.assertNotDisposed();
		if (!this.utilityLifecycle.isActive(launchGeneration)) {
			throw new NativeSecurityCompositionError('security_utility_not_active');
		}
	}

	#releasePermissionSeal(): void {
		if (this.#permissionSeal === undefined) {
			throw new Error('native permission preflight is not sealed');
		}
		const seal = this.#permissionSeal;
		this.permissionBroker.releasePreflightSeal(seal);
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
