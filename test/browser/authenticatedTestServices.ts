import { Disposable } from '../../src/prctr/base/common/lifecycle.js';
import type { AccountClient } from '../../src/prctr/platform/account/common/accountProtocol.js';
import { SyncDescriptor } from '../../src/prctr/platform/instantiation/common/descriptors.js';
import type { SettingsClipboardClient } from '../../src/prctr/platform/settings/common/settingsNativeHost.js';
import type { WorkbenchContributionRegistration } from '../../src/prctr/workbench/browser/bootstrap.js';

/** An account whose every read is unavailable, for windows whose test is not about Account. */
export const unavailableAccount: AccountClient = Object.freeze({
	async request() {
		return { kind: 'error', reason: 'unavailable' } as const;
	}
});

/** A clipboard that refuses use, for windows whose test never copies. */
export const unusedClipboard: SettingsClipboardClient = Object.freeze({
	readText: refuse,
	writeText: refuse,
	readFindText: refuse,
	writeFindText: refuse,
	readImage: refuse,
	readResources: refuse,
	writeResources: refuse,
	hasResources: refuse,
	paste: refuse
});

async function refuse(): Promise<never> {
	throw new Error('The clipboard is not part of this test');
}

class InertContribution extends Disposable {}

/** Stands in for a packaged contribution the test does not exercise. */
export function inertContribution(
	id: `prctr.${string}`,
	dependencies: readonly `prctr.${string}`[]
): WorkbenchContributionRegistration {
	return Object.freeze({
		id,
		phase: 'ready' as const,
		dependencies,
		descriptor: new SyncDescriptor(InertContribution)
	});
}
