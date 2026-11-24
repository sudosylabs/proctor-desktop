// First, so its stylesheet declares the cascade layer order before any other.
import '../../workbench/browser/documentLayout.js';
import type { AccountClient } from '../../platform/account/common/accountProtocol.js';
import type { AdministrationClient } from '../../platform/administration/common/administrationProtocol.js';
import type { ExamActivityClient } from '../../platform/examActivity/common/examActivityProtocol.js';
import type { SettingsNativeClient } from '../../platform/settings/common/settingsNativeHost.js';
import type { ProductWindowChromeClient } from '../../platform/windows/common/windowChrome.js';
import type { AuthenticatedWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import { authenticatedComposition } from '../../workbench/browser/authenticatedManifest.js';
import { bootstrapWorkbench } from '../../workbench/browser/bootstrap.js';
import { accountContribution } from '../../workbench/contrib/account/account.contribution.js';
import { administrationContribution } from '../../workbench/contrib/administration/administration.contribution.js';
import { authenticatedFrameContribution } from '../../workbench/browser/authenticated/authenticated.contribution.js';
import { examActivityContribution } from '../../workbench/contrib/examActivity/examActivity.contribution.js';
import { settingsContribution } from '../../workbench/contrib/settings/settings.contribution.js';
import type { SettingsRendererClient } from '../../workbench/services/settings/common/settingsRendererClient.js';
import { commonWorkbenchContributions } from '../../workbench/workbench.common.main.js';
import { authenticatedWindowServices } from './authenticatedServices.js';
import type { LogForwarder } from '../../platform/log/browser/forwardingLogService.js';
import { createDesktopWorkbenchContribution } from './workbench.desktop.main.js';

interface AuthenticatedPreloadApi {
	bootstrap(): Promise<AuthenticatedWindowDescriptor>;
	signOut(): Promise<void>;
	close(): Promise<void>;
	readonly windowChrome: ProductWindowChromeClient;
	readonly settings: SettingsRendererClient;
	readonly settingsNative: SettingsNativeClient;
	readonly account: AccountClient;
	readonly administration: AdministrationClient;
	readonly examActivity: ExamActivityClient;
	log: LogForwarder;
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
		authenticatedFrameContribution,
		examActivityContribution,
		accountContribution,
		administrationContribution,
		settingsContribution
	],
	{
		windowChrome: preload.windowChrome,
		services: authenticatedWindowServices({
			signOut: () => preload.signOut(),
			account: preload.account,
			administration: preload.administration,
			settings: preload.settings,
			clipboard: preload.settingsNative.clipboard,
			examActivity: preload.examActivity,
			log: preload.log
		})
	}
);
globalThis.addEventListener('pagehide', () => authenticatedWindow.disposables.dispose(), {
	once: true
});
