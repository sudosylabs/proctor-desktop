/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { composeWorkbench } from '../common/composition.js';
import { commonParts, commonWorkbenchManifest, electronDesktopManifest } from './commonManifest.js';

const authenticatedWorkbenchManifest = Object.freeze({
	id: 'prctr.workbench.authenticated',
	contributions: Object.freeze([
		Object.freeze({
			id: 'prctr.authenticated.account' as const,
			phase: 'ready' as const,
			dependencies: Object.freeze(['prctr.authenticated.navigation' as const])
		}),
		Object.freeze({
			id: 'prctr.authenticated.navigation' as const,
			phase: 'ready' as const,
			dependencies: Object.freeze(['prctr.workbench.desktop' as const])
		}),
		Object.freeze({
			id: 'prctr.authenticated.settings' as const,
			phase: 'ready' as const,
			dependencies: Object.freeze(['prctr.authenticated.navigation' as const])
		})
	]),
	itemTypes: Object.freeze([
		'prctr.authenticated.page',
		'prctr.authenticated.account',
		'prctr.authenticated.exams'
	]),
	destinations: Object.freeze(['activity', 'management', 'administration', 'account', 'settings'])
});

export const authenticatedComposition = composeWorkbench(
	'prctr.authenticatedWindow',
	'authenticated',
	[commonWorkbenchManifest, electronDesktopManifest, authenticatedWorkbenchManifest],
	{
		parts: Object.freeze(commonParts.filter((part) => part !== 'status')),
		maxContentGroups: 1,
		allowHorizontalSplit: false,
		allowVerticalSplit: false,
		sidebarInitiallyVisible: true,
		allowRegionResize: false,
		panelInitiallyVisible: false
	},
	{ entrypointRestorable: true, scope: 'principalComposition', restoreItems: true }
);
