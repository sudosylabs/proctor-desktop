/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { TerminalRendererClient } from './remoteTerminalPanel.js';
import { RemoteTerminalPanel } from './remoteTerminalPanel.js';
import {
	createRemoteTerminalPanelLabels,
	remoteTerminalMessageDescriptors
} from './remoteTerminalLabels.js';
import type {
	WorkbenchBootstrapContext,
	WorkbenchContributionRegistration
} from '../../../browser/bootstrap.js';
import {
	BROWSER_THEME_SERVICE,
	type BrowserThemeService
} from '../../../../platform/theme/browser/themeService.js';

export function createRemoteTerminalContribution(
	client: TerminalRendererClient
): WorkbenchContributionRegistration {
	return Object.freeze({
		id: 'prctr.candidate.terminal' as const,
		phase: 'ready' as const,
		dependencies: Object.freeze(['prctr.workbench.desktop' as const]),
		messages: remoteTerminalMessageDescriptors,
		activate: (context: WorkbenchBootstrapContext) => {
			const host = context.shell.part('panel');
			const panel = context.disposables.add(
				new RemoteTerminalPanel(context.document, {
					client,
					labels: createRemoteTerminalPanelLabels(context.localization),
					scrollbackLines: 10_000,
					cursorBlink: true,
					themeService: context.getService<BrowserThemeService>(BROWSER_THEME_SERVICE)
				})
			);
			host.append(panel.element);
			const layout = (): void => {
				const bounds = host.getBoundingClientRect();
				panel.layout(bounds.width, bounds.height);
			};
			const observer = new ResizeObserver(layout);
			observer.observe(host);
			context.disposables.add({ dispose: () => observer.disconnect() });
			layout();
		}
	});
}
