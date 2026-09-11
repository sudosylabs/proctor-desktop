/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type WorkbenchWindowKind = 'authenticated' | 'candidate' | 'launch';
export type WorkbenchPart =
	'banner' | 'content' | 'navigation' | 'panel' | 'sidebar' | 'status' | 'titlebar';
export type WorkbenchLifecyclePhase = 'eventually' | 'ready' | 'restored' | 'starting';

export interface WorkbenchContributionDescriptor {
	readonly id: `prctr.${string}`;
	readonly phase: WorkbenchLifecyclePhase;
	readonly dependencies?: readonly `prctr.${string}`[];
	readonly blocksPhase?: boolean;
}

export interface WorkbenchCompositionFragment {
	readonly id: string;
	readonly contributions: readonly WorkbenchContributionDescriptor[];
	readonly itemTypes: readonly string[];
	readonly destinations: readonly string[];
}

export interface WorkbenchLayoutPolicy {
	readonly parts: readonly WorkbenchPart[];
	readonly maxContentGroups: number;
	readonly allowRegionResize: boolean;
	readonly allowHorizontalSplit: boolean;
	readonly allowVerticalSplit: boolean;
	readonly sidebarInitiallyVisible: boolean;
	readonly panelInitiallyVisible: boolean;
}

export interface WorkbenchRestorationPolicy {
	readonly entrypointRestorable: boolean;
	readonly scope: 'attemptPresentation' | 'principalComposition' | 'windowSession';
	readonly restoreItems: boolean;
}

export interface WorkbenchComposition {
	readonly id: string;
	readonly windowKind: WorkbenchWindowKind;
	readonly fragments: readonly string[];
	readonly contributions: readonly WorkbenchContributionDescriptor[];
	readonly itemTypes: readonly string[];
	readonly destinations: readonly string[];
	readonly layout: WorkbenchLayoutPolicy;
	readonly restoration: WorkbenchRestorationPolicy;
}

const PHASES: Readonly<Record<WorkbenchLifecyclePhase, number>> = Object.freeze({
	starting: 0,
	ready: 1,
	restored: 2,
	eventually: 3
});

export function lifecyclePhaseOrdinal(phase: WorkbenchLifecyclePhase): number {
	return PHASES[phase];
}

export function composeWorkbench(
	id: string,
	windowKind: WorkbenchWindowKind,
	fragments: readonly WorkbenchCompositionFragment[],
	layout: WorkbenchLayoutPolicy,
	restoration: WorkbenchRestorationPolicy
): WorkbenchComposition {
	if (fragments.length === 0)
		throw new Error('A workbench composition requires at least one static fragment');
	const contributionIds = new Set<string>();
	const itemTypes = new Set<string>();
	const destinations = new Set<string>();
	const contributions: WorkbenchContributionDescriptor[] = [];
	for (const fragment of fragments) {
		for (const contribution of fragment.contributions) {
			if (contributionIds.has(contribution.id))
				throw new Error(`Duplicate workbench contribution ${contribution.id}`);
			contributionIds.add(contribution.id);
			contributions.push(freezeContribution(contribution));
		}
		for (const itemType of fragment.itemTypes) {
			if (itemTypes.has(itemType))
				throw new Error(`Duplicate workbench item type ${itemType}`);
			itemTypes.add(itemType);
		}
		for (const destination of fragment.destinations) {
			if (destinations.has(destination))
				throw new Error(`Duplicate workbench destination ${destination}`);
			destinations.add(destination);
		}
	}
	for (const contribution of contributions) {
		for (const dependency of contribution.dependencies ?? []) {
			if (!contributionIds.has(dependency))
				throw new Error(
					`Contribution ${contribution.id} depends on undeclared ${dependency}`
				);
			const target = contributions.find(
				(candidate) => candidate.id === dependency
			) as WorkbenchContributionDescriptor;
			if (lifecyclePhaseOrdinal(target.phase) > lifecyclePhaseOrdinal(contribution.phase))
				throw new Error(
					`Contribution ${contribution.id} depends on later phase ${dependency}`
				);
		}
	}
	assertAcyclic(contributions);
	if (windowKind === 'candidate' && restoration.entrypointRestorable)
		throw new Error('CandidateWindow cannot be a restorable entrypoint');
	if (
		(layout.panelInitiallyVisible || layout.parts.includes('panel')) &&
		windowKind !== 'candidate'
	)
		throw new Error('Only CandidateWindow may contain PanelPart');
	if (
		!layout.parts.includes('content') ||
		!layout.parts.includes('titlebar') ||
		(windowKind !== 'authenticated' && !layout.parts.includes('status'))
	)
		throw new Error('Workbench layout is missing a required structural part');
	if (
		!Number.isSafeInteger(layout.maxContentGroups) ||
		layout.maxContentGroups < 1 ||
		layout.maxContentGroups > 4
	)
		throw new RangeError('maxContentGroups must be an integer from 1 to 4');
	return Object.freeze({
		id,
		windowKind,
		fragments: Object.freeze(fragments.map((fragment) => fragment.id)),
		contributions: Object.freeze(contributions),
		itemTypes: Object.freeze([...itemTypes]),
		destinations: Object.freeze([...destinations]),
		layout: Object.freeze({ ...layout, parts: Object.freeze([...layout.parts]) }),
		restoration: Object.freeze({ ...restoration })
	});
}

function freezeContribution(
	value: WorkbenchContributionDescriptor
): WorkbenchContributionDescriptor {
	return Object.freeze({
		...value,
		dependencies:
			value.dependencies === undefined ? undefined : Object.freeze([...value.dependencies])
	});
}

function assertAcyclic(contributions: readonly WorkbenchContributionDescriptor[]): void {
	const byId = new Map<string, WorkbenchContributionDescriptor>(
		contributions.map((value) => [value.id, value])
	);
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visiting.has(id))
			throw new Error(`Workbench contribution dependency cycle includes ${id}`);
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const contribution of contributions) visit(contribution.id);
}
