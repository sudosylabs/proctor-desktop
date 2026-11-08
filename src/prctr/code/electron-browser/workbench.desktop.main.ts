/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from '../../platform/instantiation/common/descriptors.js';
import { Disposable } from '../../base/common/lifecycle.js';
import type {
	ProductWindowDescriptor,
	ProductWindowKind
} from '../../platform/windows/common/windowProtocol.js';
import type { WorkbenchContributionRegistration } from '../../workbench/browser/bootstrap.js';
import type { WorkbenchComposition } from '../../workbench/common/composition.js';

/**
 * The desktop binding is established before the shell exists; by the time this
 * contribution is created the window's services already carry it.
 */
class DesktopWorkbenchContribution extends Disposable {}

/** Establishes the privileged window binding and refuses one for another composition. */
export function createDesktopWorkbenchContribution(
	expectedKind: ProductWindowKind,
	bootstrap: () => Promise<ProductWindowDescriptor>
): WorkbenchContributionRegistration {
	return Object.freeze({
		id: 'prctr.workbench.desktop' as const,
		phase: 'starting' as const,
		blocksPhase: true,
		dependencies: Object.freeze(['prctr.workbench.kernel' as const]),
		async prepareBeforeShell(
			composition: WorkbenchComposition
		): Promise<ProductWindowDescriptor> {
			const candidate = await bootstrap();
			if (candidate.kind !== expectedKind || candidate.kind !== composition.windowKind) {
				throw new Error(
					'Privileged window descriptor does not match the packaged workbench composition'
				);
			}
			return candidate;
		},
		descriptor: new SyncDescriptor(DesktopWorkbenchContribution)
	});
}
