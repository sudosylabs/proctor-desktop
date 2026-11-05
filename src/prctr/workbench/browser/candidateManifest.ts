/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { composeWorkbench } from '../common/composition.js';
import { commonParts, commonWorkbenchManifest, electronDesktopManifest } from './commonManifest.js';

const candidateWorkbenchManifest = Object.freeze({
	id: 'prctr.workbench.candidate',
	contributions: Object.freeze([
		Object.freeze({
			id: 'prctr.candidate.workspace' as const,
			phase: 'ready' as const,
			dependencies: Object.freeze(['prctr.workbench.desktop' as const])
		}),
		Object.freeze({
			id: 'prctr.candidate.integratedBrowser' as const,
			phase: 'ready' as const,
			dependencies: Object.freeze(['prctr.workbench.desktop' as const])
		}),
		Object.freeze({
			id: 'prctr.candidate.examSecurity' as const,
			phase: 'starting' as const,
			blocksPhase: true,
			dependencies: Object.freeze(['prctr.workbench.desktop' as const])
		})
	]),
	itemTypes: Object.freeze([
		'prctr.workspace.file',
		'prctr.examResource',
		'prctr.integratedBrowser'
	]),
	destinations: Object.freeze(['workspace', 'examMaterials'])
});

export const candidateComposition = composeWorkbench(
	'prctr.candidateWindow',
	'candidate',
	[commonWorkbenchManifest, electronDesktopManifest, candidateWorkbenchManifest],
	{
		parts: Object.freeze([...commonParts, 'panel']),
		maxContentGroups: 2,
		allowHorizontalSplit: true,
		allowVerticalSplit: true,
		sidebarInitiallyVisible: true,
		allowRegionResize: true,
		panelInitiallyVisible: true
	},
	{ entrypointRestorable: false, scope: 'attemptPresentation', restoreItems: true }
);
