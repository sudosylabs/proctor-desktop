/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	ProductWindowDescriptor,
	ProductWindowKind
} from '../../platform/windows/common/windowProtocol.js';
import type {
	WorkbenchBootstrapContext,
	WorkbenchContributionRegistration
} from '../../workbench/browser/bootstrap.js';

export function createDesktopWorkbenchContribution(
	expectedKind: ProductWindowKind,
	bootstrap: () => Promise<ProductWindowDescriptor>
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
		activate(context: WorkbenchBootstrapContext): void {
			if (descriptor === undefined)
				throw new Error(
					'Privileged window descriptor was not established before workbench activation'
				);
			context.setWindowBinding(descriptor);
		}
	});
}
