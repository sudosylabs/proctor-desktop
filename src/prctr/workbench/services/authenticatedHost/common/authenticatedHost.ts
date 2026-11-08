/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IAuthenticatedHostService = createDecorator<IAuthenticatedHostService>(
	'authenticatedHostService'
);

/** AuthenticatedWindow's window-level host capabilities from its preload. */
export interface IAuthenticatedHostService {
	readonly _serviceBrand: undefined;
	/** Whether this window was given the product pages; without them product areas say so. */
	readonly hasProductPages: boolean;
	/** Ends the window's Session through the privileged identity owner. */
	signOut(): Promise<void>;
}

export class AuthenticatedHostService implements IAuthenticatedHostService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly host: { signOut(): Promise<void> },
		readonly hasProductPages: boolean
	) {}

	signOut(): Promise<void> {
		return this.host.signOut();
	}
}
