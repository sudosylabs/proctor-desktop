/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { CancellationToken } from '../../../base/common/cancellation.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import type {
	CandidateWindowHostEvent,
	CandidateWindowState
} from '../common/nativeObservation.generated.js';
import type {
	NativeSupervisorPoll,
	NativeSupervisorStop,
	NativeSourceId,
	NativeSourceCategory,
	SecurityUtilityReady
} from '../common/securityUtilityProtocol.js';
import type { SecurityUtilityClientFailure } from './securityUtilityClient.js';
import type {
	NativePermissionCapability,
	NativePermissionFact,
	NativePermissionPreflightReceipt
} from './nativePermissionBroker.js';
import type { NativeServiceRegistrationStatus } from './nativeServiceRegistration.js';

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
	| 'security_utility_not_active'
	| 'disposed';

export class NativeSecurityCompositionError extends Error {
	public readonly code: NativeSecurityCompositionErrorCode;

	public constructor(code: NativeSecurityCompositionErrorCode) {
		super(`native security composition failed: ${code}`);
		this.name = 'NativeSecurityCompositionError';
		this.code = code;
	}
}

export const INativeSecurityService =
	createDecorator<INativeSecurityService>('nativeSecurityService');

/** Preflight and utility ownership for one privileged main-process composition. */
export interface INativeSecurityService extends IDisposable {
	readonly _serviceBrand: undefined;
	readonly inspectServiceRegistration: () => NativeServiceRegistrationStatus;
	readonly registerServiceDuringSetup: () => NativeServiceRegistrationStatus;
	readonly unregisterServiceDuringSetup: () => NativeServiceRegistrationStatus;
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

export interface LaunchedSecurityUtility {
	readonly abort: () => void;
	readonly connection: SecurityUtilityConnection;
	readonly ready: SecurityUtilityReady;
}

export const ISecurityUtilityProcessService = createDecorator<ISecurityUtilityProcessService>(
	'securityUtilityProcessService'
);

/** Launches one packaged process; cancellation must close all acquired resources. */
export interface ISecurityUtilityProcessService {
	readonly _serviceBrand: undefined;
	launch(
		options: LaunchSecurityUtilityOptions,
		cancellation: CancellationToken
	): Promise<LaunchedSecurityUtility>;
}
