// First, so its stylesheet declares the cascade layer order before any other.
import '../../workbench/browser/documentLayout.js';
import type { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import type { CandidateWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import { bootstrapWorkbench } from '../../workbench/browser/bootstrap.js';
import { candidateComposition } from '../../workbench/browser/candidateManifest.js';
import { attemptWorkspaceContribution } from '../../workbench/contrib/attemptWorkspace/browser/attemptWorkspaceContribution.js';
import { examSecurityContribution } from '../../workbench/contrib/examSecurity/browser/examSecurityContribution.js';
import { integratedBrowserContribution } from '../../workbench/contrib/integratedBrowser/browser/integratedBrowserContribution.js';
import {
	CandidateSecurityService,
	ICandidateSecurityService,
	type CandidateSecurityRendererClient
} from '../../workbench/services/examSecurity/common/candidateSecurity.js';
import {
	IIntegratedBrowserService,
	IntegratedBrowserService,
	type IntegratedBrowserRendererClient
} from '../../workbench/services/integratedBrowser/common/integratedBrowser.js';
import { commonWorkbenchContributions } from '../../workbench/workbench.common.main.js';
import { createDesktopWorkbenchContribution } from './workbench.desktop.main.js';

interface CandidatePreloadApi {
	bootstrap(): Promise<CandidateWindowDescriptor>;
	readonly security: CandidateSecurityRendererClient;
	readonly browser: IntegratedBrowserRendererClient;
}
const api = (globalThis as unknown as { readonly proctorCandidate?: CandidatePreloadApi })
	.proctorCandidate;
if (api === undefined) throw new Error('Candidate preload API is unavailable');
const preload = api;

/** The preload's capabilities, each as the window service that presents it. */
function registerPreloadServices(services: ServiceCollection): void {
	services.set(ICandidateSecurityService, new CandidateSecurityService(preload.security));
	services.set(IIntegratedBrowserService, new IntegratedBrowserService(preload.browser));
}

const candidateWindow = await bootstrapWorkbench(
	document,
	candidateComposition,
	[
		...commonWorkbenchContributions,
		createDesktopWorkbenchContribution('candidate', () => preload.bootstrap()),
		attemptWorkspaceContribution,
		integratedBrowserContribution,
		examSecurityContribution
	],
	{ services: [registerPreloadServices] }
);
globalThis.addEventListener('pagehide', () => candidateWindow.disposables.dispose(), {
	once: true
});
