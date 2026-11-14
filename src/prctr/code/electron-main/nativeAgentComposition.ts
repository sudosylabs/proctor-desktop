/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	NativeAgentService,
	type INativeAgentService
} from '../../platform/native/electron-main/nativeAgentService.js';
import type { NativeAgentVerifier } from '../../platform/native/node/nativeAgentConnection.js';

export {
	NativeAgentRefusedError,
	NativeAgentStateError,
	type NativeAgentPhase,
	type NativeAgentSnapshot
} from '../../platform/native/electron-main/nativeAgentService.js';

export interface NativeAgentCompositionOptions {
	/** Absolute path of the packaged agent binary; never resolved through PATH. */
	readonly executable: string;
	readonly buildIdentity: string;
	/** Release compositions pass a signature-checking verifier; development passes the unsigned one. */
	readonly verifier: NativeAgentVerifier;
}

/** Composes the native agent service. The returned owner must be disposed on exit. */
export function createNativeAgentComposition(
	options: NativeAgentCompositionOptions
): INativeAgentService {
	return new NativeAgentService({ launch: options });
}
