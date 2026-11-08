/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from '../platform/instantiation/common/descriptors.js';
import { Disposable } from '../base/common/lifecycle.js';
import { PresentationCategoryRegistry } from './common/restoration.js';
import type { WorkbenchContributionRegistration } from './browser/bootstrap.js';
import { WorkbenchKernelContribution } from './browser/workbenchKernel.js';
import { IWorkbenchWindowService } from './browser/workbenchServices.js';

/** Registers the composition's presentation category for later restoration. */
class WorkbenchRestorationContribution extends Disposable {
	readonly categories = new PresentationCategoryRegistry();

	constructor(@IWorkbenchWindowService window: IWorkbenchWindowService) {
		super();
		const composition = window.composition;
		this.categories.register({
			id: composition.id.replaceAll(':', '.').toLowerCase(),
			scope: composition.restoration.scope,
			sensitivity: 'nonSensitive',
			cleanupOwner: 'prctr.workbench'
		});
	}
}

export const commonWorkbenchContributions: readonly WorkbenchContributionRegistration[] =
	Object.freeze([
		Object.freeze({
			id: 'prctr.workbench.kernel' as const,
			phase: 'starting' as const,
			blocksPhase: true,
			descriptor: new SyncDescriptor(WorkbenchKernelContribution)
		}),
		Object.freeze({
			id: 'prctr.workbench.restoration' as const,
			phase: 'restored' as const,
			dependencies: Object.freeze(['prctr.workbench.kernel' as const]),
			descriptor: new SyncDescriptor(WorkbenchRestorationContribution)
		})
	]);
