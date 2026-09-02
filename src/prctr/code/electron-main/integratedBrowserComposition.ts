import type { IpcMain, WebContents } from 'electron/main';
import type { BrowserEnforcementDelegate } from '../../platform/integratedBrowser/common/browserEnforcement.js';
import { validateBrowserPolicy, type BrowserPolicyInput } from '../../platform/integratedBrowser/common/browserPolicy.js';
import { createElectronBrowserView, type ElectronBrowserViewHost } from '../../platform/integratedBrowser/electron-main/electronBrowserEnforcer.js';
import { IntegratedBrowserCoordinator, type BrowserActivitySink, type BrowserActivitySinkFactory, type IntegratedBrowserGate } from '../../workbench/services/integratedBrowser/common/integratedBrowserCoordinator.js';
import { IntegratedBrowserIpcBridge } from '../../workbench/services/integratedBrowser/electron-main/integratedBrowserIpc.js';

export interface IntegratedBrowserCompositionOptions { readonly partition: string; readonly institutionOrigin: string; readonly policy: BrowserPolicyInput; readonly gate: IntegratedBrowserGate; readonly activity: BrowserActivitySink; readonly activityFactory: BrowserActivitySinkFactory; readonly host: ElectronBrowserViewHost; readonly ipcMain: IpcMain; readonly candidateContents: WebContents }

/** CandidateWindow composition root. Identity/exam security supplies all Attempt-bound inputs. */
export async function createIntegratedBrowserComposition(options: IntegratedBrowserCompositionOptions) {
	const policy = validateBrowserPolicy(options.policy, { institutionOrigin: options.institutionOrigin }); assertActivityScope(options.activity, policy);
	let coordinator: IntegratedBrowserCoordinator | undefined; let created: Awaited<ReturnType<typeof createElectronBrowserView>> | undefined; let ipc: IntegratedBrowserIpcBridge | undefined;
	try {
		const delegate: BrowserEnforcementDelegate = { checkTopLevel: (...args) => coordinator!.checkTopLevel(...args), commitTopLevel: (...args) => coordinator!.commitTopLevel(...args), checkSubresource: url => coordinator!.checkSubresource(url), blockPopup: url => coordinator!.blockPopup(url) };
		created = await createElectronBrowserView(options.partition, options.host, delegate); coordinator = new IntegratedBrowserCoordinator(policy, options.gate, created.engine, options.activity, options.activityFactory, options.institutionOrigin); ipc = new IntegratedBrowserIpcBridge(options.ipcMain, options.candidateContents, coordinator, surface => created!.engine.setSurface(surface), { current: () => created!.engine.surfaceFocused(), onDidChange: listener => created!.engine.onDidChangeSurfaceFocus(listener) });
		const ownedCoordinator = coordinator; const ownedCreated = created; const ownedIpc = ipc;
		return Object.freeze({ view: ownedCreated.view, coordinator: ownedCoordinator, async dispose(): Promise<void> {
			const cleanupErrors: unknown[] = [];
			try { ownedIpc.dispose(); } catch (error) { cleanupErrors.push(error); }
			try { await ownedCoordinator.dispose(); } catch (error) { cleanupErrors.push(error); }
			try { ownedCreated.engine.dispose(); } catch (error) { cleanupErrors.push(error); }
			if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Integrated browser composition disposal failed');
		} });
	} catch (error) {
		const cleanupErrors: unknown[] = []; try { ipc?.dispose(); } catch (cleanupError) { cleanupErrors.push(cleanupError); } let coordinatorDisposed = false;
		if (coordinator !== undefined) { try { await coordinator.dispose(); coordinatorDisposed = true; } catch (cleanupError) { cleanupErrors.push(cleanupError); } }
		if (!coordinatorDisposed) { try { options.activity.dispose(); } catch (cleanupError) { cleanupErrors.push(cleanupError); } }
		if (created !== undefined) { try { await created.engine.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); } try { created.engine.dispose(); } catch (cleanupError) { cleanupErrors.push(cleanupError); } }
		if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], 'Integrated browser composition and rollback failed'); throw error;
	}
}

function assertActivityScope(activity: BrowserActivitySink, policy: ReturnType<typeof validateBrowserPolicy>): void { const scope = activity.scope; if (scope.attemptId !== policy.attemptId || scope.participationGeneration !== policy.participationGeneration || scope.policyRevision !== policy.revision || scope.policyDigest !== policy.digest) throw new TypeError('Browser Activity sink is outside the validated Browser Policy scope'); }
