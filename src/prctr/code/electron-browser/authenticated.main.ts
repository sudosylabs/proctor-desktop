// First, so its stylesheet declares the cascade layer order before any other.
import '../../workbench/browser/documentLayout.js';
import type { AccountClient } from '../../platform/account/common/accountProtocol.js';
import type { ExamActivityClient } from '../../platform/examActivity/common/examActivityProtocol.js';
import type { SettingsNativeClient } from '../../platform/settings/common/settingsNativeHost.js';
import type { ProductWindowChromeClient } from '../../platform/windows/common/windowChrome.js';
import type { AuthenticatedWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import { authenticatedComposition } from '../../workbench/browser/authenticatedManifest.js';
import { bootstrapWorkbench } from '../../workbench/browser/bootstrap.js';
import { accountContribution } from '../../workbench/contrib/account/browser/accountContribution.js';
import { authenticatedContribution } from '../../workbench/contrib/authenticated/browser/authenticatedContribution.js';
import { settingsContribution } from '../../workbench/contrib/settings/browser/settingsContribution.js';
import type { SettingsRendererClient } from '../../workbench/services/settings/common/settingsRendererClient.js';
import { commonWorkbenchContributions } from '../../workbench/workbench.common.main.js';
import { authenticatedWindowServices } from './authenticatedServices.js';
import { createDesktopWorkbenchContribution } from './workbench.desktop.main.js';

interface AuthenticatedPreloadApi {
	bootstrap(): Promise<AuthenticatedWindowDescriptor>;
	signOut(): Promise<void>;
	close(): Promise<void>;
	readonly windowChrome: ProductWindowChromeClient;
	readonly settings: SettingsRendererClient;
	readonly settingsNative: SettingsNativeClient;
	readonly account: AccountClient;
	readonly examActivity: ExamActivityClient;
}
const api = (globalThis as unknown as { readonly proctorAuthenticated?: AuthenticatedPreloadApi })
	.proctorAuthenticated;
if (api === undefined) throw new Error('Authenticated preload API is unavailable');
const preload = api;

const authenticatedWindow = await bootstrapWorkbench(
	document,
	authenticatedComposition,
	[
		...commonWorkbenchContributions,
		createDesktopWorkbenchContribution('authenticated', () => preload.bootstrap()),
		authenticatedContribution,
		accountContribution,
		settingsContribution
	],
	{
		windowChrome: preload.windowChrome,
		services: authenticatedWindowServices({
			signOut: () => preload.signOut(),
			account: preload.account,
			settings: preload.settings,
			clipboard: preload.settingsNative.clipboard,
			examActivity: preload.examActivity
		})
	}
);
globalThis.addEventListener('pagehide', () => authenticatedWindow.disposables.dispose(), {
	once: true
});
