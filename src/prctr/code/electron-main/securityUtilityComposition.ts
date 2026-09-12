/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { app, systemPreferences } from 'electron';
import { SyncDescriptor } from '../../platform/instantiation/common/descriptors.js';
import { InstantiationService } from '../../platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import type { PlatformFamily } from '../../platform/native/common/nativeObservation.generated.js';
import { ElectronSecurityUtilityProcessService } from '../../platform/native/electron-main/electronSecurityUtilityProcessService.js';
import {
	ISecurityUtilityProcessService,
	type INativeSecurityService
} from '../../platform/native/electron-main/nativeSecurity.js';
import { NativeSecurityService } from '../../platform/native/electron-main/nativeSecurityService.js';
import {
	INativeServiceRegistration,
	NativeServiceRegistration
} from '../../platform/native/electron-main/nativeServiceRegistration.js';
import {
	ISecurityUtilityLifecycle,
	SecurityUtilityLifecycle
} from '../../platform/native/electron-main/securityUtilityLifecycle.js';
import {
	INativePermissionBroker,
	NativePermissionBroker,
	createBaselineNativePermissionAdapters,
	type NativeMediaPermissionCapability,
	type NativeMediaPermissionServices
} from '../../platform/native/electron-main/nativePermissionBroker.js';

export { NativeSecurityCompositionError } from '../../platform/native/electron-main/nativeSecurity.js';
export type {
	LaunchSecurityUtilityOptions,
	SecurityUtilityConnection,
	NativePermissionPreflightSelection,
	NativeSecurityCompositionErrorCode
} from '../../platform/native/electron-main/nativeSecurity.js';
export type NativeSecurityComposition = INativeSecurityService;

declare const __PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__: string;
declare const __PRCTR_ALLOW_UNSIGNED_SECURITY_UTILITY_NATIVE__: boolean;
declare const __PRCTR_SECURITY_UTILITY_TEST_DIAGNOSTICS__: boolean;
const UTILITY_ENTRYPOINT = fileURLToPath(new URL('./security-utility.js', import.meta.url));

export interface NativeSecurityCompositionOptions {
	/** Main-owned lifecycle guard; renderer state is never an authorization source. */
	readonly isParticipationOrCandidateActive: () => boolean;
}

/** Composes one isolated native service graph. The returned owner must be disposed on exit. */
export function createNativeSecurityComposition(
	options: NativeSecurityCompositionOptions
): NativeSecurityComposition {
	const services = new ServiceCollection();
	let composition: NativeSecurityService | undefined;
	services.set(
		INativeServiceRegistration,
		new SyncDescriptor(NativeServiceRegistration, [
			{
				app,
				platform: process.platform,
				darwinMajor: Number(release().split('.')[0]),
				isSetupBlocked: () =>
					options.isParticipationOrCandidateActive() ||
					composition === undefined ||
					composition.isServiceSetupBlocked()
			}
		])
	);
	services.set(
		INativePermissionBroker,
		new SyncDescriptor(NativePermissionBroker, [
			{
				adapters: createBaselineNativePermissionAdapters(
					currentPlatformFamily(),
					createElectronMediaPermissionServices()
				)
			}
		])
	);
	services.set(ISecurityUtilityLifecycle, new SyncDescriptor(SecurityUtilityLifecycle));
	services.set(
		ISecurityUtilityProcessService,
		new SyncDescriptor(ElectronSecurityUtilityProcessService, [
			{
				entrypoint: UTILITY_ENTRYPOINT,
				buildIdentity: __PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__,
				allowUnsignedLibraries: __PRCTR_ALLOW_UNSIGNED_SECURITY_UTILITY_NATIVE__,
				testDiagnostics: __PRCTR_SECURITY_UTILITY_TEST_DIAGNOSTICS__
			}
		])
	);
	const instantiation = new InstantiationService(services, true);
	try {
		// createInstance consumers are caller-owned; the service owns this dedicated graph.
		composition = instantiation.createInstance(NativeSecurityService);
		return composition;
	} catch (error) {
		instantiation.dispose();
		throw error;
	}
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
