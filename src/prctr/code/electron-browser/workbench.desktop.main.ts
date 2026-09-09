/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { installWorkbenchNotifications } from '../../workbench/browser/parts/notifications/notificationWindow.js';
import {
	WORKBENCH_LIFECYCLE_SERVICE,
	type WorkbenchLifecycleService
} from '../../workbench/common/lifecycle.js';
import type {
	ProductWindowDescriptor,
	ProductWindowKind
} from '../../platform/windows/common/windowProtocol.js';
import {
	ProductWindowChrome,
	PRODUCT_WINDOW_CHROME_SERVICE
} from '../../platform/windows/browser/productWindowChrome.js';
import type { ProductWindowChromeClient } from '../../platform/windows/common/windowChrome.js';
import {
	BROWSER_THEME_SERVICE,
	type BrowserThemeService
} from '../../platform/theme/browser/themeService.js';
import type {
	WorkbenchBootstrapContext,
	WorkbenchContributionRegistration
} from '../../workbench/browser/bootstrap.js';

export function createDesktopWorkbenchContribution(
	expectedKind: ProductWindowKind,
	bootstrap: () => Promise<ProductWindowDescriptor>,
	windowChrome?: ProductWindowChromeClient
): WorkbenchContributionRegistration {
	let descriptor: ProductWindowDescriptor | undefined;
	return Object.freeze({
		id: 'prctr.workbench.desktop' as const,
		phase: 'starting' as const,
		blocksPhase: true,
		dependencies: Object.freeze(['prctr.workbench.kernel' as const]),
		async prepareBeforeShell(
			composition: WorkbenchBootstrapContext['composition']
		): Promise<void> {
			const candidate = await bootstrap();
			if (candidate.kind !== expectedKind || candidate.kind !== composition.windowKind)
				throw new Error(
					'Privileged window descriptor does not match the packaged workbench composition'
				);
			descriptor = candidate;
		},
		async activate(context: WorkbenchBootstrapContext): Promise<void> {
			if (descriptor === undefined)
				throw new Error(
					'Privileged window descriptor was not established before workbench activation'
				);
			context.setWindowBinding(descriptor);
			const notifications = installWorkbenchNotifications(context, descriptor);
			const lifecycle = context.getService<WorkbenchLifecycleService>(
				WORKBENCH_LIFECYCLE_SERVICE
			);
			context.disposables.add(
				lifecycle.onDidAdvancePhase((phase) => {
					if (phase === 'restored') notifications.start();
				})
			);
			if (windowChrome !== undefined) {
				const chrome = context.disposables.add(
					await ProductWindowChrome.create(
						context.shell.part('titlebar'),
						windowChrome,
						context.getService<BrowserThemeService>(BROWSER_THEME_SERVICE)
					)
				);
				context.setService(PRODUCT_WINDOW_CHROME_SERVICE, chrome);
				context.disposables.add(
					context.shell.overlayHost.onDidChangeVisibility((visible) => {
						void chrome.setDimmed(visible).catch(() => undefined);
					})
				);
				await chrome.setDimmed(context.shell.overlayHost.visible);
			}
		}
	});
}
