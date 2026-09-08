import { join } from 'node:path';
import { createServer } from 'node:http';
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	type IpcMain,
	type IpcMainInvokeEvent,
	type WebContents
} from 'electron';
import {
	assertProductWindowIpcSender,
	ElectronProductWindowFactory,
	lockedBrowserWindowOptions
} from '../../src/prctr/platform/windows/electron-main/electronProductWindowFactory.js';
import {
	ElectronWindowChromeBridge,
	resolveProductWindowChromeConfiguration,
	type ElectronWindowChromeTarget
} from '../../src/prctr/platform/windows/electron-main/electronWindowChrome.js';
import { WINDOW_CHROME_CHANNELS } from '../../src/prctr/platform/windows/common/windowChannels.js';
import type {
	ProductWindowDescriptor,
	ProductWindowKind
} from '../../src/prctr/platform/windows/common/windowProtocol.js';
import type {
	BrowserActivityKind,
	BrowserActivityRecord,
	BrowserActivitySeal
} from '../../src/prctr/platform/integratedBrowser/common/browserActivity.js';
import type { BrowserEnforcementDelegate } from '../../src/prctr/platform/integratedBrowser/common/browserEnforcement.js';
import {
	validateBrowserPolicy,
	type BrowserPolicyInput
} from '../../src/prctr/platform/integratedBrowser/common/browserPolicy.js';
import type { IntegratedBrowserSurface } from '../../src/prctr/platform/integratedBrowser/common/browserProtocol.js';
import { createElectronBrowserView } from '../../src/prctr/platform/integratedBrowser/electron-main/electronBrowserEnforcer.js';
import {
	IntegratedBrowserCoordinator,
	type BrowserActivitySink
} from '../../src/prctr/workbench/services/integratedBrowser/common/integratedBrowserCoordinator.js';
import { IntegratedBrowserIpcBridge } from '../../src/prctr/workbench/services/integratedBrowser/electron-main/integratedBrowserIpc.js';
import { createIntegratedBrowserComposition } from '../../src/prctr/code/electron-main/integratedBrowserComposition.js';
import { createTerminalComposition } from '../../src/prctr/code/electron-main/terminalComposition.js';
import { createUserSettingsComposition } from '../../src/prctr/code/electron-main/userSettingsComposition.js';
import { ExamSecurityIpcBridge } from '../../src/prctr/workbench/services/examSecurity/electron-main/examSecurityIpc.js';
import { errorHandler, setUnexpectedErrorHandler } from '../../src/prctr/base/common/errors.js';
import { DesktopIdentityCoordinator } from '../../src/prctr/platform/identity/electron-main/desktopIdentityCoordinator.js';
import { verifyLaunchWindowScenario } from './launchWindowScenario.js';
import { installLaunchWindowMenu } from '../../src/prctr/platform/windows/electron-main/launchWindowMenu.js';

const timeout = setTimeout(() => fail(new Error('window skeleton timeout')), 15_000);
// Keep this multi-scenario harness alive between the skeleton and real LaunchWindow.
app.on('window-all-closed', () => {});
void app.whenReady().then(run).catch(fail);

async function run(): Promise<void> {
	const root = app.getAppPath();
	const html = join(root, 'index.html');
	const launchIdentity = new DesktopIdentityCoordinator({
		target: {
			release: '1.0.0',
			buildId: 'test-build',
			platform: 'darwin',
			architecture: 'arm64',
			realtimeProtocol: 1,
			authorizationProtocol: 1
		},
		allowDevelopmentLoopback: false,
		transport: {
			probe: async () => ({
				system: { ok: false, reason: 'unreachable' },
				discovery: { ok: false, reason: 'unreachable' }
			})
		}
	});
	const factory = new ElectronProductWindowFactory({
		launchIdentity,
		production: true,
		rendererByKind: { launch: html, authenticated: html, candidate: html },
		preloadByKind: {
			launch: join(root, 'launchPreload.cjs'),
			authenticated: join(root, 'authenticatedPreload.cjs'),
			candidate: join(root, 'candidatePreload.cjs')
		}
	});
	const results: unknown[] = [];
	const managedWindows: ReturnType<typeof factory.create>[] = [];
	const bridges: IntegratedBrowserIpcBridge[] = [];
	const senderIds = new Set<number>();
	let candidateSurface: IntegratedBrowserSurface | undefined;
	let candidateContentBounds: { readonly width: number; readonly height: number } | undefined;
	let authenticatedContents: WebContents | undefined;
	let candidateContents: WebContents | undefined;
	for (const kind of ['launch', 'authenticated', 'candidate'] as const) {
		const intents: unknown[] = [];
		const managed = factory.create(
			descriptor(kind),
			(intent) => intents.push(intent),
			(reason) => {
				throw new Error(`window terminated unexpectedly: ${reason}`);
			}
		);
		managedWindows.push(managed);
		const window = BrowserWindow.getAllWindows().find(
			(candidate) => !candidate.isDestroyed() && !senderIds.has(candidate.webContents.id)
		);
		if (window === undefined) throw new Error('factory did not create a BrowserWindow');
		if (kind === 'authenticated') authenticatedContents = window.webContents;
		if (kind === 'candidate') candidateContents = window.webContents;
		senderIds.add(window.webContents.id);
		if (kind === 'candidate') {
			const projection = {
				state: 'closed' as const,
				policyRevision: 'browser:test',
				canOpen: true,
				canClose: false,
				canGoBack: false,
				canGoForward: false,
				canReload: false
			};
			const model: Pick<
				IntegratedBrowserCoordinator,
				'observe' | 'handleIntent' | 'onDidChange'
			> = {
				observe: () => projection,
				handleIntent: async () => {},
				onDidChange: () => ({ dispose() {} })
			};
			bridges.push(
				new IntegratedBrowserIpcBridge(
					ipcMain,
					window.webContents,
					model,
					(surface) => {
						candidateSurface = surface;
					},
					{ current: () => false, onDidChange: () => ({ dispose() {} }) }
				)
			);
			const bounds = window.getContentBounds();
			candidateContentBounds = { width: bounds.width, height: bounds.height };
		}
		if (window.webContents.isLoading())
			await new Promise<void>((resolve) =>
				window.webContents.once('did-finish-load', () => resolve())
			);
		let reloadStarts = 0;
		const recordReload = (): void => {
			reloadStarts++;
		};
		window.webContents.on('did-start-loading', recordReload);
		window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: ['meta'] });
		window.webContents.sendInputEvent({
			type: 'keyDown',
			keyCode: 'R',
			modifiers: ['control']
		});
		window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F5' });
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		window.webContents.off('did-start-loading', recordReload);
		const renderer = (await window.webContents.executeJavaScript(
			`(async () => {
      const names = ['proctorLaunch', 'proctorAuthenticated', 'proctorCandidate'].filter(name => name in globalThis);
      const api = globalThis[names[0]];
      const bootstrap = await api.bootstrap();
      let windowChrome;
      if (bootstrap.kind !== 'candidate') {
        windowChrome = await api.windowChrome.configuration();
        const subscription = api.windowChrome.onDidChangeFullscreen(() => {});
        await api.windowChrome.update({ protocolVersion: 1, theme: 'dark', titlebarHeight: windowChrome.titlebarHeight, dimmed: false });
        subscription.dispose();
      }
      if (bootstrap.kind === 'launch') {
        if ('changeServer' in api || 'signIn' in api) throw new Error('legacy Launch authority remains exposed');
        const events = []; const subscription = api.identity.onDidChange(value => events.push(value));
        if ((await api.identity.projection()).state !== 'selectingServer') throw new Error('missing initial Launch state');
        await api.identity.selectServer('https://institution.example.test');
        if ((await api.identity.projection()).state !== 'unreachable') throw new Error('missing checked Launch state');
        let rejected = false; try { await api.identity.signIn(); } catch { rejected = true; }
        if (!rejected) throw new Error('unchecked sign-in accepted');
        await api.identity.changeServer(); subscription.dispose(); await api.exit();
      }
      else if (bootstrap.kind === 'authenticated') await api.joinAttempt('attempt-2');
      else { await api.requestDeparture(); await api.browser.surface({ visible: true, focus: true, bounds: { x: -10, y: 10, width: 100000, height: 100000 } }); if (await api.browser.surfaceFocus() !== false) throw new Error('unexpected integrated browser focus'); }
      let browserSurfaceValidationRejected = false; if (bootstrap.kind === 'candidate') { try { await api.browser.surface({ visible: true, focus: false, bounds: { x: 0, y: 0, width: 10, height: 10 }, extra: true }); } catch { browserSurfaceValidationRejected = true; } }
      return { names, bootstrap, windowChrome, browserSurfaceValidationRejected, hasNodeProcess: 'process' in globalThis, hasNodeRequire: 'require' in globalThis, popupDenied: window.open('https://example.com') === null };
    })()`,
			true
		)) as unknown;
		window.webContents.openDevTools({ mode: 'detach', activate: false });
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		const devToolsDisabled = !window.webContents.isDevToolsOpened();
		if (!devToolsDisabled) window.webContents.closeDevTools();
		const preferences = (
			window.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }
		).getLastWebPreferences();
		assertProductWindowIpcSender(
			{ sender: window.webContents, senderFrame: window.webContents.mainFrame },
			window.webContents,
			false
		);
		let subframeAuthorizationRejected = false;
		try {
			assertProductWindowIpcSender(
				{
					sender: window.webContents,
					senderFrame: {} as typeof window.webContents.mainFrame
				},
				window.webContents,
				false
			);
		} catch {
			subframeAuthorizationRejected = true;
		}
		results.push({
			kind,
			intents,
			renderer,
			devToolsDisabled,
			reloadDenied: reloadStarts === 0,
			subframeAuthorizationRejected,
			preferences: pickPreferences(preferences)
		});
	}
	const integratedBrowser = await verifyIntegratedBrowser();
	if (authenticatedContents === undefined || candidateContents === undefined)
		throw new Error('rollback fixture windows are unavailable');
	const transactionalRollback = await verifyTransactionalRollback(
		authenticatedContents,
		candidateContents,
		root,
		html
	);
	for (const bridge of bridges.reverse()) bridge.dispose();
	for (const managed of managedWindows.reverse()) managed.destroy();
	launchIdentity.dispose();
	await verifyLaunchWindowScenario(root);
	await verifyLaunchWindowMenu();
	const chromeUpdateRecovery = verifyWindowChromeUpdateRecovery();
	clearTimeout(timeout);
	process.stdout.write(
		`${JSON.stringify({
			results,
			integratedBrowser,
			transactionalRollback,
			candidateSurface,
			candidateContentBounds,
			chromeUpdateRecovery,
			windowChromeOptions: {
				darwin: pickChromeOptions(
					lockedBrowserWindowOptions('launch', 'preload.cjs', true, undefined, {
						platform: 'darwin',
						locale: 'en',
						macOsRelease: '24.0.0',
						initialTheme: 'dark'
					})
				),
				darwinRtl: pickChromeOptions(
					lockedBrowserWindowOptions('launch', 'preload.cjs', true, undefined, {
						platform: 'darwin',
						locale: 'ar',
						macOsRelease: '25.0.0',
						initialTheme: 'dark'
					})
				),
				win32: pickChromeOptions(
					lockedBrowserWindowOptions('launch', 'preload.cjs', true, undefined, {
						platform: 'win32',
						locale: 'en',
						macOsRelease: '',
						initialTheme: 'dark'
					})
				),
				linux: pickChromeOptions(
					lockedBrowserWindowOptions('launch', 'preload.cjs', true, undefined, {
						platform: 'linux',
						locale: 'en',
						macOsRelease: '',
						initialTheme: 'dark'
					})
				),
				candidate: pickChromeOptions(
					lockedBrowserWindowOptions('candidate', 'preload.cjs', true, undefined, {
						platform: 'darwin',
						locale: 'en',
						macOsRelease: '24.0.0',
						initialTheme: 'dark'
					})
				)
			},
			runtimeIconForwarded:
				lockedBrowserWindowOptions('launch', 'preload.cjs', true, 'proctor.png').icon ===
				'proctor.png',
			applicationMenuRemoved: Menu.getApplicationMenu() === null
		})}\n`
	);
	app.exit(0);
}

async function verifyLaunchWindowMenu(): Promise<void> {
	const window = new BrowserWindow({
		show: false,
		webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
	});
	const originalBuild = Menu.buildFromTemplate;
	const originalDialog = dialog.showMessageBox;
	let menu: Menu | undefined;
	let shown = 0;
	let exits = 0;
	let finishDialog!: (value: { response: number; checkboxChecked: boolean }) => void;
	let details = '';
	Menu.buildFromTemplate = (template) => {
		menu = originalBuild(template);
		return menu;
	};
	dialog.showMessageBox = ((_window: BrowserWindow, options: Electron.MessageBoxOptions) => {
		shown++;
		details = options.detail ?? '';
		return new Promise((resolve) => {
			finishDialog = resolve;
		});
	}) as typeof dialog.showMessageBox;
	let owned: { dispose(): void } | undefined;
	try {
		owned = installLaunchWindowMenu(
			window,
			'en',
			() => ({
				protocolVersion: 1,
				revision: 1,
				state: 'checking',
				origin: 'https://example.edu',
				developmentOrigin: false,
				canSignIn: false,
				authorizationAvailable: false
			}),
			() => {
				exits++;
			}
		);
		if (!menu) throw new Error('Launch native menu was not created');
		const items = menu.items.flatMap((item) => item.submenu?.items ?? []);
		if (
			!items.some((item) => item.role === 'paste') ||
			!items.some((item) => item.role?.toLowerCase() === 'zoomin') ||
			items.some((item) =>
				['reload', 'forcereload', 'toggledevtools'].includes(item.role?.toLowerCase() ?? '')
			)
		)
			throw new Error('Launch menu lost native editing/zoom or exposed developer actions');
		if (process.platform !== 'darwin' && window.isMenuBarVisible())
			throw new Error('Launch menubar must start collapsed');
		const diagnostics = menu.getMenuItemById('prctr.launch.diagnostics');
		const quit = menu.getMenuItemById('prctr.launch.quit');
		if (!diagnostics || !quit) throw new Error('Launch native menu is missing its actions');
		diagnostics.click();
		diagnostics.click();
		if (
			shown !== 1 ||
			!details.includes('https://example.edu') ||
			!details.includes('Not verified')
		)
			throw new Error('Native diagnostics lost safe state or opened duplicate dialogs');
		quit.click();
		if (exits !== 1)
			throw new Error('Native exit must remain available during a pending check');
		owned.dispose();
		owned.dispose();
		quit.click();
		diagnostics.click();
		if (exits !== 1 || shown !== 1 || Menu.getApplicationMenu() === menu)
			throw new Error('Disposed Launch menu retained authority');
		finishDialog({ response: 0, checkboxChecked: false });
		await Promise.resolve();
	} finally {
		owned?.dispose();
		Menu.buildFromTemplate = originalBuild;
		dialog.showMessageBox = originalDialog;
		window.destroy();
	}
}

async function verifyTransactionalRollback(
	authenticatedContents: WebContents,
	candidateContents: WebContents,
	root: string,
	html: string
): Promise<unknown> {
	const terminalIpc = failingIpc(2);
	let terminalRejected = false;
	let terminalCloseCalls = 0;
	try {
		createTerminalComposition({
			scope: {
				attemptId: 'attempt-1',
				sessionId: 'session-1',
				connectionId: 'connection-1',
				participationGeneration: 1
			},
			gate: {
				attemptState: 'active',
				participationGeneration: 1,
				connectionId: 'connection-1',
				paused: false,
				postureUsable: true,
				environmentReady: true,
				executionProfileAdmitted: true,
				availability: 'enabled'
			},
			workspace: {
				captureGeneration: () => 1,
				persistThrough: async () => ({ acknowledged: true, cursor: 1, blockers: [] })
			},
			transport: {
				open: async () => ({ kind: 'transportUnavailable' }),
				send: async () => 'transportUnavailable',
				closeTransport: () => {
					terminalCloseCalls++;
				},
				dispose() {}
			},
			ids: { nextOpenRequestId: () => 'open-1' },
			ipcMain: terminalIpc.ipc,
			candidateContents
		});
	} catch (error) {
		terminalRejected =
			error instanceof Error && error.message === 'injected IPC registration failure';
	}
	const settingsIpc = failingIpc(3);
	let settingsRejected = false;
	try {
		await createUserSettingsComposition(settingsIpc.ipc, authenticatedContents, {
			binding: { principalId: 'principal-rollback', sessionId: 'session-rollback' },
			context: { window: 'authenticated' },
			authority: { commit: async () => ({ kind: 'unavailable' }) },
			cache: { load: async () => undefined, store: async () => {} },
			acknowledged: { source: '{}', revision: 'settings-1', registryVersion: 1 },
			writable: true
		});
	} catch (error) {
		settingsRejected =
			error instanceof Error && error.message === 'injected IPC registration failure';
	}
	const securityIpc = failingIpc(Number.POSITIVE_INFINITY);
	let securityRejected = false;
	const projection = {
		revision: 1,
		attemptState: 'active' as const,
		attemptRevision: 1,
		posture: 'checking' as const,
		participationGeneration: 1,
		leasePhase: 'connected' as const,
		paused: false,
		protectedWork: 'notRequired' as const,
		canJoin: false,
		canRetryChecks: true,
		canWorkspaceMutate: false,
		canUseBrowser: false,
		canUseTerminal: false,
		canSubmit: false,
		activeSecurityConditions: [
			{ reason: 'sourceCoverage' as const, state: 'checking' as const }
		],
		activeCorrections: [],
		authoritativeTimeUnixMs: 1
	};
	try {
		new ExamSecurityIpcBridge(securityIpc.ipc, candidateContents, {
			observe: () => ({
				current: projection,
				onDidChange: () => {
					throw new Error('injected security subscription failure');
				}
			}),
			handleIntent: async () => {}
		});
	} catch (error) {
		securityRejected =
			error instanceof Error && error.message === 'injected security subscription failure';
	}
	const productIpc = failingIpc(4);
	const windowsBefore = BrowserWindow.getAllWindows().length;
	let productRejected = false;
	try {
		new ElectronProductWindowFactory({
			production: true,
			rendererByKind: { launch: html, authenticated: html, candidate: html },
			preloadByKind: {
				launch: join(root, 'launchPreload.cjs'),
				authenticated: join(root, 'authenticatedPreload.cjs'),
				candidate: join(root, 'candidatePreload.cjs')
			},
			ipc: productIpc.ipc
		}).create(
			descriptor('launch'),
			() => {},
			() => {}
		);
	} catch (error) {
		productRejected =
			error instanceof Error && error.message === 'injected IPC registration failure';
	}
	return {
		terminal: {
			rejected: terminalRejected,
			handlersRemaining: terminalIpc.handlers.size,
			modelClosed: terminalCloseCalls === 1
		},
		settings: { rejected: settingsRejected, handlersRemaining: settingsIpc.handlers.size },
		security: { rejected: securityRejected, handlersRemaining: securityIpc.handlers.size },
		productWindow: {
			rejected: productRejected,
			handlersRemaining: productIpc.handlers.size,
			windowDestroyed: BrowserWindow.getAllWindows().length === windowsBefore
		}
	};
}

function failingIpc(failAt: number): { readonly ipc: IpcMain; readonly handlers: Set<string> } {
	const handlers = new Set<string>();
	let calls = 0;
	return {
		handlers,
		ipc: {
			handle(channel: string): void {
				calls++;
				if (calls === failAt) throw new Error('injected IPC registration failure');
				handlers.add(channel);
			},
			removeHandler(channel: string): void {
				handlers.delete(channel);
			}
		} as unknown as IpcMain
	};
}

async function verifyIntegratedBrowser(): Promise<unknown> {
	const requests: string[] = [];
	const server = createServer((request, response) => {
		const path = request.url ?? '/';
		requests.push(path);
		if (path === '/allowed/redirect') {
			response.writeHead(302, { location: '/allowed/redirect-target' });
			response.end();
			return;
		}
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<!doctype html><title>Allowed</title>');
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	if (address === null || typeof address === 'string')
		throw new Error('browser fixture address unavailable');
	const origin = `http://127.0.0.1:${address.port}`;
	const institutionOrigin = `https://127.0.0.1:${address.port}`;
	const policyInput = {
		schemaVersion: 1 as const,
		attemptId: 'attempt-1',
		participationGeneration: 1,
		revision: 'browser-1',
		ordinal: 1,
		digest: 'sha256:abcdefgh',
		rules: [
			{
				id: 'fixture',
				origin,
				pathPrefix: '/allowed',
				allowRedirects: false,
				blockedConsequence: 'activity' as const,
				institutionHttpException: true
			}
		]
	};
	const policy = validateBrowserPolicy(policyInput, { institutionOrigin });
	const records: BrowserActivityRecord[] = [];
	const sink: BrowserActivitySink = {
		scope: Object.freeze({
			attemptId: policy.attemptId,
			participationGeneration: policy.participationGeneration,
			policyRevision: policy.revision,
			policyDigest: policy.digest
		}),
		append(kind: BrowserActivityKind, details = {}) {
			const record = {
				sourceInstanceId: 'source-1',
				sequence: records.length + 1,
				participationGeneration: 1,
				kind,
				clientOccurredAtMs: 1,
				...details
			} as BrowserActivityRecord;
			records.push(record);
			return record;
		},
		seal(): BrowserActivitySeal {
			return {
				sourceInstanceId: 'source-1',
				participationGeneration: 1,
				highestAcknowledged: 0,
				finalSequence: records.length,
				gaps: [],
				sealed: true
			};
		},
		async flush() {},
		dispose() {}
	};
	const window = new BrowserWindow({
		show: false,
		webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
	});
	let coordinator: IntegratedBrowserCoordinator;
	let lastSurface: IntegratedBrowserSurface | undefined;
	const surfaceFocus: boolean[] = [];
	const delegate: BrowserEnforcementDelegate = {
		checkTopLevel: (...args) => coordinator.checkTopLevel(...args),
		commitTopLevel: (...args) => coordinator.commitTopLevel(...args),
		checkSubresource: (url) => coordinator.checkSubresource(url),
		blockPopup: (url) => coordinator.blockPopup(url)
	};
	const rollback = await verifyIntegratedBrowserCompositionRollback(
		window,
		policyInput,
		institutionOrigin
	);
	const created = await createElectronBrowserView(
		'prctr-browser-window-skeleton-1',
		{
			updateSurface: (view, surface) => {
				lastSurface = surface;
				surfaceFocus.push(surface.focus);
				if (surface.bounds.width > 0 && surface.bounds.height > 0)
					view.setBounds(surface.bounds);
				view.setVisible(surface.visible);
				if (surface.focus) view.webContents.focus();
			},
			detachAndDestroy: (view) => {
				window.contentView.removeChildView(view);
				if (!view.webContents.isDestroyed()) view.webContents.close();
			}
		},
		delegate
	);
	window.contentView.addChildView(created.view);
	coordinator = new IntegratedBrowserCoordinator(
		policy,
		{
			attemptState: 'active',
			participationGeneration: 1,
			paused: false,
			posture: 'compliant',
			coordinatorAvailable: true
		},
		created.engine,
		sink,
		{ create: async () => sink },
		institutionOrigin
	);
	created.engine.setSurface({
		visible: true,
		focus: false,
		bounds: { x: 8, y: 12, width: 640, height: 480 }
	});
	await coordinator.handleIntent({ kind: 'browser.open', startRuleId: 'fixture' });
	const originalUnexpectedErrorHandler = errorHandler.getUnexpectedErrorHandler();
	const focusObserverErrors: unknown[] = [];
	setUnexpectedErrorHandler((error) => focusObserverErrors.push(error));
	const throwingFocusObserver = created.engine.onDidChangeSurfaceFocus(() => {
		throw new Error('injected focus observer failure');
	});
	created.engine.setSurface({
		visible: true,
		focus: true,
		bounds: { x: 8, y: 12, width: 640, height: 480 }
	});
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	throwingFocusObserver.dispose();
	setUnexpectedErrorHandler(originalUnexpectedErrorHandler);
	await coordinator.updateGate({
		attemptState: 'active',
		participationGeneration: 1,
		paused: true,
		posture: 'compliant',
		coordinatorAvailable: true
	});
	await coordinator.updateGate({
		attemptState: 'active',
		participationGeneration: 1,
		paused: false,
		posture: 'compliant',
		coordinatorAvailable: true
	});
	const popupDenied = (await created.view.webContents.executeJavaScript(
		"window.open('https://example.com') === null",
		true
	)) as boolean;
	const permissionDenied = (await created.view.webContents.executeJavaScript(
		"navigator.permissions.query({ name: 'geolocation' }).then(value => value.state === 'denied')",
		true
	)) as boolean;
	const subresourceBlocked = (await created.view.webContents.executeJavaScript(
		`fetch('${origin}/secret').then(() => false, () => true)`,
		true
	)) as boolean;
	await coordinator
		.handleIntent({ kind: 'browser.navigate', url: `${origin}/allowed/redirect` })
		.catch(() => {});
	await coordinator.handleIntent({
		kind: 'browser.navigate',
		url: 'mailto:private@example.test'
	});
	created.view.webContents.openDevTools({ mode: 'detach', activate: false });
	await new Promise<void>((resolve) => setTimeout(resolve, 50));
	const preferences = (
		created.view.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }
	).getLastWebPreferences();
	const result = {
		popupDenied,
		permissionDenied,
		subresourceBlocked,
		secretContacted: requests.includes('/secret'),
		redirectTargetContacted: requests.includes('/allowed/redirect-target'),
		devToolsDisabled: !created.view.webContents.isDevToolsOpened(),
		sandbox: preferences.sandbox,
		surfaceVisible: lastSurface?.visible,
		surfaceBounds: lastSurface?.bounds,
		surfaceFocusedOnce: surfaceFocus.includes(true),
		surfaceFocusReleased: lastSurface?.focus === false,
		focusObserverReported: focusObserverErrors.length > 0,
		activityKinds: records.map((record) => record.kind),
		activityContainsSensitivePayload: JSON.stringify(records).includes('private@example.test')
	};
	await coordinator.closeBrowser();
	await coordinator.dispose();
	if (!window.isDestroyed()) window.destroy();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return { ...result, compositionRollback: rollback };
}

async function verifyIntegratedBrowserCompositionRollback(
	window: BrowserWindow,
	policy: BrowserPolicyInput,
	institutionOrigin: string
): Promise<unknown> {
	const handlers = new Set<string>();
	let handleCalls = 0;
	let detached = 0;
	let activityDisposed = 0;
	let rolledBackContents: WebContents | undefined;
	const failingIpc = {
		handle(channel: string): void {
			handleCalls++;
			if (handleCalls === 2) throw new Error('injected IPC registration failure');
			handlers.add(channel);
		},
		removeHandler(channel: string): void {
			handlers.delete(channel);
		}
	} as unknown as IpcMain;
	const activity: BrowserActivitySink = {
		scope: Object.freeze({
			attemptId: policy.attemptId,
			participationGeneration: policy.participationGeneration,
			policyRevision: policy.revision,
			policyDigest: policy.digest
		}),
		append() {
			throw new Error('rollback fixture must not append activity');
		},
		seal(): BrowserActivitySeal {
			return {
				sourceInstanceId: 'rollback-source',
				participationGeneration: policy.participationGeneration,
				highestAcknowledged: 0,
				finalSequence: 0,
				gaps: [],
				sealed: true
			};
		},
		async flush() {},
		dispose() {
			activityDisposed++;
		}
	};
	let rejected = false;
	try {
		await createIntegratedBrowserComposition({
			partition: 'prctr-browser-rollback-fixture-1',
			institutionOrigin,
			policy,
			gate: {
				attemptState: 'active',
				participationGeneration: policy.participationGeneration,
				paused: false,
				posture: 'compliant',
				coordinatorAvailable: true
			},
			activity,
			activityFactory: { create: async () => activity },
			host: {
				updateSurface() {},
				detachAndDestroy(view) {
					detached++;
					rolledBackContents = view.webContents;
					if (!view.webContents.isDestroyed()) view.webContents.close();
				}
			},
			ipcMain: failingIpc,
			candidateContents: window.webContents
		});
	} catch (error) {
		rejected = error instanceof Error && error.message === 'injected IPC registration failure';
	}
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	return {
		rejected,
		handlersRemaining: handlers.size,
		detached,
		activityDisposed,
		destroyed: rolledBackContents?.isDestroyed() === true
	};
}

function descriptor(kind: ProductWindowKind): ProductWindowDescriptor {
	if (kind === 'launch')
		return {
			protocolVersion: 1,
			kind,
			windowId: 'launch-1',
			institutionOrigin: 'https://example.edu'
		};
	const common = {
		protocolVersion: 1 as const,
		windowId: `${kind}-1`,
		institutionOrigin: 'https://example.edu',
		principalId: 'principal-1',
		sessionId: 'session-1'
	};
	if (kind === 'authenticated') return { ...common, kind, initialDestination: 'home' };
	return {
		...common,
		kind,
		attemptId: 'attempt-1',
		attemptConfigurationRevision: 'config-1',
		attemptConfigurationDigest: 'sha256:abcdefgh'
	};
}

function pickPreferences(value: Record<string, unknown>): unknown {
	return {
		allowRunningInsecureContent: value.allowRunningInsecureContent,
		contextIsolation: value.contextIsolation,
		nodeIntegration: value.nodeIntegration,
		nodeIntegrationInSubFrames: value.nodeIntegrationInSubFrames,
		nodeIntegrationInWorker: value.nodeIntegrationInWorker,
		sandbox: value.sandbox,
		webSecurity: value.webSecurity,
		webviewTag: value.webviewTag
	};
}

function verifyWindowChromeUpdateRecovery(): {
	readonly overlayAttempts: number;
	readonly dimmedOverlay: unknown;
	readonly trafficLightAttempts: number;
	readonly sheetAttempts: number;
} {
	const overlay = createChromeBridgeFixture('win32');
	overlay.failOverlay();
	invokeChromeUpdate(overlay.handlers, 36);
	invokeChromeUpdate(overlay.handlers, 36);
	invokeChromeUpdate(overlay.handlers, 36, true);
	overlay.bridge.dispose();

	const trafficLights = createChromeBridgeFixture('darwin');
	trafficLights.failSheet();
	invokeChromeUpdate(trafficLights.handlers, 40);
	invokeChromeUpdate(trafficLights.handlers, 40);
	trafficLights.bridge.dispose();
	return {
		overlayAttempts: overlay.overlayAttempts(),
		dimmedOverlay: overlay.lastOverlay(),
		trafficLightAttempts: trafficLights.trafficLightAttempts(),
		sheetAttempts: trafficLights.sheetAttempts()
	};
}

function createChromeBridgeFixture(platform: 'darwin' | 'win32'): {
	readonly bridge: ElectronWindowChromeBridge;
	readonly handlers: Map<string, (event: IpcMainInvokeEvent, value: unknown) => unknown>;
	failOverlay(): void;
	failSheet(): void;
	overlayAttempts(): number;
	lastOverlay(): unknown;
	trafficLightAttempts(): number;
	sheetAttempts(): number;
} {
	const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => unknown>();
	let overlayAttempts = 0;
	let lastOverlay: unknown;
	let trafficLightAttempts = 0;
	let sheetAttempts = 0;
	let overlayMustFail = false;
	let sheetMustFail = false;
	const windowTarget: ElectronWindowChromeTarget['window'] = {
		isFullScreen: () => false,
		isDestroyed: () => false,
		off: () => undefined,
		on: () => undefined,
		setSheetOffset: () => {
			sheetAttempts++;
			if (sheetMustFail) {
				sheetMustFail = false;
				throw new Error('injected sheet failure');
			}
		},
		setTitleBarOverlay: (options) => {
			overlayAttempts++;
			lastOverlay = options;
			if (overlayMustFail) {
				overlayMustFail = false;
				throw new Error('injected overlay failure');
			}
		},
		setWindowButtonPosition: () => {
			trafficLightAttempts++;
		}
	};
	const target: ElectronWindowChromeTarget = {
		window: windowTarget,
		contents: {
			id: 1,
			isDestroyed: () => false,
			mainFrame: {} as WebContents['mainFrame'],
			send: () => undefined
		}
	};
	const bridge = new ElectronWindowChromeBridge(
		{
			handle: (channel, listener) => {
				handlers.set(channel, listener);
			},
			removeHandler: (channel) => {
				handlers.delete(channel);
			}
		} as Pick<typeof ipcMain, 'handle' | 'removeHandler'>,
		target,
		'launch',
		resolveProductWindowChromeConfiguration(platform, 'en', '24.0.0'),
		'light',
		() => undefined
	);
	return {
		bridge,
		handlers,
		failOverlay: () => {
			overlayMustFail = true;
		},
		failSheet: () => {
			sheetMustFail = true;
		},
		overlayAttempts: () => overlayAttempts,
		lastOverlay: () => lastOverlay,
		trafficLightAttempts: () => trafficLightAttempts,
		sheetAttempts: () => sheetAttempts
	};
}

function invokeChromeUpdate(
	handlers: ReadonlyMap<string, (event: IpcMainInvokeEvent, value: unknown) => unknown>,
	titlebarHeight: number,
	dimmed = false
): void {
	const update = handlers.get(WINDOW_CHROME_CHANNELS.launch.update);
	if (update === undefined) throw new Error('Window chrome update handler is unavailable');
	try {
		update({} as IpcMainInvokeEvent, {
			protocolVersion: 1,
			theme: 'dark',
			titlebarHeight,
			dimmed
		});
	} catch (error) {
		if (
			!(error instanceof Error) ||
			(error.message !== 'injected overlay failure' &&
				error.message !== 'injected sheet failure')
		)
			throw error;
	}
}

function pickChromeOptions(value: Electron.BrowserWindowConstructorOptions): unknown {
	return {
		width: value.width,
		height: value.height,
		minWidth: value.minWidth,
		minHeight: value.minHeight,
		title: value.title,
		backgroundColor: value.backgroundColor,
		frame: value.frame,
		titleBarStyle: value.titleBarStyle,
		titleBarOverlay: value.titleBarOverlay,
		acceptFirstMouse: value.acceptFirstMouse,
		closable: value.closable,
		fullscreenable: value.fullscreenable,
		maximizable: value.maximizable,
		minimizable: value.minimizable,
		movable: value.movable,
		resizable: value.resizable
	};
}

function fail(error: unknown): void {
	clearTimeout(timeout);
	process.stdout.write(
		`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`
	);
	app.exit(1);
}
