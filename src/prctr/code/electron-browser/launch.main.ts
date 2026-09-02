import {
	bootstrapLaunchWindow,
	type LaunchRendererClient
} from '../../workbench/browser/launchWindow.js';

const api = (globalThis as unknown as { readonly proctorLaunch?: LaunchRendererClient })
	.proctorLaunch;
if (api === undefined) throw new Error('Launch preload API is unavailable');
const launchWindow = await bootstrapLaunchWindow(document, api);
globalThis.addEventListener('pagehide', () => launchWindow.disposables.dispose(), { once: true });
