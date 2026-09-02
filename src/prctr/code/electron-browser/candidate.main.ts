import type { CandidateWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import { bootstrapWorkbench } from '../../workbench/browser/bootstrap.js';
import { candidateComposition } from '../../workbench/browser/candidateManifest.js';
import { attemptWorkspaceContribution } from '../../workbench/contrib/attemptWorkspace/browser/attemptWorkspaceContribution.js';
import type { CandidateSecurityRendererClient } from '../../workbench/contrib/examSecurity/browser/examSecurityContribution.js';
import { createExamSecurityContribution } from '../../workbench/contrib/examSecurity/browser/examSecurityContribution.js';
import type { IntegratedBrowserRendererClient } from '../../workbench/contrib/integratedBrowser/browser/integratedBrowserContribution.js';
import { createIntegratedBrowserContribution } from '../../workbench/contrib/integratedBrowser/browser/integratedBrowserContribution.js';
import type { TerminalRendererClient } from '../../workbench/contrib/terminal/browser/remoteTerminalPanel.js';
import { createRemoteTerminalContribution } from '../../workbench/contrib/terminal/browser/terminalContribution.js';
import { commonWorkbenchContributions } from '../../workbench/workbench.common.main.js';
import { createDesktopWorkbenchContribution } from './workbench.desktop.main.js';

interface CandidatePreloadApi {
	bootstrap(): Promise<CandidateWindowDescriptor>;
	readonly security: CandidateSecurityRendererClient;
	readonly browser: IntegratedBrowserRendererClient;
	readonly terminal: TerminalRendererClient;
}
const api = (globalThis as unknown as { readonly proctorCandidate?: CandidatePreloadApi })
	.proctorCandidate;
if (api === undefined) throw new Error('Candidate preload API is unavailable');
const candidateWindow = await bootstrapWorkbench(document, candidateComposition, [
	...commonWorkbenchContributions,
	createDesktopWorkbenchContribution('candidate', () => api.bootstrap()),
	attemptWorkspaceContribution,
	createIntegratedBrowserContribution(api.browser),
	createRemoteTerminalContribution(api.terminal),
	createExamSecurityContribution(api.security)
]);
globalThis.addEventListener('pagehide', () => candidateWindow.disposables.dispose(), {
	once: true
});
