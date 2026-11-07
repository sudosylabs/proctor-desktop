/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port electron-window-skeleton
import { ExamActivityIpcBridge, type ExamActivityService } from '../../examActivity/electron-main/examActivityIpc.js';

import { bindWindowUserSettings } from '../../settings/electron-main/userSettingsWindow.js';
import type { UserSettingsSessionService } from '../../settings/common/userSettingsSession.js';
import { SettingsNativeIpcBridge } from '../../settings/electron-main/settingsNativeIpc.js';
import { createElectronSettingsNativeHost } from '../../settings/electron-main/electronSettingsNativeHost.js';

import {
	app,
	BrowserWindow,
	ipcMain,
	Menu,
	nativeTheme,
	type BrowserWindowConstructorOptions,
	type IpcMainInvokeEvent,
	type WebContents
} from 'electron';
import { AccountIpcBridge, type AccountService } from '../../account/electron-main/accountIpc.js';
import { release } from 'node:os';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import type { DesktopIdentityCoordinator } from '../../identity/electron-main/desktopIdentityCoordinator.js';
import { LaunchIdentityIpcBridge } from '../../identity/electron-main/launchIdentityIpc.js';
import { getTheme, type ThemeId } from '../../theme/common/themes.js';
import type {
	ManagedProductWindow,
	ProductWindowFactory,
	ProductWindowTerminationReason
} from '../common/windowCoordinator.js';
import { PRODUCT_WINDOW_TITLE } from '../common/windowChrome.js';
import { WINDOW_CHANNELS } from '../common/windowChannels.js';
import { installLaunchWindowMenu } from './launchWindowMenu.js';
import { createLiquidGlass } from './liquidGlass.js';
import { WindowMaterial, windowMaterialCreationOptions } from './windowMaterial.js';
import { PROCTOR_SCHEME_THEME_NAMES } from '../../theme/common/bundledThemes.js';
import {
	validateWindowIntent,
	type ProductWindowDescriptor,
	type ProductWindowIntent,
	type ProductWindowKind
} from '../common/windowProtocol.js';
import {
	ElectronWindowChromeBridge,
	resolveProductWindowChromeConfiguration,
	type ElectronPlatform
} from './electronWindowChrome.js';

export interface ElectronProductWindowPaths {
	readonly rendererByKind: Readonly<Record<ProductWindowKind, string>>;
	readonly preloadByKind: Readonly<Record<ProductWindowKind, string>>;
}

export interface ElectronWindowChromeEnvironment {
	readonly platform: ElectronPlatform;
	readonly locale: string;
	readonly macOsRelease: string;
	readonly initialTheme: ThemeId;
	/** The operating-system release on every platform; `macOsRelease` when omitted. */
	readonly osRelease?: string;
	readonly reducedTransparency?: boolean;
}

export interface ElectronProductWindowFactoryOptions extends ElectronProductWindowPaths {
	readonly production: boolean;
	readonly runtimeIconPath?: string;
	readonly ipc?: Pick<typeof ipcMain, 'handle' | 'removeHandler'>;
	readonly launchIdentity?: DesktopIdentityCoordinator;
	readonly account?: AccountService;
	readonly examActivity?: ExamActivityService;
	readonly settings?: UserSettingsSessionService;
	readonly windowChromeEnvironment?: ElectronWindowChromeEnvironment;
	/** Where the build staged @vnilink/elg; without it, macOS 26 falls back to vibrancy. */
	readonly liquidGlassDirectory?: string;
}

export function assertProductWindowIpcSender(
	event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
	contents: Pick<WebContents, 'id' | 'mainFrame'>,
	destroyed: boolean
): void {
	if (event.sender.id !== contents.id || event.senderFrame !== contents.mainFrame || destroyed)
		throw new Error('Unauthorized product window sender');
}

export function lockedBrowserWindowOptions(
	kind: ProductWindowKind,
	preload: string,
	production: boolean,
	runtimeIconPath?: string,
	chromeEnvironment: ElectronWindowChromeEnvironment = electronWindowChromeEnvironment()
): BrowserWindowConstructorOptions {
	const candidate = kind === 'candidate';
	const launch = kind === 'launch';
	const chrome = resolveProductWindowChromeConfiguration(
		chromeEnvironment.platform,
		chromeEnvironment.locale,
		chromeEnvironment.macOsRelease,
		candidate ? undefined : kind
	);
	const theme = getTheme(chromeEnvironment.initialTheme);
	// LaunchWindow and AuthenticatedWindow render with the Proctor palette, so their native colors come from it too.
	const palette = candidate ? theme : getTheme(proctorThemeName(theme.isDark));
	const background = palette.values['color.background.canvas'];
	// CandidateWindow stays opaque; the other windows show the system material.
	const material = candidate
		? { backgroundColor: background }
		: windowMaterialCreationOptions(
				chromeEnvironment.platform,
				chromeEnvironment.osRelease ?? chromeEnvironment.macOsRelease,
				materialPreferences(chromeEnvironment),
				background
			);
	return {
		width: candidate ? 1280 : launch ? 440 : 1180,
		height: candidate ? 800 : launch ? 600 : 760,
		minWidth: candidate ? undefined : launch ? 440 : 640,
		minHeight: candidate ? undefined : launch ? 600 : 480,
		// LaunchWindow is a fixed utility window; zoom reflows its content inside a scroll region.
		...(launch
			? { center: true, fullscreen: false, fullscreenable: false, maximizable: false, resizable: false }
			: {}),
		show: false,
		autoHideMenuBar: true,
		...(runtimeIconPath === undefined ? {} : { icon: runtimeIconPath }),
		...(candidate
			? {
					closable: false,
					frame: false,
					fullscreenable: false,
					maximizable: false,
					minimizable: false,
					movable: false,
					resizable: false,
					titleBarStyle: 'hidden' as const
				}
			: chrome.mode === 'nativeTrafficLights'
				? {
						acceptFirstMouse: true,
						...material,
						title: PRODUCT_WINDOW_TITLE,
						titleBarStyle: 'hidden' as const,
						titleBarOverlay: true
					}
				: {
						...material,
						frame: false,
						title: PRODUCT_WINDOW_TITLE,
						titleBarStyle: 'hidden' as const,
						titleBarOverlay: {
							color: material.backgroundMaterial === 'mica' ? '#00000000' : background,
							symbolColor: palette.colors['titleBar.activeForeground'] ?? palette.values['color.text.primary'],
							height: chrome.titlebarHeight - 1
						}
					}),
		webPreferences: {
			preload,
			allowRunningInsecureContent: false,
			contextIsolation: true,
			devTools: !production,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			nodeIntegrationInWorker: false,
			sandbox: true,
			spellcheck: false,
			webSecurity: true,
			webviewTag: false
		}
	};
}

function proctorThemeName(dark: boolean): string {
	return dark ? PROCTOR_SCHEME_THEME_NAMES.dark : PROCTOR_SCHEME_THEME_NAMES.light;
}

/** The opaque color of a window with a material: the Proctor palette it renders with. */
function proctorBackground(dark: boolean): string {
	return getTheme(proctorThemeName(dark)).values['color.background.canvas'];
}

function materialPreferences(environment: ElectronWindowChromeEnvironment): {
	readonly reducedTransparency: boolean;
	readonly highContrast: boolean;
} {
	return {
		reducedTransparency: environment.reducedTransparency === true,
		highContrast:
			environment.initialTheme === 'highContrastDark' ||
			environment.initialTheme === 'highContrastLight'
	};
}

export function electronWindowChromeEnvironment(): ElectronWindowChromeEnvironment {
	const platform: ElectronPlatform =
		process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';
	return Object.freeze({
		platform,
		locale: app.isReady() ? app.getLocale() : 'en',
		macOsRelease: release(),
		osRelease: release(),
		reducedTransparency: nativeTheme.prefersReducedTransparency,
		initialTheme: nativeTheme.shouldUseHighContrastColors
			? nativeTheme.shouldUseDarkColors
				? 'highContrastDark'
				: 'highContrastLight'
			: nativeTheme.shouldUseDarkColors
				? 'dark'
				: 'light'
	});
}

export class ElectronProductWindowFactory implements ProductWindowFactory {
	readonly #options: ElectronProductWindowFactoryOptions;

	constructor(options: ElectronProductWindowFactoryOptions) {
		this.#options = options;
		if (options.production) Menu.setApplicationMenu(null);
	}

	create(
		descriptor: ProductWindowDescriptor,
		onIntent: (intent: ProductWindowIntent) => void,
		onTerminated: (reason: ProductWindowTerminationReason) => void
	): ManagedProductWindow {
		if (this.#options.production && descriptor.kind==='authenticated' && descriptor.developmentOrigin) throw new Error('Production windows cannot use development HTTP');
		const channels = WINDOW_CHANNELS[descriptor.kind];
		// Release any scheme a signed-in window pinned, so LaunchWindow opens in the system scheme.
		if (descriptor.kind === 'launch') nativeTheme.themeSource = 'system';
		const chromeEnvironment =
			this.#options.windowChromeEnvironment ?? electronWindowChromeEnvironment();
		const window = new BrowserWindow(
			lockedBrowserWindowOptions(
				descriptor.kind,
				this.#options.preloadByKind[descriptor.kind],
				this.#options.production,
				this.#options.runtimeIconPath,
				chromeEnvironment
			)
		);
		try {
			if (descriptor.kind !== 'launch') Menu.setApplicationMenu(null);
			if (this.#options.production) {
				window.setMenu(null);
				window.webContents.setIgnoreMenuShortcuts(descriptor.kind !== 'launch');
				window.webContents.on('before-input-event', (event, input) => {
					if (
						input.type === 'keyDown' &&
						(input.key === 'F5' ||
							(input.key.toLowerCase() === 'r' && (input.control || input.meta)))
					)
						event.preventDefault();
				});
			}
			const material =
				descriptor.kind === 'candidate'
					? undefined
					: new WindowMaterial(window, {
							platform: chromeEnvironment.platform,
							osRelease: chromeEnvironment.osRelease ?? chromeEnvironment.macOsRelease,
							theme: nativeTheme,
							background: proctorBackground,
							createGlass: () => createLiquidGlass(this.#options.liquidGlassDirectory)
						});
			const rendererPath = this.#options.rendererByKind[descriptor.kind];
			const managed = new ElectronManagedProductWindow(
				window,
				descriptor,
				channels.bootstrap,
				channels.intent,
				rendererPath,
				onIntent,
				onTerminated,
				this.#options.ipc ?? ipcMain,
				chromeEnvironment,
				this.#options.launchIdentity,
				this.#options.account,
				this.#options.settings,
				this.#options.examActivity,
				material
			);
			void window.loadFile(rendererPath).catch(() => {
				managed.terminate('loadFailed');
			});
			return managed;
		} catch (error) {
			if (!window.isDestroyed()) window.destroy();
			throw error;
		}
	}
}

class ElectronManagedProductWindow implements ManagedProductWindow {
	readonly descriptor: ProductWindowDescriptor;
	readonly #window: BrowserWindow;
	readonly #bootstrapChannel: string;
	readonly #intentChannel: string;
	#vetoClose = false;
	#showRequested = false;
	#destroyed = false;
	#launchIdentityBridge: LaunchIdentityIpcBridge | undefined;
	#windowChromeBridge: ElectronWindowChromeBridge | undefined;
	#accountBridge: AccountIpcBridge | undefined;
	#examActivityBridge: ExamActivityIpcBridge | undefined;
	#settings: {dispose(): void} | undefined;
	#settingsNativeBridge: SettingsNativeIpcBridge | undefined;
	#launchMenu: { dispose(): void } | undefined;
	#material: WindowMaterial | undefined;

	constructor(
		window: BrowserWindow,
		descriptor: ProductWindowDescriptor,
		bootstrapChannel: string,
		intentChannel: string,
		rendererPath: string,
		onIntent: (intent: ProductWindowIntent) => void,
		private readonly onTerminated: (reason: ProductWindowTerminationReason) => void,
		private readonly ipc: Pick<typeof ipcMain, 'handle' | 'removeHandler'>,
		chromeEnvironment: ElectronWindowChromeEnvironment,
		launchIdentity?: DesktopIdentityCoordinator,
		account?: AccountService,
		settings?: UserSettingsSessionService,
		examActivity?: ExamActivityService,
		material?: WindowMaterial
	) {
		this.#window = window;
		this.descriptor = descriptor;
		this.#bootstrapChannel = bootstrapChannel;
		this.#intentChannel = intentChannel;
		this.#material = material;
		const authorize = (event: IpcMainInvokeEvent): void =>
			assertProductWindowIpcSender(event, window.webContents, this.#destroyed);
		const handled: string[] = [];
		try {
			ipc.handle(bootstrapChannel, (event) => {
				authorize(event);
				return descriptor;
			});
			handled.push(bootstrapChannel);
			ipc.handle(intentChannel, (event, value: unknown) => {
				authorize(event);
				onIntent(validateWindowIntent(descriptor.kind, value));
			});
			handled.push(intentChannel);
			if (descriptor.kind !== 'candidate') {
				// LaunchWindow follows the operating-system scheme, so it never pins the native theme.
				// AuthenticatedWindow pins it only while a chosen theme overrides the system scheme,
				// so its material matches the page.
				const synchronizeTheme = descriptor.kind === 'launch'
					? undefined
					: (scheme: 'light' | 'dark' | 'system') => {
						nativeTheme.themeSource = scheme;
					};
				this.#windowChromeBridge = new ElectronWindowChromeBridge(
					ipc,
					{ window, contents: window.webContents, synchronizeTheme },
					descriptor.kind,
					resolveProductWindowChromeConfiguration(
						chromeEnvironment.platform,
						chromeEnvironment.locale,
						chromeEnvironment.macOsRelease,
						descriptor.kind
					),
					chromeEnvironment.initialTheme,
					authorize,
					material
				);
			}
			if (descriptor.kind === 'launch' && launchIdentity)
				this.#launchIdentityBridge = new LaunchIdentityIpcBridge(
					ipc,
					window.webContents,
					launchIdentity
				);
			if (descriptor.kind === 'authenticated' && settings)
				this.#settings = bindWindowUserSettings(ipc, window.webContents, descriptor, settings);
			if (descriptor.kind === 'authenticated')
				this.#settingsNativeBridge = new SettingsNativeIpcBridge(ipc, createElectronSettingsNativeHost(window), authorize);
			if (descriptor.kind === 'authenticated' && examActivity)
				this.#examActivityBridge = new ExamActivityIpcBridge(ipc, descriptor, examActivity, authorize);
			if (descriptor.kind === 'authenticated' && account)
				this.#accountBridge = new AccountIpcBridge(ipc, descriptor, account, authorize);
			if (descriptor.kind === 'authenticated' && account?.setApiFocused) {
				const focused = (value: boolean) => {
					try { account.setApiFocused!(descriptor, value); }
					catch { /* Session teardown has already fenced the client. */ }
				};
				window.on('focus', () => focused(true));
				window.on('blur', () => focused(false));
				focused(window.isFocused());
			}
			window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
			const initialUrl = pathToFileURL(rendererPath).href;
			let initialNavigation = true;
			window.webContents.on('will-navigate', (event, url) => {
				if (initialNavigation && url === initialUrl) {
					initialNavigation = false;
					return;
				}
				event.preventDefault();
			});
			window.webContents.on('will-attach-webview', (event) => event.preventDefault());
			window.webContents.session.setPermissionCheckHandler(() => false);
			window.webContents.session.setPermissionRequestHandler(
				(_contents, _permission, callback) => callback(false)
			);
			window.on('close', (event) => {
				if (this.#vetoClose && !this.#destroyed) event.preventDefault();
			});
			window.once('closed', () => this.terminate('closed'));
			window.once('ready-to-show', () => {
				if (this.#showRequested && !this.#destroyed) window.show();
			});
			if (descriptor.kind === 'launch')
				this.#launchMenu = installLaunchWindowMenu(
					window,
					chromeEnvironment.locale,
					() => launchIdentity?.projection(),
					() => {
						if (!this.#destroyed) onIntent({ kind: 'launch.exit' });
					}
				);
		} catch (error) {
			this.#destroyed = true;
			const cleanupErrors: unknown[] = [];
			for (const disposable of [
				this.#launchMenu,
				this.#launchIdentityBridge,
				this.#accountBridge,
				this.#examActivityBridge,
				this.#settings,
				this.#settingsNativeBridge,
				this.#windowChromeBridge,
				this.#material
			]) {
				try {
					disposable?.dispose();
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
			}
			for (const channel of handled.reverse()) {
				try {
					ipc.removeHandler(channel);
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
			}
			try {
				if (!window.isDestroyed()) window.destroy();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			if (cleanupErrors.length > 0)
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Product window construction and rollback failed'
				);
			throw error;
		}
	}

	get destroyed(): boolean {
		return this.#destroyed || this.#window.isDestroyed();
	}

	show(): void {
		this.#showRequested = true;
		if (!this.destroyed && !this.#window.webContents.isLoading()) this.#window.show();
	}

	setCloseVeto(veto: boolean): void {
		if (this.#destroyed) throw new Error('Product window is destroyed');
		this.#vetoClose = veto;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const errors = this.#releaseResources();
		if (errors.length > 0)
			throw new AggregateError(errors, 'Product window destruction failed');
	}

	terminate(reason: ProductWindowTerminationReason): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const errors = this.#releaseResources();
		try {
			this.onTerminated(reason);
		} catch (error) {
			errors.push(error);
		}
		if (errors.length > 0)
			throw new AggregateError(errors, 'Product window termination failed');
	}

	#releaseResources(): unknown[] {
		const errors: unknown[] = [];
		for (const disposable of [
			this.#launchMenu,
			this.#launchIdentityBridge,
				this.#accountBridge,
				this.#examActivityBridge,
				this.#settings,
				this.#settingsNativeBridge,
			this.#windowChromeBridge,
			this.#material
		]) {
			try {
				disposable?.dispose();
			} catch (error) {
				errors.push(error);
			}
		}
		for (const channel of [this.#bootstrapChannel, this.#intentChannel]) {
			try {
				this.ipc.removeHandler(channel);
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			if (!this.#window.isDestroyed()) this.#window.destroy();
		} catch (error) {
			errors.push(error);
		}
		return errors;
	}
}
