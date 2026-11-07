/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import type { MessageDescriptor } from '../../../../base/common/localization.js';
import type { AccountClient } from '../../../../platform/account/common/accountProtocol.js';
import type { ExamActivityClient } from '../../../../platform/examActivity/common/examActivityProtocol.js';
import type { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import {
	PRODUCT_WINDOW_CHROME_SERVICE,
	type ProductWindowChrome
} from '../../../../platform/windows/browser/productWindowChrome.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import type {
	WorkbenchBootstrapContext,
	WorkbenchContributionRegistration
} from '../../../browser/bootstrap.js';
import type { WorkbenchPaneHost } from '../../../browser/paneHost.js';
import { WORKBENCH_KEYBINDING_SERVICE } from '../../../common/serviceIds.js';
import { WORKBENCH_PANE_HOST } from '../../../workbench.common.main.js';
import { activateExamActivity } from '../../examActivity/browser/examActivityContribution.js';
import { examActivityMessages } from '../../examActivity/browser/examActivityMessages.js';
import { AuthenticatedFrame } from './authenticatedFrame.js';
import { authenticatedMessages } from './authenticatedMessages.js';
import {
	AUTHENTICATED_LAYOUT_SERVICE,
	AUTHENTICATED_NAVIGATION_SERVICE
} from './authenticatedNavigation.js';
import {
	AUTHENTICATED_WINDOW_CONTROLS_SERVICE,
	AuthenticatedWindowControls
} from './authenticatedWindowControls.js';

export interface AuthenticatedRendererClient {
	readonly examActivity?: ExamActivityClient;
	readonly account?: AccountClient;
	signOut(): Promise<void>;
	close(): Promise<void>;
}

/** AuthenticatedWindow's frame and navigation; product contributions depend on it. */
export function createAuthenticatedContribution(
	client: AuthenticatedRendererClient
): WorkbenchContributionRegistration {
	return Object.freeze({
		id: 'prctr.authenticated.navigation' as const,
		phase: 'ready' as const,
		dependencies: Object.freeze(['prctr.workbench.desktop' as const]),
		messages: Object.freeze([
			...Object.values(authenticatedMessages),
			...Object.values(examActivityMessages)
		] as MessageDescriptor[]),
		activate: (context: WorkbenchBootstrapContext) => {
			const binding = context.getWindowBinding() as AuthenticatedWindowDescriptor;
			if (binding?.kind !== 'authenticated')
				throw new Error(
					'Authenticated contribution requires its privileged window binding'
				);
			const controls = context.disposables.add(new AuthenticatedWindowControls(context));
			context.setService(AUTHENTICATED_WINDOW_CONTROLS_SERVICE, controls);
			const keybindings = context.getService<IKeybindingService>(
				WORKBENCH_KEYBINDING_SERVICE
			);
			const hover = (target: HTMLElement, label: string, command?: string) =>
				controls.hover.setupDelayedHover(
					target,
					() => {
						const shortcut =
							command === undefined
								? undefined
								: keybindings.lookupKeybinding(command)?.getLabel();
						return {
							content: shortcut ? `${label} (${shortcut})` : label,
							position: { hoverPosition: HoverPosition.BELOW }
						};
					},
					{ groupId: 'authenticated-frame' }
				);
			const account = client.account;
			const frame = context.disposables.add(
				new AuthenticatedFrame(
					{
						shell: context.shell,
						chrome: context.getService<ProductWindowChrome>(
							PRODUCT_WINDOW_CHROME_SERVICE
						),
						paneHost: context.getService<WorkbenchPaneHost>(WORKBENCH_PANE_HOST),
						localization: context.localization,
						binding,
						productPages: client.examActivity !== undefined,
						hover
					},
					{
						signOut: () => client.signOut(),
						readPhoto:
							account === undefined
								? undefined
								: async () => {
										const result = await account.request({ kind: 'readPhoto' });
										return result.kind === 'photo' ? result.dataUrl : undefined;
									}
					}
				)
			);
			context.setService(AUTHENTICATED_NAVIGATION_SERVICE, frame);
			context.setService(AUTHENTICATED_LAYOUT_SERVICE, frame);
			if (client.examActivity) activateExamActivity(context, client.examActivity);
		}
	});
}
