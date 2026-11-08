/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import type { MessageDescriptor } from '../../../base/common/localization.js';
import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { IAuthenticatedNavigationService } from '../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import type { WorkbenchContributionRegistration } from '../bootstrap.js';
import { authenticatedMessages } from './authenticatedMessages.js';

/**
 * Creates the window's frame. The frame is the window's navigation service, so asking
 * for it builds the rail, sidebar and top bar before any destination is shown.
 */
class AuthenticatedFrameContribution extends Disposable {
	constructor(@IAuthenticatedNavigationService _navigation: IAuthenticatedNavigationService) {
		super();
	}
}

/** AuthenticatedWindow's frame and navigation; product contributions depend on it. */
export const authenticatedFrameContribution: WorkbenchContributionRegistration = Object.freeze({
	id: 'prctr.authenticated.navigation' as const,
	phase: 'ready' as const,
	dependencies: Object.freeze(['prctr.workbench.desktop' as const]),
	messages: Object.freeze(Object.values(authenticatedMessages) as MessageDescriptor[]),
	descriptor: new SyncDescriptor(AuthenticatedFrameContribution)
});
