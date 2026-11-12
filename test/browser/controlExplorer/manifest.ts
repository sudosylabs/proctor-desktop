import { notificationsFixture } from './notificationsFixture.ts';
import { controlsFixture } from './sharedControlsFixture.ts';
import { proctorControlsFixture } from './proctorControlsFixture.ts';
import { brandLockupFixture } from './brandLockupFixture.ts';
import { productWindowChromeFixture } from './productWindowChromeFixture.ts';
import { statusAndRowsFixture } from './statusAndRowsFixture.ts';
import { runLaunchWindowTests } from '../launchWindowTests.ts';
import { launchStates } from '../../../src/prctr/platform/identity/common/launchIdentity.ts';

export interface ControlFixtureResult {
	readonly states: number;
	readonly disposable: { dispose(): void };
	verify(): number | Promise<number>;
}
export interface ControlFixture {
	readonly id: string;
	readonly title: string;
	mount(host: HTMLElement): ControlFixtureResult;
}

/** Development-only literal manifest. Production compositions cannot reach this test root. */
export const controlExplorerFixtures: readonly ControlFixture[] = Object.freeze([
	Object.freeze({ id: 'notifications', title: 'Notifications', mount: notificationsFixture }),
	Object.freeze({ id: 'shared-controls', title: 'Shared controls', mount: controlsFixture }),
	Object.freeze({
		id: 'proctor-controls',
		title: 'Proctor controls',
		mount: proctorControlsFixture
	}),
	Object.freeze({
		id: 'status-and-rows',
		title: 'Status words and row menus',
		mount: statusAndRowsFixture
	}),
	Object.freeze({ id: 'brand-lockup', title: 'Brand lockup', mount: brandLockupFixture }),
	Object.freeze({
		id: 'product-window-chrome',
		title: 'Product window chrome',
		mount: productWindowChromeFixture
	}),
	Object.freeze({
		id: 'launch-window',
		title: 'LaunchWindow readiness',
		mount: (host: HTMLElement): ControlFixtureResult => ({
			states: launchStates.length,
			disposable: { dispose() {} },
			verify: async () => {
				await runLaunchWindowTests(host.ownerDocument, host);
				return 1;
			}
		})
	})
]);
