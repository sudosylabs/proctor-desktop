/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { defineMessage, type MessageDescriptor } from '../../../../base/common/localization.js';
import type { WorkbenchBootstrapContext, WorkbenchContributionRegistration } from '../../../browser/bootstrap.js';
import './attemptWorkspaceContribution.css';

const destinations = Object.freeze({ workspace: defineMessage({ id: 'candidate.destination.workspace', defaultMessage: 'Workspace', description: 'Candidate destination for Attempt Workspace files.' }), examMaterials: defineMessage({ id: 'candidate.destination.exam.materials', defaultMessage: 'Exam materials', description: 'Candidate destination for authorized Exam Resources.' }) });
const messages = Object.freeze({ workspaceWaiting: defineMessage({ id: 'candidate.workspace.waiting', defaultMessage: 'Waiting for the authoritative Attempt Workspace.', description: 'Workspace loading state before the server-bound provider is available.' }), materialsWaiting: defineMessage({ id: 'candidate.exam.materials.waiting', defaultMessage: 'Waiting for authorized Exam Resources.', description: 'Exam Resources loading state before the server-bound catalog is available.' }) });

export const attemptWorkspaceContribution: WorkbenchContributionRegistration = Object.freeze({ id: 'prctr.candidate.workspace' as const, phase: 'ready' as const, dependencies: Object.freeze(['prctr.workbench.desktop' as const]), messages: Object.freeze([...Object.values(destinations), ...Object.values(messages)] as MessageDescriptor[]), activate: (context: WorkbenchBootstrapContext) => {
	const navigation = context.document.createElement('div'); navigation.className = 'prctr-attempt-workspace'; navigation.dataset.region = 'navigation'; const sidebar = context.document.createElement('section'); sidebar.className = 'prctr-attempt-workspace'; sidebar.dataset.region = 'sidebar'; const heading = context.document.createElement('h2'); const status = context.document.createElement('p'); status.setAttribute('role', 'status'); sidebar.append(heading, status); context.shell.part('navigation').append(navigation); context.shell.part('sidebar').append(sidebar); context.disposables.add({ dispose: () => { navigation.remove(); sidebar.remove(); } });
	const buttons = new Map<string, HTMLButtonElement>(); const select = (id: keyof typeof destinations): void => { for (const [candidate, button] of buttons) button.setAttribute('aria-current', candidate === id ? 'page' : 'false'); heading.textContent = context.localization.format(destinations[id]); status.textContent = context.localization.format(id === 'workspace' ? messages.workspaceWaiting : messages.materialsWaiting); sidebar.dataset.destination = id; };
	for (const id of context.composition.destinations) { const descriptor = destinations[id as keyof typeof destinations]; if (descriptor === undefined) throw new Error(`Candidate destination ${id} has no packaged registration`); const button = context.document.createElement('button'); button.type = 'button'; button.textContent = context.localization.format(descriptor); navigation.append(button); buttons.set(id, button); context.disposables.add(addDisposableListener(button, 'click', () => select(id as keyof typeof destinations))); }
	select('workspace');
} });
