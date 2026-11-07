import type { ExamActivityClient } from '../../platform/examActivity/common/examActivityProtocol.js';
import { createElectronSettingsEditorEnvironment } from './settingsEditorEnvironment.js';
import type { SettingsNativeClient } from '../../platform/settings/common/settingsNativeHost.js';
import { createAccountContribution } from '../../workbench/contrib/account/browser/accountContribution.js';
import type { AccountClient } from '../../platform/account/common/accountProtocol.js';
import type { AuthenticatedWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import type { ProductWindowChromeClient } from '../../platform/windows/common/windowChrome.js';
import { bootstrapWorkbench } from '../../workbench/browser/bootstrap.js';
import { authenticatedComposition } from '../../workbench/browser/authenticatedManifest.js';
import type { AuthenticatedRendererClient } from '../../workbench/contrib/authenticated/browser/authenticatedContribution.js';
import { createAuthenticatedContribution } from '../../workbench/contrib/authenticated/browser/authenticatedContribution.js';
import {
	createSettingsContribution,
	type SettingsRendererClient
} from '../../workbench/contrib/settings/browser/settingsContribution.js';
import { commonWorkbenchContributions } from '../../workbench/workbench.common.main.js';
import { createDesktopWorkbenchContribution } from './workbench.desktop.main.js';

interface AuthenticatedPreloadApi extends AuthenticatedRendererClient {
	bootstrap(): Promise<AuthenticatedWindowDescriptor>;
	readonly windowChrome: ProductWindowChromeClient;
	readonly settings: SettingsRendererClient;
	readonly settingsNative: SettingsNativeClient;
	readonly account: AccountClient;
	readonly examActivity: ExamActivityClient;
}
const api = (globalThis as unknown as { readonly proctorAuthenticated?: AuthenticatedPreloadApi })
	.proctorAuthenticated;
if (api === undefined) throw new Error('Authenticated preload API is unavailable');
const authenticatedWindow = await bootstrapWorkbench(document, authenticatedComposition, [
	...commonWorkbenchContributions,
	createDesktopWorkbenchContribution('authenticated', () => api.bootstrap(), api.windowChrome),
	createAuthenticatedContribution(api),
	createAccountContribution(api.account, {
		writeClipboard: (text) => api.settingsNative.clipboard.writeText(text)
	}),
	createSettingsContribution(
		api.settings,
		createElectronSettingsEditorEnvironment(api.settingsNative)
	)
]);
globalThis.addEventListener('pagehide', () => authenticatedWindow.disposables.dispose(), {
	once: true
});
