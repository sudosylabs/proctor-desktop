import { BrowserWindow, ipcMain, Menu, type BrowserWindowConstructorOptions, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { pathToFileURL } from 'node:url';
import type { ManagedProductWindow, ProductWindowFactory, ProductWindowTerminationReason } from '../common/windowCoordinator.js';
import { WINDOW_CHANNELS } from '../common/windowChannels.js';
import { validateWindowIntent, type ProductWindowDescriptor, type ProductWindowIntent, type ProductWindowKind } from '../common/windowProtocol.js';
import type { DesktopIdentityCoordinator } from '../../identity/electron-main/desktopIdentityCoordinator.js';
import { LaunchIdentityIpcBridge } from '../../identity/electron-main/launchIdentityIpc.js';

export interface ElectronProductWindowPaths {
  readonly rendererByKind: Readonly<Record<ProductWindowKind, string>>;
  readonly preloadByKind: Readonly<Record<ProductWindowKind, string>>;
}

export interface ElectronProductWindowFactoryOptions extends ElectronProductWindowPaths {
  readonly production: boolean;
  readonly runtimeIconPath?: string;
  readonly ipc?: Pick<typeof ipcMain, 'handle' | 'removeHandler'>;
  readonly launchIdentity?: DesktopIdentityCoordinator;
}

export function assertProductWindowIpcSender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, contents: Pick<WebContents, 'id' | 'mainFrame'>, destroyed: boolean): void {
  if (event.sender.id !== contents.id || event.senderFrame !== contents.mainFrame || destroyed) throw new Error('Unauthorized product window sender');
}

export function lockedBrowserWindowOptions(kind: ProductWindowKind, preload: string, production: boolean, runtimeIconPath?: string): BrowserWindowConstructorOptions {
  const candidate = kind === 'candidate';
  return {
    width: candidate ? 1280 : kind === 'launch' ? 760 : 1180,
    height: candidate ? 800 : kind === 'launch' ? 560 : 760,
    minWidth: candidate ? undefined : 640,
    minHeight: candidate ? undefined : 480,
    show: false,
    autoHideMenuBar: true,
    ...(runtimeIconPath === undefined ? {} : { icon: runtimeIconPath }),
    ...(candidate ? { closable: false, frame: false, fullscreenable: false, maximizable: false, minimizable: false, movable: false, resizable: false, titleBarStyle: 'hidden' as const } : {}),
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

export class ElectronProductWindowFactory implements ProductWindowFactory {
  readonly #options: ElectronProductWindowFactoryOptions;
  constructor(options: ElectronProductWindowFactoryOptions) { this.#options = options; if (options.production) Menu.setApplicationMenu(null); }

  create(descriptor: ProductWindowDescriptor, onIntent: (intent: ProductWindowIntent) => void, onTerminated: (reason: ProductWindowTerminationReason) => void): ManagedProductWindow {
    const channels = WINDOW_CHANNELS[descriptor.kind];
    const window = new BrowserWindow(lockedBrowserWindowOptions(descriptor.kind, this.#options.preloadByKind[descriptor.kind], this.#options.production, this.#options.runtimeIconPath));
    try {
      if (this.#options.production) { window.setMenu(null); window.webContents.setIgnoreMenuShortcuts(true); window.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && (input.key === 'F5' || input.key.toLowerCase() === 'r' && (input.control || input.meta))) event.preventDefault(); }); }
      const rendererPath = this.#options.rendererByKind[descriptor.kind];
      const managed = new ElectronManagedProductWindow(window, descriptor, channels.bootstrap, channels.intent, rendererPath, onIntent, onTerminated, this.#options.ipc ?? ipcMain, this.#options.launchIdentity);
      void window.loadFile(rendererPath).catch(() => { managed.terminate('loadFailed'); });
      return managed;
    } catch (error) { if (!window.isDestroyed()) window.destroy(); throw error; }
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

  constructor(window: BrowserWindow, descriptor: ProductWindowDescriptor, bootstrapChannel: string, intentChannel: string, rendererPath: string, onIntent: (intent: ProductWindowIntent) => void, private readonly onTerminated: (reason: ProductWindowTerminationReason) => void, private readonly ipc: Pick<typeof ipcMain, 'handle' | 'removeHandler'>, launchIdentity?: DesktopIdentityCoordinator) {
    this.#window = window; this.descriptor = descriptor; this.#bootstrapChannel = bootstrapChannel; this.#intentChannel = intentChannel;
    const authorize = (event: IpcMainInvokeEvent): void => assertProductWindowIpcSender(event, window.webContents, this.#destroyed); const handled: string[] = [];
    try {
      ipc.handle(bootstrapChannel, event => { authorize(event); return descriptor; }); handled.push(bootstrapChannel);
      ipc.handle(intentChannel, (event, value: unknown) => { authorize(event); onIntent(validateWindowIntent(descriptor.kind, value)); }); handled.push(intentChannel);
      if (descriptor.kind === 'launch' && launchIdentity) this.#launchIdentityBridge = new LaunchIdentityIpcBridge(ipc, window.webContents, launchIdentity);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const initialUrl = pathToFileURL(rendererPath).href; let initialNavigation = true;
      window.webContents.on('will-navigate', (event, url) => { if (initialNavigation && url === initialUrl) { initialNavigation = false; return; } event.preventDefault(); });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.on('close', event => { if (this.#vetoClose && !this.#destroyed) event.preventDefault(); });
      window.once('closed', () => this.terminate('closed'));
      window.once('ready-to-show', () => { if (this.#showRequested && !this.#destroyed) window.show(); });
    } catch (error) { this.#destroyed = true; const cleanupErrors: unknown[] = []; try { this.#launchIdentityBridge?.dispose(); } catch (cleanupError) { cleanupErrors.push(cleanupError); } for (const channel of handled.reverse()) { try { ipc.removeHandler(channel); } catch (cleanupError) { cleanupErrors.push(cleanupError); } } try { if (!window.isDestroyed()) window.destroy(); } catch (cleanupError) { cleanupErrors.push(cleanupError); } if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], 'Product window construction and rollback failed'); throw error; }
  }

  get destroyed(): boolean { return this.#destroyed || this.#window.isDestroyed(); }
  show(): void { this.#showRequested = true; if (!this.destroyed && !this.#window.webContents.isLoading()) this.#window.show(); }
  setCloseVeto(veto: boolean): void { if (this.#destroyed) throw new Error('Product window is destroyed'); this.#vetoClose = veto; }
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const errors = this.#releaseResources(); if (errors.length > 0) throw new AggregateError(errors, 'Product window destruction failed');
  }
  terminate(reason: ProductWindowTerminationReason): void {
    if (this.#destroyed) return; this.#destroyed = true; const errors = this.#releaseResources(); try { this.onTerminated(reason); } catch (error) { errors.push(error); } if (errors.length > 0) throw new AggregateError(errors, 'Product window termination failed');
  }
  #releaseResources(): unknown[] {
    const errors: unknown[] = []; try { this.#launchIdentityBridge?.dispose(); } catch (error) { errors.push(error); } for (const channel of [this.#bootstrapChannel, this.#intentChannel]) { try { this.ipc.removeHandler(channel); } catch (error) { errors.push(error); } } try { if (!this.#window.isDestroyed()) this.#window.destroy(); } catch (error) { errors.push(error); } return errors;
  }
}
