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
}
const api = (globalThis as unknown as { readonly proctorAuthenticated?: AuthenticatedPreloadApi })
	.proctorAuthenticated;
if (api === undefined) throw new Error('Authenticated preload API is unavailable');
const authenticatedWindow = await bootstrapWorkbench(document, authenticatedComposition, [
	...commonWorkbenchContributions,
	createDesktopWorkbenchContribution('authenticated', () => api.bootstrap(), api.windowChrome),
	createAuthenticatedContribution(api),
	createSettingsContribution(api.settings)
]);
globalThis.addEventListener('pagehide', () => authenticatedWindow.disposables.dispose(), {
	once: true
});
