/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { MessageDescriptor } from '../../../../base/common/localization.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { WorkbenchContributionRegistration } from '../../../browser/bootstrap.js';
import { IAuthenticatedHostService } from '../../../services/authenticatedHost/common/authenticatedHost.js';
import { ExamActivityContribution } from '../../examActivity/browser/examActivityContribution.js';
import { examActivityMessages } from '../../examActivity/browser/examActivityMessages.js';
import { authenticatedMessages } from './authenticatedMessages.js';
import { IAuthenticatedNavigationService } from './authenticatedNavigation.js';

/** Creates the window's frame and, when the window has them, its product pages. */
class AuthenticatedContribution extends Disposable {
	constructor(
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService,
		@IAuthenticatedHostService host: IAuthenticatedHostService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		if (host.hasProductPages) {
			this._register(instantiationService.createInstance(ExamActivityContribution));
		}
	}
}

/** AuthenticatedWindow's frame and navigation; product contributions depend on it. */
export const authenticatedContribution: WorkbenchContributionRegistration = Object.freeze({
	id: 'prctr.authenticated.navigation' as const,
	phase: 'ready' as const,
	dependencies: Object.freeze(['prctr.workbench.desktop' as const]),
	messages: Object.freeze([
		...Object.values(authenticatedMessages),
		...Object.values(examActivityMessages)
	] as MessageDescriptor[]),
	descriptor: new SyncDescriptor(AuthenticatedContribution)
});
