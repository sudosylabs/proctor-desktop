import { runModernWorkbenchTests } from './modernWorkbenchTests.ts';
import { runAccountTests } from './accountTests.ts';
import { createAccountContribution } from '../../src/prctr/workbench/contrib/account/browser/accountContribution.ts';
import {
	CancellationToken,
	type CancellationToken as CancellationTokenType
} from '../../src/prctr/base/common/cancellation.ts';
import { Event as BaseEvent } from '../../src/prctr/base/common/event.ts';
import { DisposableStore } from '../../src/prctr/base/common/lifecycle.ts';
import {
	bootstrapWorkbench,
	type WorkbenchBootstrapContext,
	type WorkbenchContributionRegistration
} from '../../src/prctr/workbench/browser/bootstrap.ts';
import { authenticatedComposition } from '../../src/prctr/workbench/browser/authenticatedManifest.ts';
import { candidateComposition } from '../../src/prctr/workbench/browser/candidateManifest.ts';
import { bootstrapLaunchWindow } from '../../src/prctr/workbench/browser/launchWindow.ts';
import { WorkbenchPaneHost } from '../../src/prctr/workbench/browser/paneHost.ts';
import {
	WorkbenchItemResolverRegistry,
	type WorkbenchPane
} from '../../src/prctr/workbench/browser/workbenchPane.ts';
import {
	WorkbenchShell,
	type WorkbenchShellLabels
} from '../../src/prctr/workbench/browser/workbenchShell.ts';
import type {
	ResolvedWorkbenchItem,
	WorkbenchItem
} from '../../src/prctr/workbench/common/workbenchItem.ts';
import { createAuthenticatedContribution } from '../../src/prctr/workbench/contrib/authenticated/browser/authenticatedContribution.ts';
import { createExamSecurityContribution } from '../../src/prctr/workbench/contrib/examSecurity/browser/examSecurityContribution.ts';
import { createIntegratedBrowserContribution } from '../../src/prctr/workbench/contrib/integratedBrowser/browser/integratedBrowserContribution.ts';
import { createSettingsContribution } from '../../src/prctr/workbench/contrib/settings/browser/settingsContribution.ts';
import { commonWorkbenchContributions } from '../../src/prctr/workbench/workbench.common.main.ts';
import { createDesktopWorkbenchContribution } from '../../src/prctr/code/electron-browser/workbench.desktop.main.ts';
import type {
	IntegratedBrowserIntent,
	IntegratedBrowserProjection,
	IntegratedBrowserSurface
} from '../../src/prctr/platform/integratedBrowser/common/browserProtocol.ts';
import type { UserSettingsProjection } from '../../src/prctr/platform/settings/common/settingsRendererProtocol.ts';
import { BrowserThemeService } from '../../src/prctr/platform/theme/browser/themeService.ts';
import type {
	ProductWindowChromeClient,
	ProductWindowChromeUpdate
} from '../../src/prctr/platform/windows/common/windowChrome.ts';
import { ContextKeyService } from '../../src/prctr/platform/contextkey/browser/contextKeyService.ts';
import type { IContextKeyService } from '../../src/prctr/platform/contextkey/common/contextkey.ts';
import { isMacintosh } from '../../src/prctr/base/common/platform.ts';
import {
	WorkbenchFocusedPartContext,
	WorkbenchLifecyclePhaseContext,
	WorkbenchModalContext,
	WorkbenchWindowKindContext
} from '../../src/prctr/workbench/common/contextKeys.ts';
import { WORKBENCH_CONTEXT_KEY_SERVICE } from '../../src/prctr/workbench/common/serviceIds.ts';
import type {
	CandidateLiveCorrection,
	CandidateSecurityProjection,
	SecureExamPosture
} from '../../src/prctr/workbench/services/examSecurity/common/securityProjectionProtocol.ts';

const labels: WorkbenchShellLabels = {
	titlebar: 'Window controls',
	banner: 'Notices',
	navigation: 'Navigation',
	sidebar: 'Workspace files',
	content: 'Workspace content',
	panel: 'Terminal',
	status: 'Status',
	resetLayout: 'Reset layout',
	resizeSidebar: 'Resize sidebar',
	resizePanel: 'Resize panel'
};

function testWindowChromeClient(updates?: ProductWindowChromeUpdate[]): ProductWindowChromeClient {
	return Object.freeze({
		configuration: async () =>
			Object.freeze({
				protocolVersion: 1,
				platform: 'win32',
				mode: 'nativeOverlay',
				controlsLocation: 'right',
				titlebarHeight: 35,
				fullscreen: false
			}),
		onDidChangeFullscreen: () => ({ dispose() {} }),
		zoomFactor: () => 1,
		update: async (update: ProductWindowChromeUpdate) => {
			updates?.push(update);
		}
	});
}

export async function runWorkbenchKernelBrowserTests(document: Document): Promise<number> {
	await runModernWorkbenchTests(document, labels);
	await runAccountTests(document);
	await runThemePreferenceTest(document);
	await runExecutableKernelTest(document);
	await runMigratedSettingsDestinationTest(document);
	await runWindowBindingFailureTests(document);
	await runSettingsCancelFailureTest(document);
	await runPaneHostClearFailureTest(document);
	const host = document.createElement('div');
	host.style.blockSize = '720px';
	host.style.inlineSize = '1024px';
	document.body.append(host);
	const shell = new WorkbenchShell(host, candidateComposition, labels);
	shell.element.dir = 'ltr';
	if (shell.element.querySelectorAll('[data-part]').length !== 7)
		throw new Error('Candidate shell structural regions are incomplete');
	const sidebarSash = shell.element.querySelector<HTMLElement>('[data-sash="sidebar"]');
	if (sidebarSash === null) throw new Error('Sidebar separator is absent');
	const initial = sidebarSash.getAttribute('aria-valuenow');
	sidebarSash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	if (sidebarSash.getAttribute('aria-valuenow') === initial)
		throw new Error('Keyboard separator did not resize');
	sidebarSash.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
	host.style.inlineSize = '1400px';
	shell.layout();
	for (let index = 0; index < 9; index++)
		sidebarSash.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
		);
	const preferredSidebarSize = sidebarSash.getAttribute('aria-valuenow');
	host.style.inlineSize = '800px';
	shell.layout();
	const clampedSidebar = {
		value: sidebarSash.getAttribute('aria-valuenow'),
		maximum: sidebarSash.getAttribute('aria-valuemax'),
		css: shell.element.style.getPropertyValue('--prctr-workbench-sidebar-size'),
		clientWidth: shell.element.clientWidth
	};
	if (
		clampedSidebar.value !== '400' ||
		clampedSidebar.maximum !== '400' ||
		clampedSidebar.css !== '400px'
	)
		throw new Error(
			`Workbench resize did not clamp the effective sidebar and separator semantics: ${JSON.stringify(clampedSidebar)}`
		);
	host.style.inlineSize = '1400px';
	shell.layout();
	if (sidebarSash.getAttribute('aria-valuenow') !== preferredSidebarSize)
		throw new Error(
			'Workbench resize did not restore the preferred sidebar after constraints relaxed'
		);
	host.style.inlineSize = '1024px';
	shell.resetLayout();
	shell.element.dir = 'rtl';
	shell.layout();
	sidebarSash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
	if (sidebarSash.getAttribute('aria-valuenow') !== '270')
		throw new Error('RTL keyboard separator did not enlarge toward the content');
	sidebarSash.setPointerCapture = () => {};
	sidebarSash.dispatchEvent(
		new PointerEvent('pointerdown', { button: 0, clientX: 100, pointerId: 1, bubbles: true })
	);
	sidebarSash.dispatchEvent(
		new PointerEvent('pointermove', { clientX: 90, pointerId: 1, bubbles: true })
	);
	sidebarSash.dispatchEvent(
		new PointerEvent('pointerup', { clientX: 90, pointerId: 1, bubbles: true })
	);
	if (sidebarSash.getAttribute('aria-valuenow') !== '280')
		throw new Error('RTL pointer separator did not enlarge toward the content');
	shell.element.dir = 'ltr';
	shell.resetLayout();
	const priorFocus = document.createElement('button');
	priorFocus.textContent = 'prior';
	shell.part('content').append(priorFocus);
	priorFocus.focus();
	let requested = 0;
	const overlay = shell.overlayHost.show({
		kind: 'dialog',
		title: 'Confirm',
		message: 'Continue?',
		accessibleLabel: 'Confirmation',
		dismissOnEscape: true,
		actions: [
			{ id: 'continue', label: 'Continue', variant: 'primary', onRequest: () => requested++ }
		]
	});
	await Promise.resolve();
	if (!shell.element.inert) throw new Error('Modal overlay did not inert the workbench');
	const action = shell.overlayHost.element.querySelector<HTMLButtonElement>('button');
	action?.click();
	if (requested !== 1 || shell.element.inert) throw new Error('Dialog action or teardown failed');
	overlay.dispose();
	if (document.activeElement !== priorFocus) throw new Error('Dialog did not restore focus');
	const disabledPrior = document.createElement('button');
	disabledPrior.textContent = 'disabled prior';
	shell.part('content').append(disabledPrior);
	disabledPrior.focus();
	shell.overlayHost.show({
		kind: 'dialog',
		title: 'Confirm',
		message: 'Continue?',
		accessibleLabel: 'Confirmation',
		actions: [{ id: 'continue', label: 'Continue', variant: 'primary', onRequest: () => {} }]
	});
	await Promise.resolve();
	disabledPrior.disabled = true;
	shell.overlayHost.element.querySelector<HTMLButtonElement>('button')?.click();
	if (
		document.activeElement === disabledPrior ||
		document.activeElement === document.body ||
		!shell.element.contains(document.activeElement)
	)
		throw new Error(
			'Dialog restored focus to a disabled target or lost the workbench fallback'
		);
	const hiddenPrior = document.createElement('button');
	hiddenPrior.textContent = 'hidden prior';
	shell.part('content').append(hiddenPrior);
	hiddenPrior.focus();
	shell.overlayHost.show({
		kind: 'dialog',
		title: 'Confirm',
		message: 'Continue?',
		accessibleLabel: 'Confirmation',
		actions: [{ id: 'continue', label: 'Continue', variant: 'primary', onRequest: () => {} }]
	});
	await Promise.resolve();
	hiddenPrior.hidden = true;
	shell.overlayHost.element.querySelector<HTMLButtonElement>('button')?.click();
	if (
		document.activeElement === hiddenPrior ||
		document.activeElement === document.body ||
		!shell.element.contains(document.activeElement)
	)
		throw new Error('Dialog restored focus to a hidden target or lost the workbench fallback');
	const paneHostElement = document.createElement('div');
	shell.part('content').append(paneHostElement);
	const registry = new WorkbenchItemResolverRegistry();
	const deferred: Array<() => void> = [];
	let disposedModels = 0;
	const pane = new TestPane(document);
	registry.register({
		typeId: 'test',
		resolve: (item) =>
			new Promise((resolve) =>
				deferred.push(() => resolve({ item, dispose: () => disposedModels++ }))
			),
		createPane: () => pane
	});
	const paneHost = new WorkbenchPaneHost(paneHostElement, registry);
	const first = paneHost.assign(createItem('first'));
	const second = paneHost.assign(createItem('second'));
	const resolveFirst = deferred[0];
	const resolveSecond = deferred[1];
	if (resolveFirst === undefined || resolveSecond === undefined)
		throw new Error('Resolver did not create assignments');
	resolveFirst();
	resolveSecond();
	await Promise.all([first, second]);
	const disposedCount = (): number => disposedModels;
	if (pane.identity !== 'second' || disposedCount() !== 1)
		throw new Error('Pane host did not fence a stale assignment');
	let releaseActiveClear = () => {};
	pane.clearBarrier = new Promise<void>((resolve) => {
		releaseActiveClear = resolve;
	});
	paneHost.dispose();
	await waitFor(() => pane.clearCalls === 1);
	if (disposedCount() !== 1)
		throw new Error('Pane host disposed its model before the pane released it');
	releaseActiveClear();
	await waitFor(() => disposedCount() === 2);
	const blockedRegistry = new WorkbenchItemResolverRegistry();
	const blockedPane = new TestPane(document);
	blockedRegistry.register({
		typeId: 'test',
		resolve: (item) =>
			item.logicalIdentity === 'never'
				? new Promise<ResolvedWorkbenchItem>(() => {})
				: Promise.resolve({ item, dispose() {} }),
		createPane: () => blockedPane
	});
	const blockedHost = new WorkbenchPaneHost(paneHostElement, blockedRegistry);
	void blockedHost.assign(createItem('never'));
	const currentAssignment = await blockedHost.assign(createItem('current'));
	if (!currentAssignment || blockedPane.identity !== 'current')
		throw new Error('A superseded nonsettling resolver blocked the current pane assignment');
	blockedHost.dispose();
	const slowRegistry = new WorkbenchItemResolverRegistry();
	const slowPane = new SlowPane(document);
	slowRegistry.register({
		typeId: 'test',
		resolve: async (item) => ({ item, dispose() {} }),
		createPane: () => slowPane
	});
	const slowHost = new WorkbenchPaneHost(paneHostElement, slowRegistry);
	const slowFirst = slowHost.assign(createItem('slow-first'));
	await waitFor(() => slowPane.releases.length === 1);
	const slowSecond = slowHost.assign(createItem('slow-second'));
	await Promise.resolve();
	await Promise.resolve();
	if (slowPane.releases.length !== 1)
		throw new Error('Pane host allowed overlapping asynchronous pane assignments');
	slowPane.releases.shift()?.();
	await waitFor(() => slowPane.releases.length === 1);
	slowPane.releases.shift()?.();
	await Promise.all([slowFirst, slowSecond]);
	if (slowPane.identity !== 'slow-second')
		throw new Error('A stale asynchronous assignment cleared the current pane');
	slowHost.dispose();
	const failureRegistry = new WorkbenchItemResolverRegistry();
	const failurePane = new TestPane(document);
	failurePane.failSetItem = true;
	failurePane.failClear = true;
	let failedModelDisposed = false;
	failureRegistry.register({
		typeId: 'fail',
		resolve: async (item) => ({
			item,
			dispose: () => {
				failedModelDisposed = true;
			}
		}),
		createPane: () => failurePane
	});
	const failureHost = new WorkbenchPaneHost(paneHostElement, failureRegistry);
	await failureHost.assign({ ...createItem('failed'), typeId: 'fail' }).then(
		() => {
			throw new Error('Failed pane assignment resolved');
		},
		() => {}
	);
	if (!failedModelDisposed || failureHost.element.childElementCount !== 0)
		throw new Error('Failed pane assignment and cleanup retained model or pane ownership');
	failureHost.dispose();
	const ownershipRegistry = new WorkbenchItemResolverRegistry();
	let ownedPanes = 0;
	ownershipRegistry.register({
		typeId: 'test',
		resolve: async (item) => ({ item, dispose() {} }),
		createPane: () => {
			ownedPanes++;
			return new TestPane(document);
		}
	});
	ownershipRegistry.register({
		typeId: 'create-failure',
		resolve: async (item) => ({ item, dispose() {} }),
		createPane: () => {
			throw new Error('create failed');
		}
	});
	const ownershipHost = new WorkbenchPaneHost(paneHostElement, ownershipRegistry);
	await ownershipHost.assign(createItem('owned'));
	await ownershipHost.assign({ ...createItem('broken'), typeId: 'create-failure' }).then(
		() => {
			throw new Error('Pane construction failure resolved');
		},
		() => {}
	);
	if (ownershipHost.element.childElementCount !== 0)
		throw new Error('Failed pane construction left relinquished DOM visible');
	await ownershipHost.assign(createItem('owned-again'));
	if (ownedPanes !== 2) throw new Error('Pane construction failure retained a disposed pane');
	ownershipHost.dispose();
	const sameClearFailureRegistry = new WorkbenchItemResolverRegistry();
	const sameClearFailurePane = new TestPane(document);
	let staleModelDisposed = false;
	let replacementModelDisposed = false;
	sameClearFailureRegistry.register({
		typeId: 'test',
		resolve: async (item) => ({
			item,
			dispose: () => {
				if (item.logicalIdentity === 'stale') staleModelDisposed = true;
				else replacementModelDisposed = true;
			}
		}),
		createPane: () => sameClearFailurePane
	});
	const sameClearFailureHost = new WorkbenchPaneHost(paneHostElement, sameClearFailureRegistry);
	await sameClearFailureHost.assign(createItem('stale'));
	sameClearFailurePane.failClear = true;
	await sameClearFailureHost.assign(createItem('replacement')).then(
		() => {
			throw new Error('Same-type pane clear failure resolved');
		},
		() => {}
	);
	if (
		!staleModelDisposed ||
		!replacementModelDisposed ||
		sameClearFailureHost.element.childElementCount !== 0
	)
		throw new Error('Same-type pane clear failure retained stale DOM or model ownership');
	sameClearFailureHost.dispose();
	const clearFailureRegistry = new WorkbenchItemResolverRegistry();
	const clearFailurePane = new TestPane(document);
	clearFailureRegistry.register({
		typeId: 'test',
		resolve: async (item) => ({ item, dispose() {} }),
		createPane: () => clearFailurePane
	});
	clearFailureRegistry.register({
		typeId: 'other',
		resolve: async (item) => ({ item, dispose() {} }),
		createPane: () => new TestPane(document)
	});
	const clearFailureHost = new WorkbenchPaneHost(paneHostElement, clearFailureRegistry);
	await clearFailureHost.assign(createItem('clear-failure'));
	clearFailurePane.failClear = true;
	await clearFailureHost.assign({ ...createItem('other'), typeId: 'other' }).then(
		() => {
			throw new Error('Pane clear failure resolved');
		},
		() => {}
	);
	if (clearFailureHost.element.childElementCount !== 0)
		throw new Error('Pane clear failure left relinquished DOM visible');
	clearFailureHost.dispose();
	const cancelledRegistry = new WorkbenchItemResolverRegistry();
	const cancelledPane = new TestPane(document);
	let releaseClear = () => {};
	cancelledPane.clearBarrier = new Promise<void>((resolve) => {
		releaseClear = resolve;
	});
	let replacementPanes = 0;
	cancelledRegistry.register({
		typeId: 'test',
		resolve: async (item) => ({ item, dispose() {} }),
		createPane: () => cancelledPane
	});
	cancelledRegistry.register({
		typeId: 'other',
		resolve: async (item) => ({ item, dispose() {} }),
		createPane: () => {
			replacementPanes++;
			return new TestPane(document);
		}
	});
	const cancelledHost = new WorkbenchPaneHost(paneHostElement, cancelledRegistry);
	await cancelledHost.assign(createItem('before-dispose'));
	const cancelledAssignment = cancelledHost.assign({
		...createItem('after-dispose'),
		typeId: 'other'
	});
	await waitFor(() => cancelledPane.clearCalls > 0);
	cancelledHost.dispose();
	releaseClear();
	if (await cancelledAssignment)
		throw new Error('Disposed pane host accepted a stale type replacement');
	if (replacementPanes !== 0)
		throw new Error('Disposed pane host constructed a replacement after awaited cleanup');
	shell.dispose();
	host.remove();
	const launchDocument = document.implementation.createHTMLDocument('launch');
	let bootstrapCalls = 0;
	let signInCalls = 0;
	const launch = await bootstrapLaunchWindow(launchDocument, {
		bootstrap: async () => {
			bootstrapCalls++;
			return {
				protocolVersion: 1,
				kind: 'launch',
				windowId: 'launch:test',
				institutionOrigin: 'https://institution.example.test'
			};
		},
		windowChrome: testWindowChromeClient(),
		identity: {
			projection: async () => ({
				protocolVersion: 1,
				revision: 1,
				state: 'ready',
				origin: 'https://institution.example.test',
				institutionName: 'Example University',
				developmentOrigin: false,
				canSignIn: true,
				authorizationAvailable: true
			}),
			onDidChange: () => ({ dispose() {} }),
			selectServer: async () => {},
			retry: async () => {},
			changeServer: async () => {},
			signIn: async () => {
				signInCalls++;
			}
		},
		exit: async () => {}
	});
	const launchSurface = launchDocument.body.querySelector<HTMLElement>('.prctr-launch-window');
	if (
		bootstrapCalls !== 1 ||
		launchSurface === null ||
		launchSurface.closest('.prctr-workbench') !== null
	)
		throw new Error('Minimal LaunchWindow surface did not activate independently');
	const launchActions = launchSurface.querySelectorAll<HTMLButtonElement>(
		'.prctr-launch-window__actions button'
	);
	if (
		launchActions.length !== 3 ||
		launchActions[0]?.disabled ||
		!launchActions[1]?.hidden ||
		launchActions[2]?.dataset.variant !== 'secondary'
	)
		throw new Error('LaunchWindow did not render its executable actions');
	launchActions[0]?.click();
	await Promise.resolve();
	await Promise.resolve();
	if (signInCalls !== 1)
		throw new Error('Launch sign-in action did not reach its preload client');
	launch.disposables.dispose();
	const launchRecovery = createDarkForcedColorsFrame(document);
	await bootstrapLaunchWindow(launchRecovery.document, {
		bootstrap: async () => {
			throw new Error('failed');
		},
		windowChrome: testWindowChromeClient(),
		identity: {
			projection: async () => {
				throw new Error('unavailable');
			},
			onDidChange: () => ({ dispose() {} }),
			selectServer: async () => {},
			retry: async () => {},
			changeServer: async () => {},
			signIn: async () => {}
		},
		exit: async () => {}
	}).then(
		() => {
			throw new Error('Failed LaunchWindow bootstrap was accepted');
		},
		() => {}
	);
	const launchRecoverySurface = launchRecovery.document.body.querySelector<HTMLElement>(
		'[data-launch-recovery="true"]'
	);
	if (
		launchRecoverySurface?.classList.contains('prctr-startup-surface') !== true ||
		launchRecovery.document.documentElement.dataset.prctrTheme !== 'dark' ||
		launchRecovery.document.documentElement.dataset.prctrForcedColors !== 'active'
	)
		throw new Error(
			'LaunchWindow bootstrap recovery did not retain its owned dark forced-colors presentation'
		);
	launchRecovery.frame.remove();
	const settingsFrame = document.createElement('iframe');
	document.body.append(settingsFrame);
	const settingsDocument = settingsFrame.contentDocument;
	if (settingsDocument === null) throw new Error('Settings test frame has no document');
	let committedSource = '';
	let committedRevision = '';
	let commitCalls = 0;
	let releaseCommit = (): void => {};
	let commitBarrier: Promise<void> | undefined;
	let previewedSource = '';
	let previewCalls = 0;
	let previewCancels = 0;
	let commitFails = false;
	const defaultPresentation = Object.freeze({
		theme: 'dark' as const,
		zoomPercent: 100,
		reducedMotion: false
	});
	const settingsProjection: UserSettingsProjection = {
		source: '{\n  // retained\n  "editor.fontSize": 14\n}',
		revision: 'revision:one',
		registryVersion: 1,
		availability: 'available',
		writable: true,
		presentation: defaultPresentation
	};
	const liveSettingsProjection: UserSettingsProjection = {
		...settingsProjection,
		revision: 'revision:live'
	};
	let projectedSettings = liveSettingsProjection;
	let resolveSettingsSnapshot = (_projection: UserSettingsProjection): void => {};
	const settingsSnapshot = new Promise<UserSettingsProjection>((resolve) => {
		resolveSettingsSnapshot = resolve;
	});
	let notifySettings: ((projection: UserSettingsProjection) => void) | undefined;
	const authenticatedChromeUpdates: ProductWindowChromeUpdate[] = [];
	const authenticatedPromise = bootstrapWorkbench(settingsDocument, authenticatedComposition, [
		...commonWorkbenchContributions,
		createDesktopWorkbenchContribution(
			'authenticated',
			async () => ({
				protocolVersion: 1,
				kind: 'authenticated',
				windowId: 'window:settings',
				institutionOrigin: 'https://institution.example.test',
				principalId: 'principal:one',
				sessionId: 'session:one',
				initialDestination: 'settings'
			}),
			testWindowChromeClient(authenticatedChromeUpdates)
		),
		createAccountContribution({
			request: async () => ({ kind: 'error', reason: 'unavailable' })
		}),
		createAuthenticatedContribution({
			signOut: async () => {
				throw new Error('sign-out unavailable');
			},
			close: async () => {}
		}),
		createSettingsContribution({
			projection: () => settingsSnapshot,
			preview: async (intent) => {
				previewCalls++;
				previewedSource = intent.source;
				const zoom = /"window\.zoomLevel"\s*:\s*(\d+)/u.exec(intent.source);
				notifySettings?.({
					...projectedSettings,
					presentation: {
						theme: intent.source.includes('"workbench.colorTheme": "light"')
							? 'light'
							: 'dark',
						zoomPercent: zoom === null ? 100 : Number(zoom[1]),
						reducedMotion: intent.source.includes('"accessibility.reducedMotion": true')
					}
				});
			},
			cancelPreview: async () => {
				previewCancels++;
				notifySettings?.(projectedSettings);
			},
			commit: async (intent) => {
				commitCalls++;
				if (commitFails) throw new Error('commit unavailable');
				committedSource = intent.source;
				committedRevision = intent.expectedRevision;
				await commitBarrier;
				projectedSettings = {
					...liveSettingsProjection,
					source: intent.source,
					revision: 'revision:two'
				};
				return { kind: 'success', projection: projectedSettings };
			},
			onDidChange: (listener) => {
				notifySettings = listener;
				return () => {
					notifySettings = undefined;
				};
			}
		})
	]);
	await waitFor(() => notifySettings !== undefined);
	notifySettings?.(liveSettingsProjection);
	resolveSettingsSnapshot(settingsProjection);
	const authenticated = await authenticatedPromise;
	const settingsPage = authenticated.shell
		.part('content')
		.querySelector<HTMLElement>('.prctr-settings');
	const genericPage = authenticated.shell
		.part('content')
		.querySelector<HTMLElement>('.prctr-authenticated[data-region="page"]');
	if (settingsPage === null || settingsPage.hidden || genericPage?.hidden !== true)
		throw new Error('Settings is not a real AuthenticatedWindow destination');
	const settingsStatus = settingsPage.querySelector<HTMLElement>('[role="status"]');
	if (settingsStatus === null) throw new Error('Settings status region is missing');
	const dimmingDialog = authenticated.shell.overlayHost.show({
		kind: 'dialog',
		title: 'Confirm',
		message: 'Confirm native control dimming.',
		accessibleLabel: 'Confirm native control dimming',
		actions: [{ id: 'close', label: 'Close', variant: 'secondary', onRequest: () => undefined }]
	});
	await waitFor(() => authenticatedChromeUpdates.at(-1)?.dimmed === true);
	if (authenticatedChromeUpdates.at(-1)?.dimmed !== true)
		throw new Error('Authenticated modal did not dim native window controls');
	dimmingDialog.dispose();
	await waitFor(() => authenticatedChromeUpdates.at(-1)?.dimmed === false);
	if (authenticatedChromeUpdates.at(-1)?.dimmed !== false)
		throw new Error('Authenticated modal did not restore native window controls');
	const signOut = authenticated.shell
		.part('titlebar')
		.querySelector<HTMLButtonElement>('[data-region="signout"]');
	signOut?.click();
	await Promise.resolve();
	await Promise.resolve();
	const actionStatus = authenticated.shell
		.part('titlebar')
		.querySelector<HTMLElement>('[data-region="action-status"]');
	if (
		signOut === null ||
		actionStatus === null ||
		actionStatus.textContent !== 'The requested account action could not be completed.' ||
		genericPage?.hidden !== true
	)
		throw new Error(
			'A Settings sign-out failure was not published in the always-visible titlebar status'
		);
	const selectOptions = [...settingsPage.querySelectorAll<HTMLOptionElement>('option')].map(
		(option) => option.textContent
	);
	if (selectOptions.includes('hcLight') || !selectOptions.includes('High contrast light'))
		throw new Error('Settings enum controls exposed raw tokens instead of localized labels');
	const rows = [...settingsPage.querySelectorAll<HTMLElement>('.prctr-settings__row')];
	const themeSelect = rows
		.find((row) => row.querySelector('.prctr-settings__title')?.textContent === 'Color theme')
		?.querySelector<HTMLSelectElement>('select');
	if (themeSelect === null || themeSelect === undefined)
		throw new Error('Structured theme control is missing');
	themeSelect.value = 'light';
	themeSelect.dispatchEvent(new Event('change'));
	await waitFor(() => settingsDocument.documentElement.dataset.prctrTheme === 'light');
	const zoomInput = rows
		.find(
			(row) => row.querySelector('.prctr-settings__title')?.textContent === 'Interface zoom'
		)
		?.querySelector<HTMLInputElement>('input');
	if (zoomInput === null || zoomInput === undefined)
		throw new Error('Structured numeric Settings control is missing');
	zoomInput.value = '125';
	zoomInput.dispatchEvent(new Event('change'));
	await waitFor(() => settingsDocument.documentElement.style.zoom === '1.25');
	zoomInput.value = '';
	zoomInput.dispatchEvent(new Event('change'));
	const currentZoomInput = [...settingsPage.querySelectorAll<HTMLElement>('.prctr-settings__row')]
		.find(
			(row) => row.querySelector('.prctr-settings__title')?.textContent === 'Interface zoom'
		)
		?.querySelector<HTMLInputElement>('input');
	if (currentZoomInput !== zoomInput)
		throw new Error('Structured Settings editing replaced the focused control');
	const fontInput = [...settingsPage.querySelectorAll<HTMLElement>('.prctr-settings__row')]
		.find(
			(row) => row.querySelector('.prctr-settings__title')?.textContent === 'Editor font size'
		)
		?.querySelector<HTMLInputElement>('input');
	if (fontInput === null || fontInput === undefined)
		throw new Error('Numeric Settings control did not survive deletion');
	fontInput.value = '16';
	fontInput.dispatchEvent(new Event('change'));
	await waitFor(() => previewedSource.includes('16'));
	if (!previewedSource.includes('16'))
		throw new Error(
			'Valid Settings drafts were not previewed in the current AuthenticatedWindow'
		);
	const viewButtons = settingsPage.querySelectorAll<HTMLButtonElement>(
		'.prctr-settings__switcher button'
	);
	viewButtons[1]?.click();
	const source = settingsPage.querySelector<HTMLTextAreaElement>('.prctr-settings__source');
	if (source === null || source.hidden) throw new Error('Settings JSONC view did not open');
	source.value = source.value.replace('16', '18');
	const inputEvent = source.ownerDocument.createEvent('Event');
	inputEvent.initEvent('input', true, false);
	source.dispatchEvent(inputEvent);
	commitBarrier = new Promise<void>((resolve) => {
		releaseCommit = resolve;
	});
	const save = settingsPage.querySelector<HTMLButtonElement>('.prctr-settings__actions button');
	save?.click();
	await Promise.resolve();
	await Promise.resolve();
	if (save === null || !save.disabled || !source.disabled)
		throw new Error('Settings remained editable while a save was in flight');
	save.click();
	if (commitCalls !== 1)
		throw new Error('Settings issued concurrent saves for one in-flight draft');
	releaseCommit();
	await waitFor(() => committedSource.includes('18') && !save.disabled);
	commitBarrier = undefined;
	if (!committedSource.includes('// retained') || committedRevision !== 'revision:live')
		throw new Error(
			'Settings lost the live initial revision or failed to commit one comment-preserving draft'
		);
	const acknowledgedFontInput = [
		...settingsPage.querySelectorAll<HTMLElement>('.prctr-settings__row')
	]
		.find(
			(row) => row.querySelector('.prctr-settings__title')?.textContent === 'Editor font size'
		)
		?.querySelector<HTMLInputElement>('input');
	if (acknowledgedFontInput === null || acknowledgedFontInput === undefined)
		throw new Error('Acknowledged Settings controls were not rendered');
	source.value = source.value.replace('18', '20');
	source.dispatchEvent(inputEvent);
	await Promise.resolve();
	commitFails = true;
	settingsPage.querySelector<HTMLButtonElement>('.prctr-settings__actions button')?.click();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	const previewCallsAfterFailure = previewCalls;
	source.focus();
	notifySettings?.({
		...settingsProjection,
		source: committedSource,
		revision: 'revision:two',
		availability: 'unavailable',
		writable: false
	});
	if (
		!source.disabled ||
		!acknowledgedFontInput.disabled ||
		settingsDocument.activeElement !== settingsStatus ||
		[...settingsPage.querySelectorAll<HTMLElement>('.prctr-settings__row')]
			.find(
				(row) =>
					row.querySelector('.prctr-settings__title')?.textContent === 'Editor font size'
			)
			?.querySelector('input') !== acknowledgedFontInput
	)
		throw new Error(
			'Server-unavailable Settings replaced controls, lost focus, or failed to become read-only'
		);
	if (previewCalls !== previewCallsAfterFailure)
		throw new Error('A failed Settings commit was reapplied as a preview');
	settingsPage.querySelectorAll<HTMLButtonElement>('.prctr-settings__actions button')[1]?.click();
	viewButtons[0]?.click();
	notifySettings?.({
		...settingsProjection,
		source: committedSource,
		revision: 'revision:two',
		availability: 'available',
		writable: true
	});
	const focusedBeforeRemote = [
		...settingsPage.querySelectorAll<HTMLElement>('.prctr-settings__row')
	]
		.find(
			(row) => row.querySelector('.prctr-settings__title')?.textContent === 'Editor font size'
		)
		?.querySelector<HTMLInputElement>('input');
	focusedBeforeRemote?.focus();
	notifySettings?.({
		...settingsProjection,
		source: '{"editor.fontSize":22}',
		revision: 'revision:three',
		availability: 'available',
		writable: true
	});
	const focusedAfterRemote = [
		...settingsPage.querySelectorAll<HTMLElement>('.prctr-settings__row')
	]
		.find(
			(row) => row.querySelector('.prctr-settings__title')?.textContent === 'Editor font size'
		)
		?.querySelector<HTMLInputElement>('input');
	if (
		focusedBeforeRemote === undefined ||
		focusedAfterRemote === undefined ||
		focusedAfterRemote === focusedBeforeRemote ||
		settingsDocument.activeElement !== focusedAfterRemote
	)
		throw new Error('Remote Settings replacement did not restore logical control focus');
	notifySettings?.({
		...settingsProjection,
		source: '{"editor.fontSize":24}',
		revision: 'revision:four',
		availability: 'unavailable',
		writable: false
	});
	const unavailableFontInput = [
		...settingsPage.querySelectorAll<HTMLElement>('.prctr-settings__row')
	]
		.find(
			(row) => row.querySelector('.prctr-settings__title')?.textContent === 'Editor font size'
		)
		?.querySelector<HTMLInputElement>('input');
	if (
		unavailableFontInput == null ||
		!unavailableFontInput.disabled ||
		settingsDocument.activeElement !== settingsStatus
	)
		throw new Error('Read-only Settings replacement focused a disabled control');
	authenticated.disposables.dispose();
	settingsFrame.remove();
	if (previewCancels === 0)
		throw new Error('Settings preview was not reverted after acknowledgement or disposal');
	await runIntegratedBrowserPaneTest(document);
	await runIntegratedBrowserGateLifecycleTest(document);
	await runExamSecurityContributionTest(document);
	return 28;
}

async function runExecutableKernelTest(document: Document): Promise<void> {
	const frame = document.createElement('iframe');
	frame.style.inlineSize = '820px';
	frame.style.blockSize = '620px';
	document.body.append(frame);
	const child = frame.contentDocument;
	if (child === null) throw new Error('Executable kernel test frame is unavailable');
	await installHarnessStyles(child);
	let contextKeys: IContextKeyService | undefined;
	const inert = candidateComposition.contributions
		.filter(
			(descriptor) =>
				![
					'prctr.workbench.kernel',
					'prctr.workbench.restoration',
					'prctr.workbench.desktop'
				].includes(descriptor.id)
		)
		.map((descriptor) =>
			Object.freeze({
				...descriptor,
				activate: (context: WorkbenchBootstrapContext) => {
					contextKeys ??= context.getService<IContextKeyService>(
						WORKBENCH_CONTEXT_KEY_SERVICE
					);
				}
			})
		);
	const result = await bootstrapWorkbench(child, candidateComposition, [
		...commonWorkbenchContributions,
		createDesktopWorkbenchContribution('candidate', async () => ({
			protocolVersion: 1,
			kind: 'candidate',
			windowId: 'window:kernel',
			institutionOrigin: 'https://institution.example.test',
			principalId: 'principal:kernel',
			attemptId: 'attempt:kernel',
			sessionId: 'session:kernel',
			attemptConfigurationRevision: 'attempt-configuration:kernel',
			attemptConfigurationDigest: 'sha256:kernel01'
		})),
		...inert
	]);
	const service = contextKeys;
	if (service === undefined)
		throw new Error('Executable kernel did not publish its ContextKey service');
	const htmlRect = child.documentElement.getBoundingClientRect();
	const bodyRect = child.body.getBoundingClientRect();
	const shellRect = result.shell.element.getBoundingClientRect();
	if (
		getComputedStyle(child.body).margin !== '0px' ||
		Math.abs(htmlRect.width - bodyRect.width) > 1 ||
		Math.abs(bodyRect.width - shellRect.width) > 1 ||
		Math.abs(htmlRect.height - bodyRect.height) > 1 ||
		Math.abs(bodyRect.height - shellRect.height) > 1 ||
		child.body.scrollWidth > child.body.clientWidth ||
		child.body.scrollHeight > child.body.clientHeight
	)
		throw new Error(
			'Direct-body workbench bootstrap does not own an exact non-scrolling viewport'
		);
	if (
		WorkbenchWindowKindContext.getValue(service) !== 'candidate' ||
		WorkbenchLifecyclePhaseContext.getValue(service) !== 'restored' ||
		WorkbenchModalContext.getValue(service) !== false
	)
		throw new Error('Executable kernel did not bind production workbench context values');
	const focusProbe = child.createElement('button');
	focusProbe.textContent = 'Focus probe';
	result.shell.part('titlebar').append(focusProbe);
	focusProbe.focus();
	result.shell.part('content').focus();
	result.shell.part('content').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
	await Promise.resolve();
	const focusedPart = WorkbenchFocusedPartContext.getValue(service);
	if (focusedPart !== 'content')
		throw new Error(
			`Executable kernel did not track the focused workbench part (context=${String(focusedPart)}, active=${child.activeElement?.outerHTML ?? 'none'})`
		);
	const sash = result.shell.element.querySelector<HTMLElement>('[data-sash="sidebar"]');
	const reset = result.shell.element.querySelector<HTMLButtonElement>('.prctr-workbench__reset');
	if (sash === null || reset === null)
		throw new Error('Executable kernel reset action controls are missing');
	sash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	if (sash.getAttribute('aria-valuenow') !== '270')
		throw new Error('Executable kernel test did not resize the sidebar');
	reset.click();
	await Promise.resolve();
	if (sash.getAttribute('aria-valuenow') !== '260')
		throw new Error('Reset control bypassed or failed its registered command/menu action');
	sash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	const keyEvent = new KeyboardEvent('keydown', {
		key: '0',
		code: 'Digit0',
		altKey: true,
		ctrlKey: !isMacintosh,
		metaKey: isMacintosh,
		bubbles: true,
		cancelable: true
	});
	Object.defineProperty(keyEvent, 'keyCode', { configurable: true, value: 48 });
	result.shell.part('content').dispatchEvent(keyEvent);
	await Promise.resolve();
	if (!keyEvent.defaultPrevented || sash.getAttribute('aria-valuenow') !== '260')
		throw new Error(
			'Production keybinding dispatch did not execute and claim the reset command'
		);
	const gate = result.shell.overlayHost.show({
		kind: 'gate',
		title: 'Paused',
		message: 'Wait',
		accessibleLabel: 'Paused',
		actions: []
	});
	if (!reset.disabled || WorkbenchModalContext.getValue(service) !== true)
		throw new Error('Modal context did not disable the resolved reset action');
	sash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	const blockedKeyEvent = new KeyboardEvent('keydown', {
		key: '0',
		code: 'Digit0',
		altKey: true,
		ctrlKey: !isMacintosh,
		metaKey: isMacintosh,
		bubbles: true,
		cancelable: true
	});
	Object.defineProperty(blockedKeyEvent, 'keyCode', { configurable: true, value: 48 });
	result.shell.part('content').dispatchEvent(blockedKeyEvent);
	await Promise.resolve();
	if (blockedKeyEvent.defaultPrevented || sash.getAttribute('aria-valuenow') !== '270')
		throw new Error('Disabled modal keybinding still claimed or executed the reset command');
	gate.dispose();
	if (reset.disabled || WorkbenchModalContext.getValue(service) !== false)
		throw new Error('Resolved reset action did not recover after the modal closed');
	const scope = child.createElement('div');
	const scopedTarget = child.createElement('button');
	scope.append(scopedTarget);
	result.shell.part('content').append(scope);
	const scoped = service.createScoped(scope);
	const scopedKey = scoped.createKey<string>('prctr.test.scoped', 'local');
	if (service.getContext(scopedTarget).getValue('prctr.test.scoped') !== 'local')
		throw new Error('Scoped ContextKey service did not resolve through its DOM owner');
	scopedKey.set('changed');
	const overlay = scoped.createOverlay([['prctr.test.scoped', 'overlay']]);
	if (
		overlay.getContext(scopedTarget).getValue('prctr.test.scoped') !== 'overlay' ||
		scoped.getContextKeyValue('prctr.test.scoped') !== 'changed'
	)
		throw new Error('ContextKey overlay did not preserve its read-only precedence');
	scoped.dispose();
	if (scope.hasAttribute('data-keybinding-context'))
		throw new Error('Scoped ContextKey disposal retained its DOM ownership attribute');
	result.disposables.dispose();
	frame.remove();
}

async function runMigratedSettingsDestinationTest(document: Document): Promise<void> {
	const frame = document.createElement('iframe');
	document.body.append(frame);
	const child = frame.contentDocument;
	if (child === null) throw new Error('Migrated Settings destination frame is unavailable');
	const source = '{\n  "workbench.tree.indent": 12\n}';
	const projection: UserSettingsProjection = Object.freeze({
		source,
		revision: 'revision:migrated',
		registryVersion: 1,
		availability: 'available',
		writable: true,
		presentation: Object.freeze({ theme: 'dark', zoomPercent: 100, reducedMotion: false })
	});
	let committed = '';
	const result = await bootstrapWorkbench(child, authenticatedComposition, [
		...commonWorkbenchContributions,
		createDesktopWorkbenchContribution('authenticated', async () => ({
			protocolVersion: 1,
			kind: 'authenticated',
			windowId: 'window:migrated-settings',
			institutionOrigin: 'https://institution.example.test',
			principalId: 'principal:migrated',
			sessionId: 'session:migrated',
			initialDestination: 'settings'
		})),
		createAccountContribution({
			request: async () => ({ kind: 'error', reason: 'unavailable' })
		}),
		createAuthenticatedContribution({ signOut: async () => {}, close: async () => {} }),
		createSettingsContribution({
			projection: async () => projection,
			preview: async () => {},
			cancelPreview: async () => {},
			commit: async (intent) => {
				committed = intent.source;
				return {
					kind: 'success',
					projection: {
						...projection,
						source: intent.source,
						revision: 'revision:migrated-saved'
					}
				};
			},
			onDidChange: () => () => {}
		})
	]);
	const row = [
		...result.shell.part('content').querySelectorAll<HTMLElement>('.prctr-settings__row')
	].find(
		(candidate) =>
			candidate.querySelector('.prctr-settings__title')?.textContent === 'Tree indentation'
	);
	const input = row?.querySelector<HTMLInputElement>('input');
	if (input?.value !== '12')
		throw new Error('Settings destination did not consume the coordinator-migrated projection');
	input.value = '13';
	input.dispatchEvent(new Event('change'));
	await Promise.resolve();
	const save = result.shell
		.part('content')
		.querySelector<HTMLButtonElement>('.prctr-settings__actions button');
	await waitFor(() => save?.disabled === false);
	save?.click();
	await waitFor(() => committed.length > 0);
	if (
		!committed.includes('"workbench.tree.indent": 13') ||
		committed.includes('explorer.tree.indent')
	)
		throw new Error('Settings destination did not save the migrated key');
	result.disposables.dispose();
	frame.remove();
}

async function installHarnessStyles(document: Document): Promise<void> {
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = new URL('./renderer.css', globalThis.location.href).href;
	const loaded = new Promise<void>((resolve, reject) => {
		link.addEventListener('load', () => resolve(), { once: true });
		link.addEventListener(
			'error',
			() =>
				reject(new Error('Browser harness stylesheet could not be loaded into its frame')),
			{ once: true }
		);
	});
	document.head.append(link);
	await loaded;
}

async function runWindowBindingFailureTests(document: Document): Promise<void> {
	const pending = createDarkForcedColorsFrame(document);
	const pendingDocument = pending.document;
	let resolveBinding = (
		_value: Awaited<ReturnType<Parameters<typeof createDesktopWorkbenchContribution>[1]>>
	): void => {};
	const pendingBinding = new Promise<
		Awaited<ReturnType<Parameters<typeof createDesktopWorkbenchContribution>[1]>>
	>((resolve) => {
		resolveBinding = resolve;
	});
	const pendingGuarded: WorkbenchContributionRegistration[] = candidateComposition.contributions
		.filter(
			(descriptor) =>
				![
					'prctr.workbench.kernel',
					'prctr.workbench.restoration',
					'prctr.workbench.desktop'
				].includes(descriptor.id)
		)
		.map((descriptor) => Object.freeze({ ...descriptor, activate: () => {} }));
	const pendingStart = bootstrapWorkbench(pendingDocument, candidateComposition, [
		...commonWorkbenchContributions,
		createDesktopWorkbenchContribution('candidate', () => pendingBinding),
		...pendingGuarded
	]);
	await Promise.resolve();
	const loading = pendingDocument.body.querySelector<HTMLElement>(
		'[data-workbench-loading="true"]'
	);
	if (
		loading?.classList.contains('prctr-startup-surface') !== true ||
		pendingDocument.body.querySelector('.prctr-workbench') !== null ||
		pendingDocument.documentElement.dataset.prctrTheme !== 'dark' ||
		pendingDocument.documentElement.dataset.prctrForcedColors !== 'active'
	)
		throw new Error(
			'Pending privileged binding exposed an unthemed or unowned loading surface'
		);
	resolveBinding({
		protocolVersion: 1,
		kind: 'candidate',
		windowId: 'window:pending',
		institutionOrigin: 'https://institution.example.test',
		principalId: 'principal:pending',
		attemptId: 'attempt:pending',
		sessionId: 'session:pending',
		attemptConfigurationRevision: 'attempt-configuration:pending',
		attemptConfigurationDigest: 'sha256:pending01'
	});
	const pendingResult = await pendingStart;
	if (
		pendingDocument.body.querySelector('[data-workbench-loading="true"]') !== null ||
		pendingDocument.body.querySelector('.prctr-workbench') === null
	)
		throw new Error(
			'Established privileged binding did not replace the minimal loader with the workbench'
		);
	pendingResult.disposables.dispose();
	pending.frame.remove();
	for (const bootstrap of [
		async () => {
			throw new Error('binding unavailable');
		},
		async () => ({
			protocolVersion: 1 as const,
			kind: 'authenticated' as const,
			windowId: 'window:mismatch',
			institutionOrigin: 'https://institution.example.test',
			principalId: 'principal:one',
			sessionId: 'session:one',
			initialDestination: 'activity'
		})
	]) {
		const failed = createDarkForcedColorsFrame(document);
		const candidateDocument = failed.document;
		let capabilityActivations = 0;
		const desktop = createDesktopWorkbenchContribution('candidate', bootstrap);
		const guarded: WorkbenchContributionRegistration[] = candidateComposition.contributions
			.filter(
				(descriptor) =>
					![
						'prctr.workbench.kernel',
						'prctr.workbench.restoration',
						'prctr.workbench.desktop'
					].includes(descriptor.id)
			)
			.map((descriptor) =>
				Object.freeze({
					...descriptor,
					activate: () => {
						capabilityActivations++;
					}
				})
			);
		await bootstrapWorkbench(candidateDocument, candidateComposition, [
			...commonWorkbenchContributions,
			desktop,
			...guarded
		]).then(
			() => {
				throw new Error(
					'Invalid privileged window binding started the Candidate workbench'
				);
			},
			() => {}
		);
		const recovery = candidateDocument.body.querySelector<HTMLElement>(
			'[data-workbench-recovery="true"]'
		);
		if (
			capabilityActivations !== 0 ||
			recovery?.classList.contains('prctr-startup-surface') !== true ||
			candidateDocument.documentElement.dataset.prctrTheme !== 'dark' ||
			candidateDocument.documentElement.dataset.prctrForcedColors !== 'active'
		)
			throw new Error(
				'Privileged binding recovery did not retain its owned dark forced-colors presentation'
			);
		failed.frame.remove();
	}
}

async function runThemePreferenceTest(document: Document): Promise<void> {
	const frame = document.createElement('iframe');
	document.body.append(frame);
	const themeDocument = frame.contentDocument;
	const view = frame.contentWindow;
	if (themeDocument === null || view === null) throw new Error('Theme test frame is unavailable');
	const queries = new Map<string, MutableMediaQuery>();
	Object.defineProperty(view, 'matchMedia', {
		configurable: true,
		value: (query: string): MediaQueryList => {
			let value = queries.get(query);
			if (value === undefined) {
				value = new MutableMediaQuery(query);
				queries.set(query, value);
			}
			return value as unknown as MediaQueryList;
		}
	});
	const service = new BrowserThemeService(
		themeDocument,
		'light',
		{ density: 'default', motion: 'full', transparency: 'full' },
		{ followSystemColorScheme: true }
	);
	const scheme = queries.get('(prefers-color-scheme: dark)');
	const motion = queries.get('(prefers-reduced-motion: reduce)');
	const transparency = queries.get('(prefers-reduced-transparency: reduce)');
	if (scheme === undefined || motion === undefined || transparency === undefined)
		throw new Error('Theme service did not own all operating-system preference queries');
	const themeId = (): string => service.theme.id;
	const motionPreference = (): string | undefined =>
		themeDocument.documentElement.dataset.prctrMotion;
	scheme.setMatches(true);
	if (themeId() !== 'dark')
		throw new Error('Theme service did not follow a live operating-system color-scheme change');
	motion.setMatches(true);
	service.setMotionPreference('full');
	if (motionPreference() !== 'reduced')
		throw new Error('User full-motion preference overrode operating-system reduced motion');
	motion.setMatches(false);
	if (motionPreference() !== 'full')
		throw new Error('Theme service did not release operating-system reduced motion');
	service.setMotionPreference('reduced');
	if (motionPreference() !== 'reduced')
		throw new Error(
			'User reduced motion did not win after the operating-system preference cleared'
		);
	transparency.setMatches(true);
	service.setPreferences({ density: 'default', motion: 'reduced', transparency: 'full' });
	if (themeDocument.documentElement.dataset.prctrTransparency !== 'reduced')
		throw new Error(
			'User transparency preference overrode operating-system reduced transparency'
		);
	service.setTheme('light');
	scheme.setMatches(false);
	scheme.setMatches(true);
	if (themeId() !== 'light')
		throw new Error(
			'Explicit packaged theme selection did not stop automatic scheme following'
		);
	service.dispose();
	motion.setMatches(true);
	if (motionPreference() !== undefined)
		throw new Error('Disposed theme service retained operating-system preference listeners');
	frame.remove();
}

class MutableMediaQuery extends EventTarget {
	matches = false;
	readonly onchange = null;
	constructor(readonly media: string) {
		super();
	}
	setMatches(matches: boolean): void {
		if (this.matches === matches) return;
		this.matches = matches;
		this.dispatchEvent(new Event('change'));
	}
	addListener(listener: EventListener): void {
		this.addEventListener('change', listener);
	}
	removeListener(listener: EventListener): void {
		this.removeEventListener('change', listener);
	}
}

function createDarkForcedColorsFrame(document: Document): {
	readonly document: Document;
	readonly frame: HTMLIFrameElement;
} {
	const frame = document.createElement('iframe');
	document.body.append(frame);
	const child = frame.contentDocument;
	const view = frame.contentWindow;
	if (child === null || view === null)
		throw new Error('Startup presentation test frame is unavailable');
	const queries = new Map<string, MutableMediaQuery>();
	const dark = new MutableMediaQuery('(prefers-color-scheme: dark)');
	dark.setMatches(true);
	queries.set(dark.media, dark);
	const forced = new MutableMediaQuery('(forced-colors: active)');
	forced.setMatches(true);
	queries.set(forced.media, forced);
	Object.defineProperty(view, 'matchMedia', {
		configurable: true,
		value: (query: string): MediaQueryList => {
			let value = queries.get(query);
			if (value === undefined) {
				value = new MutableMediaQuery(query);
				queries.set(query, value);
			}
			return value as unknown as MediaQueryList;
		}
	});
	return { document: child, frame };
}

async function runSettingsCancelFailureTest(document: Document): Promise<void> {
	const frame = document.createElement('iframe');
	document.body.append(frame);
	const settingsDocument = frame.contentDocument;
	if (settingsDocument === null)
		throw new Error('Settings cancellation test frame is unavailable');
	const acknowledgedPresentation = Object.freeze({
		theme: 'dark' as const,
		zoomPercent: 100,
		reducedMotion: false
	});
	const acknowledged: UserSettingsProjection = Object.freeze({
		source: '{}',
		revision: 'revision:cancel',
		registryVersion: 1,
		availability: 'available',
		writable: true,
		presentation: acknowledgedPresentation
	});
	let current = acknowledged;
	let listener: ((projection: UserSettingsProjection) => void) | undefined;
	let cancelCalls = 0;
	const result = await bootstrapWorkbench(settingsDocument, authenticatedComposition, [
		...commonWorkbenchContributions,
		createDesktopWorkbenchContribution('authenticated', async () => ({
			protocolVersion: 1,
			kind: 'authenticated',
			windowId: 'window:cancel',
			institutionOrigin: 'https://institution.example.test',
			principalId: 'principal:one',
			sessionId: 'session:one',
			initialDestination: 'settings'
		})),
		createAccountContribution({
			request: async () => ({ kind: 'error', reason: 'unavailable' })
		}),
		createAuthenticatedContribution({ signOut: async () => {}, close: async () => {} }),
		createSettingsContribution({
			projection: async () => current,
			preview: async (intent) => {
				current = Object.freeze({
					...acknowledged,
					presentation: Object.freeze({
						...acknowledgedPresentation,
						theme: intent.source.includes('"light"') ? 'light' : 'dark'
					})
				});
				listener?.(current);
			},
			cancelPreview: async () => {
				cancelCalls++;
				if (cancelCalls === 1) throw new Error('ambiguous cancellation');
				current = acknowledged;
				listener?.(current);
			},
			commit: async () => ({ kind: 'unavailable' }),
			onDidChange: (value) => {
				listener = value;
				return () => {
					listener = undefined;
				};
			}
		})
	]);
	const page = result.shell.part('content').querySelector<HTMLElement>('.prctr-settings');
	const theme = [...(page?.querySelectorAll<HTMLElement>('.prctr-settings__row') ?? [])]
		.find((row) => row.querySelector('.prctr-settings__title')?.textContent === 'Color theme')
		?.querySelector<HTMLSelectElement>('select');
	const status = page?.querySelector<HTMLElement>('[role="status"]');
	if (theme === null || theme === undefined || status === null || status === undefined)
		throw new Error('Settings cancellation test controls are incomplete');
	theme.value = 'light';
	theme.dispatchEvent(new Event('change'));
	await waitFor(() => settingsDocument.documentElement.dataset.prctrTheme === 'light');
	page?.querySelectorAll<HTMLButtonElement>('.prctr-settings__actions button')[1]?.click();
	await waitFor(
		() => cancelCalls === 2 && settingsDocument.documentElement.dataset.prctrTheme === 'dark'
	);
	if (status.textContent !== 'The settings preview could not be reverted safely.')
		throw new Error(
			'Rejected preview cancellation was not surfaced after acknowledged presentation recovery'
		);
	result.disposables.dispose();
	frame.remove();
}

async function runPaneHostClearFailureTest(document: Document): Promise<void> {
	const hostElement = document.createElement('div');
	document.body.append(hostElement);
	const registry = new WorkbenchItemResolverRegistry();
	const panes: TestPane[] = [];
	let disposedModels = 0;
	registry.register({
		typeId: 'test',
		resolve: async (item) => ({
			item,
			dispose: () => {
				disposedModels++;
			}
		}),
		createPane: () => {
			const pane = new TestPane(document);
			panes.push(pane);
			return pane;
		}
	});
	const host = new WorkbenchPaneHost(hostElement, registry);
	await host.assign(createItem('clear-one'));
	const first = panes[0];
	if (first === undefined)
		throw new Error('Pane clear failure test did not create its first pane');
	first.failClear = true;
	await host.clear().then(
		() => {
			throw new Error('Explicit pane clear swallowed its asynchronous failure');
		},
		() => {}
	);
	if (host.element.childElementCount !== 0 || disposedModels !== 1)
		throw new Error('Explicit pane clear failure retained pane DOM or model ownership');
	await host.assign(createItem('clear-two'));
	if (panes.length !== 2 || panes[1] === first)
		throw new Error('Explicit pane clear failure retained the failed pane for reuse');
	host.dispose();
	hostElement.remove();
}

async function runIntegratedBrowserPaneTest(document: Document): Promise<void> {
	const host = document.createElement('div');
	host.style.inset = '0';
	host.style.position = 'fixed';
	document.body.append(host);
	const browserDocument = document;
	const disposables = new DisposableStore();
	const shell = disposables.add(new WorkbenchShell(host, candidateComposition, labels));
	const registry = new WorkbenchItemResolverRegistry();
	const surfaces: IntegratedBrowserSurface[] = [];
	const intents: IntegratedBrowserIntent[] = [];
	let projection: IntegratedBrowserProjection = {
		state: 'open',
		policyRevision: 'browser:1',
		location: { scheme: 'https', host: 'docs.example.test', port: '', path: '/reference' },
		matchedRuleId: 'docs',
		canOpen: false,
		canClose: true,
		canGoBack: true,
		canGoForward: false,
		canReload: true
	};
	const staleProjection: IntegratedBrowserProjection = {
		...projection,
		state: 'closed',
		canOpen: true,
		canClose: false,
		canGoBack: false,
		canReload: false
	};
	let resolveInitialProjection = (_projection: IntegratedBrowserProjection): void => {};
	const initialProjection = new Promise<IntegratedBrowserProjection>((resolve) => {
		resolveInitialProjection = resolve;
	});
	let rejectBrowserAction = (_error: Error): void => {};
	const browserAction = new Promise<void>((_resolve, reject) => {
		rejectBrowserAction = reject;
	});
	let useInitialProjection = true;
	let notify: ((projection: IntegratedBrowserProjection) => void) | undefined;
	let notifySurfaceFocus: ((focused: boolean) => void) | undefined;
	let failClose = false;
	const contribution = createIntegratedBrowserContribution({
		projection: () => {
			if (!useInitialProjection) return Promise.resolve(projection);
			useInitialProjection = false;
			return initialProjection;
		},
		intent: async (intent) => {
			intents.push(intent);
			if (intent.kind === 'browser.back') return browserAction;
			if (intent.kind !== 'browser.close') return;
			if (failClose) throw new Error('close unavailable');
			projection = {
				state: 'closed',
				policyRevision: 'browser:1',
				location: projection.location,
				matchedRuleId: 'docs',
				canOpen: true,
				canClose: false,
				canGoBack: false,
				canGoForward: false,
				canReload: false
			};
			notify?.(projection);
		},
		surface: async (surface) => {
			surfaces.push(surface);
		},
		surfaceFocus: async () => false,
		onDidChange: (listener) => {
			notify = listener;
			return () => {
				notify = undefined;
			};
		},
		onDidChangeSurfaceFocus: (listener) => {
			notifySurfaceFocus = listener;
			return () => {
				notifySurfaceFocus = undefined;
			};
		}
	});
	await contribution.activate(
		createContributionContext(browserDocument, shell, disposables, registry)
	);
	const resolver = registry.get('prctr.integratedBrowser');
	const item: WorkbenchItem & { readonly startRuleId: string } = {
		typeId: 'prctr.integratedBrowser',
		logicalIdentity: 'browser:one',
		startRuleId: 'docs',
		presentation: { title: 'Browser', accessibleLabel: 'Browser' },
		closable: true,
		restorable: false,
		onDidChangePresentation: BaseEvent.None,
		matches: (other) => other.logicalIdentity === 'browser:one'
	};
	const model = await resolver.resolve(item, CancellationToken.None);
	const pane = resolver.createPane(browserDocument);
	shell.part('content').append(pane.element);
	const assignment = pane.setItem(model, CancellationToken.None);
	notify?.(projection);
	resolveInitialProjection(staleProjection);
	await assignment;
	if (intents.some((intent) => intent.kind === 'browser.open'))
		throw new Error(
			'A delayed closed browser snapshot reopened a surface that a newer live projection had opened'
		);
	pane.setVisible(true);
	pane.layout(shell.part('content').clientWidth, shell.part('content').clientHeight);
	await waitFor(
		() =>
			shell.element.dataset.compactSidebar === 'true' &&
			shell.element.dataset.compactPanel === 'true'
	);
	pane.layout(shell.part('content').clientWidth, shell.part('content').clientHeight);
	await waitFor(
		() =>
			surfaces.at(-1)?.visible === true &&
			(surfaces.at(-1)?.bounds.width ?? 0) > 0 &&
			(surfaces.at(-1)?.bounds.height ?? 0) > 0
	);
	const toolbar = pane.element.querySelector<HTMLElement>('.prctr-integrated-browser__toolbar');
	if (toolbar === null || toolbar.scrollWidth > toolbar.clientWidth)
		throw new Error('Integrated Browser toolbar overflows at 200% browser zoom');
	const sidebarToggle = shell.element.querySelector<HTMLButtonElement>(
		'[data-region-toggle="sidebar"]'
	);
	const panelToggle = shell.element.querySelector<HTMLButtonElement>(
		'[data-region-toggle="panel"]'
	);
	if (
		sidebarToggle === null ||
		panelToggle === null ||
		sidebarToggle.hidden ||
		panelToggle.hidden ||
		sidebarToggle.getAttribute('aria-controls') !== shell.part('sidebar').id ||
		panelToggle.getAttribute('aria-controls') !== shell.part('panel').id
	)
		throw new Error('Compact Candidate regions have no accessible reopening affordance');
	sidebarToggle.focus();
	sidebarToggle.click();
	pane.layout(0, 0);
	await waitFor(
		() =>
			sidebarToggle.getAttribute('aria-expanded') === 'true' &&
			getComputedStyle(shell.part('sidebar')).display !== 'none' &&
			getComputedStyle(shell.part('content')).display === 'none' &&
			surfaces.at(-1)?.visible === false
	);
	sidebarToggle.click();
	pane.layout(shell.part('content').clientWidth, shell.part('content').clientHeight);
	await waitFor(
		() =>
			sidebarToggle.getAttribute('aria-expanded') === 'false' &&
			surfaces.at(-1)?.visible === true
	);
	panelToggle.focus();
	panelToggle.click();
	pane.layout(0, 0);
	await waitFor(
		() =>
			panelToggle.getAttribute('aria-expanded') === 'true' &&
			getComputedStyle(shell.part('panel')).display !== 'none' &&
			getComputedStyle(shell.part('content')).display === 'none' &&
			surfaces.at(-1)?.visible === false
	);
	panelToggle.click();
	pane.layout(shell.part('content').clientWidth, shell.part('content').clientHeight);
	await waitFor(
		() =>
			panelToggle.getAttribute('aria-expanded') === 'false' &&
			surfaces.at(-1)?.visible === true
	);
	panelToggle.click();
	sidebarToggle.focus();
	host.style.inset = 'auto';
	host.style.inlineSize = '800px';
	host.style.blockSize = '300px';
	shell.layout();
	pane.layout(0, 0);
	await waitFor(
		() =>
			shell.element.dataset.compactSidebar === 'false' &&
			shell.element.dataset.compactPanel === 'true' &&
			shell.element.dataset.compactPanelOpen === 'true'
	);
	if (
		document.activeElement !== shell.part('panel') ||
		getComputedStyle(shell.part('sidebar')).display !== 'none'
	)
		throw new Error(
			'Mixed compact thresholds moved focus into a region hidden behind the open panel drawer'
		);
	host.style.blockSize = '600px';
	shell.layout();
	await waitFor(
		() =>
			shell.element.dataset.compactSidebar === 'false' &&
			shell.element.dataset.compactPanel === 'false'
	);
	if (document.activeElement !== shell.part('panel'))
		throw new Error(
			'Leaving compact layout hid the focused terminal toggle without a visible focus destination'
		);
	const sidebarFocus = document.createElement('button');
	sidebarFocus.textContent = 'Workspace item';
	shell.part('sidebar').append(sidebarFocus);
	sidebarFocus.focus();
	host.style.inlineSize = '450px';
	host.style.blockSize = '300px';
	shell.layout();
	pane.layout(0, 0);
	await waitFor(
		() =>
			shell.element.dataset.compactSidebarOpen === 'true' &&
			document.activeElement === sidebarFocus &&
			getComputedStyle(shell.part('sidebar')).display !== 'none' &&
			surfaces.at(-1)?.visible === false
	);
	sidebarToggle.focus();
	sidebarToggle.click();
	pane.layout(shell.part('content').clientWidth, shell.part('content').clientHeight);
	await waitFor(
		() =>
			shell.element.dataset.compactSidebarOpen === 'false' &&
			surfaces.at(-1)?.visible === true
	);
	notifySurfaceFocus?.(true);
	const gate = shell.overlayHost.show({
		kind: 'gate',
		title: 'Paused',
		message: 'Work is protected.',
		accessibleLabel: 'Paused',
		actions: []
	});
	await waitFor(() => surfaces.at(-1)?.visible === false);
	notifySurfaceFocus?.(false);
	gate.dispose();
	await waitFor(() => surfaces.at(-1)?.visible === true && surfaces.at(-1)?.focus === true);
	failClose = true;
	await Promise.resolve()
		.then(() => pane.clear())
		.then(
			() => {
				throw new Error('Integrated Browser clear swallowed native close failure');
			},
			() => {}
		);
	await waitFor(() => surfaces.at(-1)?.visible === false);
	failClose = false;
	pane.setVisible(true);
	await waitFor(() => surfaces.at(-1)?.visible === true);
	const address = pane.element.querySelector<HTMLInputElement>('input');
	const status = pane.element.querySelector<HTMLElement>('[role="status"]');
	if (address === null || status === null)
		throw new Error('Integrated Browser controls are incomplete');
	address.focus();
	pane.element.querySelector<HTMLButtonElement>('button')?.click();
	projection = {
		state: 'blocked',
		policyRevision: 'browser:1',
		location: projection.location,
		matchedRuleId: 'docs',
		canOpen: false,
		canClose: true,
		canGoBack: false,
		canGoForward: false,
		canReload: false,
		blockedReason: 'policyUnavailable'
	};
	notify?.(projection);
	rejectBrowserAction(new Error('stale action rejected'));
	await Promise.resolve();
	await Promise.resolve();
	if (
		!address.disabled ||
		browserDocument.activeElement !== status ||
		status.textContent !== 'Browser access is currently restricted.'
	)
		throw new Error(
			'Integrated Browser policy block lost focus or was overwritten by a stale intent rejection'
		);
	pane.focus();
	if (browserDocument.activeElement !== status)
		throw new Error('Integrated Browser focused a disabled address while blocked');
	projection = {
		state: 'open',
		policyRevision: 'browser:1',
		location: projection.location,
		matchedRuleId: 'docs',
		canOpen: false,
		canClose: true,
		canGoBack: false,
		canGoForward: false,
		canReload: true
	};
	notify?.(projection);
	await pane.clear();
	if (
		!address.disabled ||
		status.firstChild?.nodeValue !== 'Browser is closed.' ||
		surfaces.at(-1)?.visible !== false
	)
		throw new Error(
			'Integrated Browser close did not hide the native surface and publish closed state'
		);
	pane.dispose();
	model.dispose();
	disposables.dispose();
	host.remove();
}

async function runIntegratedBrowserGateLifecycleTest(document: Document): Promise<void> {
	const host = document.createElement('div');
	host.style.inlineSize = '800px';
	host.style.blockSize = '600px';
	document.body.append(host);
	const disposables = new DisposableStore();
	const shell = disposables.add(new WorkbenchShell(host, candidateComposition, labels));
	const registry = new WorkbenchItemResolverRegistry();
	const intents: IntegratedBrowserIntent[] = [];
	let projection: IntegratedBrowserProjection = {
		state: 'blocked',
		policyRevision: 'browser:gate',
		canOpen: false,
		canClose: false,
		canGoBack: false,
		canGoForward: false,
		canReload: false,
		blockedReason: 'paused'
	};
	let listener: ((value: IntegratedBrowserProjection) => void) | undefined;
	const contribution = createIntegratedBrowserContribution({
		projection: async () => projection,
		intent: async (intent) => {
			intents.push(intent);
			if (intent.kind === 'browser.open')
				projection = {
					state: 'open',
					policyRevision: 'browser:gate',
					location: { scheme: 'https', host: 'docs.example.test', port: '', path: '/' },
					matchedRuleId: intent.startRuleId,
					canOpen: false,
					canClose: true,
					canGoBack: false,
					canGoForward: false,
					canReload: true
				};
			else if (intent.kind === 'browser.close')
				projection = {
					state: 'closed',
					policyRevision: 'browser:gate',
					canOpen: true,
					canClose: false,
					canGoBack: false,
					canGoForward: false,
					canReload: false
				};
			listener?.(projection);
		},
		surface: async () => {},
		surfaceFocus: async () => false,
		onDidChange: (candidate) => {
			listener = candidate;
			return () => {
				listener = undefined;
			};
		},
		onDidChangeSurfaceFocus: () => () => {}
	});
	await contribution.activate(createContributionContext(document, shell, disposables, registry));
	const resolver = registry.get('prctr.integratedBrowser');
	const item: WorkbenchItem & { readonly startRuleId: string } = {
		typeId: 'prctr.integratedBrowser',
		logicalIdentity: 'browser:blocked-assignment',
		startRuleId: 'docs',
		presentation: { title: 'Browser', accessibleLabel: 'Browser' },
		closable: true,
		restorable: false,
		onDidChangePresentation: BaseEvent.None,
		matches: (other) => other.logicalIdentity === 'browser:blocked-assignment'
	};
	const model = await resolver.resolve(item, CancellationToken.None);
	const pane = resolver.createPane(document);
	shell.part('content').append(pane.element);
	await pane.setItem(model, CancellationToken.None);
	if (intents.some((intent) => intent.kind === 'browser.open'))
		throw new Error('Blocked idle browser assignment opened before its gate allowed ownership');
	projection = {
		state: 'closed',
		policyRevision: 'browser:gate',
		canOpen: true,
		canClose: false,
		canGoBack: false,
		canGoForward: false,
		canReload: false
	};
	listener?.(projection);
	await waitFor(() => intents.some((intent) => intent.kind === 'browser.open'));
	projection = {
		...projection,
		state: 'blocked',
		canOpen: false,
		canClose: true,
		canReload: false,
		blockedReason: 'policyUnavailable'
	};
	listener?.(projection);
	await pane.clear();
	if (!intents.some((intent) => intent.kind === 'browser.close'))
		throw new Error(
			'Blocked browser with an underlying native owner could not close during pane cleanup'
		);
	pane.dispose();
	model.dispose();
	disposables.dispose();
	host.remove();
}

async function runExamSecurityContributionTest(document: Document): Promise<void> {
	const host = document.createElement('div');
	host.style.inset = '0';
	host.style.position = 'fixed';
	document.body.append(host);
	const disposables = new DisposableStore();
	const shell = disposables.add(new WorkbenchShell(host, candidateComposition, labels));
	let listener: ((projection: CandidateSecurityProjection) => void) | undefined;
	let resolveInitial = (_projection: CandidateSecurityProjection): void => {};
	const initial = new Promise<CandidateSecurityProjection>((resolve) => {
		resolveInitial = resolve;
	});
	let rejectAcknowledgement = (_error: Error): void => {};
	const acknowledgement = new Promise<void>((_resolve, reject) => {
		rejectAcknowledgement = reject;
	});
	const contribution = createExamSecurityContribution({
		projection: () => initial,
		intent: (intent) =>
			intent.kind === 'security.acknowledgeCorrection' &&
			intent.correctionId === 'correction:network'
				? acknowledgement
				: Promise.resolve(),
		onDidChange: (candidate) => {
			listener = candidate;
			return () => {
				listener = undefined;
			};
		}
	});
	const activation = Promise.resolve(
		contribution.activate(createContributionContext(document, shell, disposables))
	);
	await waitFor(() => listener !== undefined);
	listener?.(securityProjection(2, 'compliant'));
	resolveInitial(securityProjection(1, 'checking'));
	await activation;
	if (shell.overlayHost.visible)
		throw new Error(
			'A stale initial Exam Security projection replaced a newer subscribed projection'
		);
	const corrections: readonly CandidateLiveCorrection[] = [
		{
			correctionId: 'correction:policy',
			revision: 1,
			reason: 'policy',
			state: 'acknowledgementRequired',
			affectedCapabilities: ['workspace']
		},
		{
			correctionId: 'correction:network',
			revision: 1,
			reason: 'network',
			state: 'acknowledgementRequired',
			affectedCapabilities: ['terminal']
		}
	];
	listener?.(securityProjectionWithCorrections(3, corrections));
	let correctionButtons = [
		...shell.part('banner').querySelectorAll<HTMLButtonElement>('button[data-correction-id]')
	];
	const correctionLabels = correctionButtons.map(
		(button) => button.getAttribute('aria-label') ?? ''
	);
	if (
		correctionButtons.length !== 2 ||
		correctionLabels[0] === correctionLabels[1] ||
		correctionLabels.some((label) => label.length === 0)
	)
		throw new Error(
			`Exam Security corrections do not expose distinct localized acknowledgement names: ${JSON.stringify(correctionLabels)}`
		);
	correctionButtons[1]?.focus();
	listener?.(securityProjectionWithCorrections(4, corrections));
	correctionButtons = [
		...shell.part('banner').querySelectorAll<HTMLButtonElement>('button[data-correction-id]')
	];
	if (
		document.activeElement !== correctionButtons[1] ||
		correctionButtons[1]?.dataset.correctionId !== 'correction:network'
	)
		throw new Error(
			'Exam Security projection replacement did not restore the exact focused correction'
		);
	correctionButtons[1]?.click();
	listener?.(securityProjectionWithCorrections(5, corrections));
	correctionButtons = [
		...shell.part('banner').querySelectorAll<HTMLButtonElement>('button[data-correction-id]')
	];
	if (!correctionButtons[1]?.disabled || document.activeElement !== correctionButtons[0])
		throw new Error(
			'A pending correction acknowledgement was not preserved across projection replacement with a visible focus fallback'
		);
	listener?.(securityProjectionWithCorrections(6, corrections.slice(0, 1)));
	rejectAcknowledgement(new Error('stale acknowledgement rejected'));
	await Promise.resolve();
	await Promise.resolve();
	correctionButtons = [
		...shell.part('banner').querySelectorAll<HTMLButtonElement>('button[data-correction-id]')
	];
	if (
		correctionButtons.length !== 1 ||
		correctionButtons[0]?.disabled ||
		shell.part('banner').textContent?.includes('not accepted')
	)
		throw new Error(
			'A stale acknowledgement rejection overwrote a newer Exam Security projection'
		);
	correctionButtons[0]?.focus();
	listener?.(securityProjectionWithCorrections(7, [{ ...corrections[0]!, state: 'notice' }]));
	if (document.activeElement !== shell.part('banner').querySelector('p'))
		throw new Error('A focused acknowledged correction did not move to its notice text');
	listener?.(securityProjectionWithCorrections(8, []));
	if (
		!shell.part('banner').hidden ||
		shell.part('banner').contains(document.activeElement) ||
		document.activeElement === document.body ||
		!shell.element.contains(document.activeElement)
	)
		throw new Error(
			'Removing a focused correction notice moved focus into the hidden banner or outside the workbench'
		);
	disposables.dispose();
	host.remove();
	const rejectionHostElement = document.createElement('div');
	rejectionHostElement.style.height = '600px';
	document.body.append(rejectionHostElement);
	const rejectionDisposables = new DisposableStore();
	const rejectionShell = rejectionDisposables.add(
		new WorkbenchShell(rejectionHostElement, candidateComposition, labels)
	);
	let rejectionListener: ((projection: CandidateSecurityProjection) => void) | undefined;
	let rejectInitial = (_error: Error): void => {};
	const rejectedInitial = new Promise<CandidateSecurityProjection>((_resolve, reject) => {
		rejectInitial = reject;
	});
	const rejecting = createExamSecurityContribution({
		projection: () => rejectedInitial,
		intent: async () => {},
		onDidChange: (candidate) => {
			rejectionListener = candidate;
			return () => {
				rejectionListener = undefined;
			};
		}
	});
	const rejectionActivation = Promise.resolve(
		rejecting.activate(
			createContributionContext(document, rejectionShell, rejectionDisposables)
		)
	);
	await waitFor(() => rejectionListener !== undefined);
	rejectionListener?.(securityProjection(2, 'compliant'));
	rejectInitial(new Error('stale projection unavailable'));
	await rejectionActivation;
	if (rejectionShell.overlayHost.visible)
		throw new Error(
			'A rejected initial Exam Security projection replaced a newer subscribed projection'
		);
	rejectionDisposables.dispose();
	rejectionHostElement.remove();
	const failureHostElement = document.createElement('div');
	failureHostElement.style.height = '600px';
	document.body.append(failureHostElement);
	const failureDisposables = new DisposableStore();
	const failureShell = failureDisposables.add(
		new WorkbenchShell(failureHostElement, candidateComposition, labels)
	);
	const failing = createExamSecurityContribution({
		projection: async () => {
			throw new Error('projection unavailable');
		},
		intent: async () => {},
		onDidChange: () => () => {}
	});
	await failing.activate(createContributionContext(document, failureShell, failureDisposables));
	if (!failureShell.overlayHost.visible || failureShell.part('banner').hidden)
		throw new Error('Exam Security activation failure did not retain the fail-closed gate');
	failureDisposables.dispose();
	failureHostElement.remove();
}

function createContributionContext(
	document: Document,
	shell: WorkbenchShell,
	disposables: DisposableStore,
	registry?: WorkbenchItemResolverRegistry
): WorkbenchBootstrapContext {
	let binding: unknown;
	const services = new Map<string, unknown>();
	services.set(WORKBENCH_CONTEXT_KEY_SERVICE, disposables.add(new ContextKeyService()));
	return {
		document,
		composition: candidateComposition,
		shell,
		localization: {
			locale: 'en',
			direction: 'ltr',
			format: (descriptor, values = {}) =>
				descriptor.defaultMessage.replace(
					/\{([a-z][a-zA-Z0-9]*)\}/gu,
					(_match, placeholder: string) => String(values[placeholder])
				)
		},
		disposables,
		setService: (id, value) => {
			services.set(id, value);
		},
		getService: <T>(_id: string): T => {
			if (registry !== undefined && _id !== WORKBENCH_CONTEXT_KEY_SERVICE)
				return registry as T;
			const value = services.get(_id);
			if (value === undefined) throw new Error(`Service ${_id} is unavailable`);
			return value as T;
		},
		setWindowBinding: (value) => {
			binding = value;
		},
		getWindowBinding: () => binding
	};
}
function securityProjection(
	revision: number,
	posture: SecureExamPosture
): CandidateSecurityProjection {
	const usable = posture === 'compliant' || posture === 'degraded';
	return {
		revision,
		attemptState: 'active',
		attemptRevision: 1,
		posture,
		participationGeneration: 1,
		leasePhase: 'connected',
		paused: false,
		protectedWork: 'notRequired',
		canJoin: false,
		canRetryChecks: false,
		canWorkspaceMutate: usable,
		canUseBrowser: usable,
		canUseTerminal: usable,
		canSubmit: usable,
		activeSecurityConditions:
			posture === 'checking' ? [{ reason: 'sourceCoverage', state: 'checking' }] : [],
		activeCorrections: [],
		authoritativeTimeUnixMs: 1
	};
}
function securityProjectionWithCorrections(
	revision: number,
	corrections: readonly CandidateLiveCorrection[]
): CandidateSecurityProjection {
	const blocks = (capability: CandidateLiveCorrection['affectedCapabilities'][number]): boolean =>
		corrections.some(
			(correction) =>
				correction.state === 'acknowledgementRequired' &&
				correction.affectedCapabilities.includes(capability)
		);
	return {
		...securityProjection(revision, 'compliant'),
		canWorkspaceMutate: !blocks('workspace'),
		canUseBrowser: !blocks('browser'),
		canUseTerminal: !blocks('terminal'),
		canSubmit: !blocks('submission'),
		activeCorrections: corrections
	};
}

class TestPane implements WorkbenchPane {
	readonly element: HTMLElement;
	identity: string | undefined;
	failSetItem = false;
	failClear = false;
	clearBarrier: Promise<void> | undefined;
	clearCalls = 0;
	constructor(document: Document) {
		this.element = document.createElement('section');
	}
	setItem(model: ResolvedWorkbenchItem, token: CancellationTokenType): void {
		if (this.failSetItem) throw new Error('pane failed');
		if (token.isCancellationRequested) return;
		this.identity = model.item.logicalIdentity;
	}
	async clear(): Promise<void> {
		this.clearCalls++;
		await this.clearBarrier;
		if (this.failClear) throw new Error('clear failed');
		this.identity = undefined;
	}
	setVisible(visible: boolean): void {
		this.element.hidden = !visible;
	}
	layout(): void {}
	focus(): void {
		this.element.focus();
	}
	getViewState(): Readonly<Record<string, unknown>> {
		return { cursor: 1 };
	}
	dispose(): void {
		this.element.remove();
	}
}
class SlowPane implements WorkbenchPane {
	readonly element: HTMLElement;
	readonly releases: Array<() => void> = [];
	identity: string | undefined;
	constructor(document: Document) {
		this.element = document.createElement('section');
	}
	async setItem(model: ResolvedWorkbenchItem, token: CancellationTokenType): Promise<void> {
		await new Promise<void>((resolve) => this.releases.push(resolve));
		if (!token.isCancellationRequested) this.identity = model.item.logicalIdentity;
	}
	clear(): void {
		this.identity = undefined;
	}
	setVisible(visible: boolean): void {
		this.element.hidden = !visible;
	}
	layout(): void {}
	focus(): void {
		this.element.focus();
	}
	getViewState(): Readonly<Record<string, unknown>> {
		return {};
	}
	dispose(): void {
		this.element.remove();
	}
}
async function waitFor(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 50; index++) {
		if (predicate()) return;
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
	throw new Error('Asynchronous pane operation did not reach the expected state');
}
function createItem(id: string): WorkbenchItem {
	return {
		typeId: 'test',
		logicalIdentity: id,
		presentation: { title: id, accessibleLabel: id },
		closable: true,
		restorable: true,
		onDidChangePresentation: BaseEvent.None,
		matches: (other) => other.typeId === 'test' && other.logicalIdentity === id
	};
}
