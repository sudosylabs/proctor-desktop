/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { WorkbenchContentModel } from './common/contentGroups.js';
import { PresentationCategoryRegistry } from './common/restoration.js';
import type { WorkbenchBootstrapContext, WorkbenchContributionRegistration } from './browser/bootstrap.js';
import { WorkbenchPaneHost } from './browser/paneHost.js';
import { activateWorkbenchKernel } from './browser/workbenchKernel.js';
import { WorkbenchItemResolverRegistry } from './browser/workbenchPane.js';

export const WORKBENCH_CONTENT_MODEL = 'prctr.workbench.service.contentModel';
export const WORKBENCH_PRESENTATION_CATEGORIES = 'prctr.workbench.service.presentationCategories';
export const WORKBENCH_ITEM_RESOLVERS = 'prctr.workbench.service.itemResolvers';
export const WORKBENCH_PANE_HOST = 'prctr.workbench.service.paneHost';

export const commonWorkbenchContributions: readonly WorkbenchContributionRegistration[] = Object.freeze([
	Object.freeze({ id: 'prctr.workbench.kernel' as const, phase: 'starting' as const, blocksPhase: true, activate: (context: WorkbenchBootstrapContext) => { activateWorkbenchKernel(context); const model = context.disposables.add(new WorkbenchContentModel(context.composition.layout.maxContentGroups, new Set([...(context.composition.layout.allowHorizontalSplit ? ['horizontal' as const] : []), ...(context.composition.layout.allowVerticalSplit ? ['vertical' as const] : [])]))); const resolvers = new WorkbenchItemResolverRegistry(); const paneHost = context.disposables.add(new WorkbenchPaneHost(context.shell.part('content'), resolvers)); context.setService(WORKBENCH_CONTENT_MODEL, model); context.setService(WORKBENCH_ITEM_RESOLVERS, resolvers); context.setService(WORKBENCH_PANE_HOST, paneHost); context.shell.layout(); } }),
	Object.freeze({ id: 'prctr.workbench.restoration' as const, phase: 'restored' as const, dependencies: Object.freeze(['prctr.workbench.kernel' as const]), activate: (context: WorkbenchBootstrapContext) => { const categories = new PresentationCategoryRegistry(); categories.register({ id: context.composition.id.replaceAll(':', '.').toLowerCase(), scope: context.composition.restoration.scope, schemaVersion: 1, sensitivity: 'nonSensitive', cleanupOwner: 'prctr.workbench' }); context.setService(WORKBENCH_PRESENTATION_CATEGORIES, categories); } })
]);
