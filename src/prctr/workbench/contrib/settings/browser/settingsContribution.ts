import { parseSettingsDocument } from '../../../../platform/settings/common/settingsDocument.js';
import { settingsRegistry } from '../../../../platform/settings/common/settingsRegistry.js';
import type { UserSettingsProjection } from '../../../../platform/settings/common/settingsRendererProtocol.js';
import { WORKBENCH_LIFECYCLE_SERVICE, type WorkbenchLifecycleService } from '../../../common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore, toDisposable, isDisposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import { ProgressBar } from '../../../../base/browser/ui/progressbar/progressbar.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { defaultProgressBarStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { BROWSER_THEME_SERVICE, BrowserThemeService } from '../../../../platform/theme/browser/themeService.js';
import type { INotificationService } from '../../../../platform/notification/common/notification.js';
import { userSettingsResource } from '../../../../platform/settings/common/settingsResource.js';
import { OpenerService } from '../../../../editor/browser/services/openerService.js';
import type { WorkbenchContributionRegistration } from '../../../browser/bootstrap.js';
import type { WorkbenchPart } from '../../../common/composition.js';
import { WORKBENCH_SERVICE_COLLECTION, WORKBENCH_INSTANTIATION_SERVICE } from '../../../common/serviceIds.js';
import { WORKBENCH_NOTIFICATION_SERVICE } from '../../../browser/parts/notifications/notifications.js';
import { EditorWorkbenchLayoutService } from '../../../services/layout/browser/editorWorkbenchLayoutService.js';
import { Parts, Position } from '../../../services/layout/browser/layoutService.js';
import { EditorWindowHostService } from '../../../services/host/browser/editorWindowHostService.js';
import { ScopedProgressIndicator } from '../../../services/progress/browser/progressIndicator.js';
import { SettingsEditorWindowServices } from '../../../services/settings/browser/settingsEditorWindowServices.js';
import { SettingsEditorControlServices } from '../../../services/settings/browser/settingsEditorControlServices.js';
import { SettingsEditorPartServices } from '../../../services/settings/browser/settingsEditorPartServices.js';
import type { SettingsEditorEnvironment } from '../../../services/settings/browser/settingsEditorEnvironment.js';
import type { SettingsRendererClient } from '../../../services/settings/common/settingsRendererClient.js';
import { AUTHENTICATED_NAVIGATION_SERVICE, type AuthenticatedNavigationService } from '../../authenticated/browser/authenticatedNavigation.js';
import { SettingsModal } from './settingsModal.js';
import { SettingsOpenActions } from './settingsEditorActions.js';
export type { SettingsRendererClient } from '../../../services/settings/common/settingsRendererClient.js';

const shellParts: readonly (readonly [Parts, WorkbenchPart])[] = [
	[Parts.TITLEBAR_PART, 'titlebar'], [Parts.BANNER_PART, 'banner'], [Parts.SIDEBAR_PART, 'navigation'],
	[Parts.PANEL_PART, 'panel'], [Parts.STATUSBAR_PART, 'status']
];

/** Authenticated composition of the source editor, with one privileged Settings client. */
export function createSettingsContribution(client: SettingsRendererClient, environment: SettingsEditorEnvironment): WorkbenchContributionRegistration {
	return {
		id: 'prctr.authenticated.settings', phase: 'ready', dependencies: ['prctr.authenticated.navigation'],
		async activate(context) {
			const store = context.disposables.add(new DisposableStore());
			// Editors release model references before their window services are destroyed.
			const editors = store.add(new DisposableStore());
			const dependencies = store.add(new DisposableStore());
			const navigation = context.getService<AuthenticatedNavigationService>(AUTHENTICATED_NAVIGATION_SERVICE);
			const presentation = context.getService<BrowserThemeService>(BROWSER_THEME_SERVICE);
			const notifications = context.getService<INotificationService>(WORKBENCH_NOTIFICATION_SERVICE);
			const services = context.getService<ServiceCollection>(WORKBENCH_SERVICE_COLLECTION);
			const instantiation = context.getService<IInstantiationService>(WORKBENCH_INSTANTIATION_SERVICE);
			const parts = new Map(shellParts.filter(([, local]) => context.composition.layout.parts.includes(local)).map(([part, local]) => [part, context.shell.part(local)]));
			const layout = dependencies.add(new EditorWorkbenchLayoutService(context.shell.element, {
				parts, onDidChangePresentation: presentation.onDidChangePresentation,
				readOffset: () => ({ top: context.shell.part('titlebar').getBoundingClientRect().height, quickPickTop: context.shell.part('titlebar').getBoundingClientRect().height }),
				focusContent: () => context.shell.focusVisiblePart(['content']), isRestored: () => ['restored', 'eventually'].includes(context.getService<WorkbenchLifecycleService>(WORKBENCH_LIFECYCLE_SERVICE).phase ?? ''),
				readPresentation: () => ({ floating: true, compact: presentation.presentationPreferences.density === 'compact', uppercaseHeaders: false }),
				relayout: () => context.shell.layout(), readPositions: () => ({ sidebar: context.shell.primarySide === 'left' ? Position.LEFT : Position.RIGHT, panel: Position.BOTTOM, panelAlignment: 'center' }),
				setPartHidden(hidden, part) {
					if (part === Parts.SIDEBAR_PART) context.shell.setNavigationVisible(!hidden);
					else if (part === Parts.BANNER_PART) context.shell.setPartVisible('banner', !hidden);
					else if (part === Parts.PANEL_PART) context.shell.setPartVisible('panel', !hidden);
					else throw new Error('Settings cannot hide this shell part.');
				}
			}, context.document.fonts.ready.then(() => undefined)));
			const clipboard = environment.createClipboard(layout);
			if (isDisposable(clipboard)) dependencies.add(clipboard);
			const leases: IDisposable[] = [];
			const originalInert = new Map<HTMLElement, boolean>();
			let previousFocus: HTMLElement | undefined;
			const host = dependencies.add(new EditorWindowHostService(context.document.defaultView!, {
				...environment.window,
				async setDimmed(dimmed) {
					if (dimmed) {
						if (!leases.length) previousFocus = context.document.activeElement instanceof context.document.defaultView!.HTMLElement ? context.document.activeElement : undefined;
						if (!leases.length) for (const part of context.composition.layout.parts) {
							const element = context.shell.part(part); originalInert.set(element, element.inert); element.inert = true;
						}
						leases.push(context.shell.overlayHost.acquireExternalModal());
					} else {
						leases.pop()?.dispose();
						if (!leases.length) {
							for (const [element, inert] of originalInert) element.inert = inert;
							originalInert.clear();
							// Original modal focus restoration occurs before its disposal releases
							// Proctor's inert background. Complete that restoration after releasing it.
							if (previousFocus?.isConnected) previousFocus.focus();
							else context.shell.focusVisiblePart(['content']);
							previousFocus = undefined;
						}
					}
				}
			}));
			dependencies.add(toDisposable(() => { for (const lease of leases.splice(0)) lease.dispose(); for (const [element, inert] of originalInert) element.inert = inert; }));
			let modal: SettingsModal | undefined;
			let openingRuntime: Promise<SettingsModal> | undefined;
			let latestProjection: UserSettingsProjection | undefined;
			let projectionSequence = 0;
			let projectionRequest: Promise<UserSettingsProjection> | undefined;
			const applyPresentation = (source: string, next: UserSettingsProjection): void => {
				const parsed = parseSettingsDocument(source);
				const tokens = settingsRegistry.normalize('editor.tokenColorCustomizations', parsed.values.get('editor.tokenColorCustomizations') ?? {});
				const semantic = settingsRegistry.normalize('editor.semanticTokenColorCustomizations', parsed.values.get('editor.semanticTokenColorCustomizations') ?? {});
				presentation.setTheme(next.presentation.theme, next.presentation.colorCustomizations, tokens, semantic);
				presentation.setMotionPreference(next.presentation.reducedMotion ? 'reduced' : 'full');
				presentation.setZoomPercent(next.presentation.zoomPercent);
			};
			store.add(toDisposable(client.onDidChange(next => {
				if (store.isDisposed) return;
				projectionSequence++; latestProjection = next;
				if (!modal) applyPresentation(next.source, next);
			})));
			const loadProjection = (): Promise<UserSettingsProjection> => projectionRequest ??= (async () => {
				const sequence = projectionSequence;
				const snapshot = await client.projection();
				if (store.isDisposed) throw new Error('Settings window is closed.');
				const next = sequence === projectionSequence ? snapshot : latestProjection!;
				latestProjection = next;
				if (!modal) applyPresentation(next.source, next);
				return next;
			})().finally(() => { projectionRequest = undefined; });
			void loadProjection().catch(() => { if (!store.isDisposed) notifications.error(localize('settings.loadFailed', 'Settings are unavailable. Open Settings to try again.')); });
			let assemblingRuntime = false;
			const initialize = (): Promise<SettingsModal> => openingRuntime ??= (async () => {
				const initial = await loadProjection();
				if (store.isDisposed) throw new Error('Settings window is closed.');
				assemblingRuntime = true;
				const runtime = dependencies.add(new SettingsEditorWindowServices(services, instantiation, {
					source: initial.source, document: context.document, presentation, layout, clipboard, notifications,
					isSettingsReadonly: () => modal?.isReadonly ?? true
				}));
				await runtime.initialize();
				if (store.isDisposed) throw new Error('Settings window is closed.');
				const progressBar = dependencies.add(new ProgressBar(context.shell.element, { ...defaultProgressBarStyles, ariaLabel: localize('settings.progress', 'Settings progress') }));
				const progress = dependencies.add(new ScopedProgressIndicator(progressBar, { onDidChangeActive: Event.None, isActive: true }));
				dependencies.add(new SettingsEditorControlServices(services, instantiation, {
					storage: dependencies.add(new InMemoryStorageService()), isDevelopment: environment.isDevelopment, progress, windowHost: host,
					createContextMenu: owner => environment.createContextMenu(services, owner),
					createOpener: owner => {
						const opener = owner.createInstance(OpenerService);
						dependencies.add(opener.registerValidator({ shouldOpen: async resource => resource.toString() === userSettingsResource.toString() }));
						return opener;
					}
				}));
				const editorParts = editors.add(new SettingsEditorPartServices(services, instantiation, layout, runtime.editors));
				modal = editors.add(new SettingsModal(services, instantiation, editorParts, client, context.document, initial, applyPresentation));
				return modal;
			})().catch(error => {
				// A transient server read must not permanently disable the Settings entrypoint.
				if (!assemblingRuntime) openingRuntime = undefined;
				throw error;
			});
			store.add(new SettingsOpenActions(async (json, options) => {
				const owner = await initialize();
				return json ? owner.openSettingsJson(options) : owner.openSettingsUi(options);
			}));
			const open = (): void => {
				void initialize().then(owner => owner.openSettingsUi()).catch(() => {
					if (!store.isDisposed) notifications.error(localize('settings.openFailed', 'Settings could not be opened.'));
				});
			};
			store.add(navigation.onDidRequestSettings(open));
			if (navigation.settingsRequested) open();
		}
	};
}
