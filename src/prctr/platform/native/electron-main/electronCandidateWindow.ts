import {
	BrowserWindow,
	Menu,
	screen,
	type BrowserWindowConstructorOptions,
	type Rectangle
} from 'electron';
import {
	isCandidateWindowState,
	type CandidateWindowHostEvent,
	type CandidateWindowState,
	type PlatformFamily
} from '../common/nativeObservation.generated.js';
import {
	CandidateWindowEnforcer,
	type CandidateWindowConstraintVerification,
	type CandidateWindowEnforcementFailure,
	type CandidateWindowEnforcementHost
} from './candidateWindowEnforcer.js';

export interface ElectronCandidateWindowOptions {
	readonly backgroundColor?: string;
	readonly preloadPath?: string;
	readonly title?: string;
	readonly verifiedDisplayTargetId: string;
	readonly onEvent: (event: CandidateWindowHostEvent) => void;
	readonly onFailure: (failure: CandidateWindowEnforcementFailure) => void;
	readonly monotonicNow?: () => number;
}

type WindowStateEvent =
	| 'blur'
	| 'enter-full-screen'
	| 'focus'
	| 'hide'
	| 'leave-full-screen'
	| 'maximize'
	| 'minimize'
	| 'move'
	| 'resize'
	| 'restore'
	| 'show'
	| 'unmaximize';

type UntypedWindowEventTarget = {
	on(event: string, listener: (...arguments_: unknown[]) => void): void;
	off(event: string, listener: (...arguments_: unknown[]) => void): void;
};

type Disposable = { readonly dispose: () => void };

type PlatformConstraintVerification = Pick<
	CandidateWindowConstraintVerification,
	| 'contentProtection'
	| 'maximizePrevented'
	| 'menuHidden'
	| 'minimizePrevented'
	| 'movePrevented'
	| 'resizePrevented'
>;

interface CandidateWindowPlatformConstraints {
	apply(): void;
	verify(moveVetoCount: number, resizeVetoCount: number): PlatformConstraintVerification;
	isFullscreen(): boolean;
	clearFullscreen(): void;
	completeRelease(): void;
}

export function createElectronCandidateWindow(
	options: ElectronCandidateWindowOptions
): CandidateWindowEnforcer {
	if (!isValidDisplayTargetId(options.verifiedDisplayTargetId)) {
		throw new TypeError('verified display target id must contain 1 to 128 code points');
	}
	const platform = platformFamily(process.platform);
	const browserWindow = new BrowserWindow(candidateWindowOptions(options));
	const host = new ElectronCandidateWindowEnforcementHost(
		browserWindow,
		options.verifiedDisplayTargetId,
		platform
	);
	return new CandidateWindowEnforcer({
		host,
		onEvent: options.onEvent,
		onFailure: options.onFailure,
		monotonicNow: options.monotonicNow
	});
}

function candidateWindowOptions(
	options: ElectronCandidateWindowOptions
): BrowserWindowConstructorOptions {
	return {
		...(options.backgroundColor === undefined
			? {}
			: { backgroundColor: options.backgroundColor }),
		...(options.title === undefined ? {} : { title: options.title }),
		alwaysOnTop: false,
		autoHideMenuBar: true,
		closable: false,
		frame: false,
		fullscreen: false,
		fullscreenable: false,
		kiosk: false,
		maximizable: false,
		minimizable: false,
		movable: false,
		resizable: false,
		show: false,
		titleBarOverlay: false,
		titleBarStyle: 'hidden',
		webPreferences: {
			...(options.preloadPath === undefined ? {} : { preload: options.preloadPath }),
			allowRunningInsecureContent: false,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			nodeIntegrationInWorker: false,
			sandbox: true,
			webSecurity: true,
			webviewTag: false
		}
	};
}

class ElectronCandidateWindowEnforcementHost implements CandidateWindowEnforcementHost {
	readonly #window: BrowserWindow;
	readonly #verifiedDisplayTargetId: string;
	readonly #eventTarget: UntypedWindowEventTarget;
	readonly #platformConstraints: CandidateWindowPlatformConstraints;
	readonly #constraintFailureListeners = new Set<() => void>();
	readonly #listenerStores = new Set<RetryableDisposableStore>();
	readonly platform: PlatformFamily;
	#closeVetoCount = 0;
	#moveVetoCount = 0;
	#resizeVetoCount = 0;
	#released = false;

	public constructor(
		window: BrowserWindow,
		verifiedDisplayTargetId: string,
		platform: PlatformFamily
	) {
		this.#window = window;
		this.#verifiedDisplayTargetId = verifiedDisplayTargetId;
		this.#eventTarget = window as unknown as UntypedWindowEventTarget;
		this.#platformConstraints = platformConstraintStrategy(platform, window);
		this.platform = platform;
	}

	public applyConstraints(): void {
		this.#assertPresent();
		this.#window.setAlwaysOnTop(false);
		this.#window.setKiosk(false);
		this.#platformConstraints.clearFullscreen();
		this.#window.setFullScreenable(false);
		this.#platformConstraints.apply();
	}

	public verifyConstraints(): CandidateWindowConstraintVerification {
		this.#assertPresent();
		return Object.freeze({
			alwaysOnTopDisabled: !this.#window.isAlwaysOnTop(),
			closePrevented: this.#closeVetoCount > 0,
			fullscreenPrevented:
				!this.#platformConstraints.isFullscreen() && !this.#window.isFullScreenable(),
			kioskDisabled: !this.#window.isKiosk(),
			maximized: this.#window.isMaximized(),
			nativeControlsAbsent: true,
			...this.#platformConstraints.verify(this.#moveVetoCount, this.#resizeVetoCount)
		});
	}

	public snapshot(): CandidateWindowState {
		if (this.#window.isDestroyed()) return absentWindowState();
		try {
			const bounds = this.#window.getBounds();
			const displayTargetId = this.#displayTargetId(bounds);
			return Object.freeze({
				certainty: displayTargetId === undefined ? 'partial' : 'complete',
				presence: 'present',
				focus: this.#window.isFocused() ? 'focused' : 'not_focused',
				visibility:
					this.#window.isVisible() && !this.#window.isMinimized()
						? 'visible'
						: 'not_visible',
				placement: this.#placement(),
				bounds: Object.freeze({ ...bounds }),
				...(displayTargetId === undefined ? {} : { display_target_id: displayTargetId })
			});
		} catch {
			return this.#window.isDestroyed() ? absentWindowState() : unknownWindowState();
		}
	}

	public isValidWindowState(value: unknown): value is CandidateWindowState {
		return isCandidateWindowState(value);
	}

	public onEnforcementFailure(listener: () => void): Disposable {
		return this.#installListenerSet((store) => {
			this.#constraintFailureListeners.add(listener);
			store.add({ dispose: () => this.#constraintFailureListeners.delete(listener) });
		});
	}

	public onStateTransition(listener: () => void): Disposable {
		return this.#installListenerSet((store) => {
			const register = (event: WindowStateEvent, after?: () => void): void => {
				const handler = (): void => {
					try {
						listener();
						after?.();
					} catch {
						this.#reportConstraintFailure();
					}
				};
				this.#eventTarget.on(event, handler);
				store.add({ dispose: () => this.#eventTarget.off(event, handler) });
			};

			register('blur');
			register('focus');
			register('hide');
			register('show');
			register('maximize');
			register('restore', () => this.#restoreMaximizedConstraint());
			register('leave-full-screen', () => this.#restoreMaximizedConstraint());
			register('unmaximize', () => this.#restoreMaximizedConstraint());
			register('minimize', () => this.#restoreMaximizedConstraint());
			register('move', () => this.#restoreMaximizedConstraint());
			register('resize', () => this.#restoreMaximizedConstraint());
			register('enter-full-screen', () => this.#restoreFullscreenConstraint());

			const willMove = (event: Electron.Event): void => this.#preventDefault(event);
			const willResize = (event: Electron.Event): void => this.#preventDefault(event);
			this.#window.on('will-move', willMove);
			this.#moveVetoCount += 1;
			store.add({
				dispose: () => {
					this.#window.off('will-move', willMove);
					this.#moveVetoCount -= 1;
				}
			});
			this.#window.on('will-resize', willResize);
			this.#resizeVetoCount += 1;
			store.add({
				dispose: () => {
					this.#window.off('will-resize', willResize);
					this.#resizeVetoCount -= 1;
				}
			});
		});
	}

	public onCloseAttempt(listener: () => void): Disposable {
		return this.#installListenerSet((store) => {
			const close = (event: Electron.Event): void => {
				try {
					event.preventDefault();
					listener();
				} catch {
					this.#reportConstraintFailure();
				}
			};
			this.#window.on('close', close);
			this.#closeVetoCount += 1;
			store.add({
				dispose: () => {
					this.#window.off('close', close);
					this.#closeVetoCount -= 1;
				}
			});
		});
	}

	public onDestroyed(listener: () => void): Disposable {
		return this.#installListenerSet((store) => {
			this.#window.on('closed', listener);
			store.add({ dispose: () => this.#window.off('closed', listener) });
		});
	}

	public releaseWindow(): void {
		if (this.#released) return;
		if (!this.#window.isDestroyed()) this.#window.destroy();
		if (!this.#window.isDestroyed())
			throw new Error('candidate window release did not destroy window');
		this.#released = true;
	}

	public completeRelease(): void {
		this.#disposeOwnedListenerStores();
		this.#platformConstraints.completeRelease();
	}

	#placement(): CandidateWindowState['placement'] {
		if (this.#platformConstraints.isFullscreen()) {
			return 'fullscreen';
		}
		if (this.#window.isMinimized()) return 'minimized';
		if (this.#window.isMaximized()) return 'maximized';
		return 'normal';
	}

	#displayTargetId(bounds: Rectangle): string | undefined {
		const displays = screen.getAllDisplays();
		if (displays.length !== 1) return undefined;
		const display = displays[0];
		if (display === undefined || screen.getDisplayMatching(bounds).id !== display.id)
			return undefined;
		return this.#verifiedDisplayTargetId;
	}

	#restoreMaximizedConstraint(): void {
		if (!this.#released && !this.#window.isDestroyed() && !this.#window.isMaximized()) {
			this.#window.restore();
			this.#window.maximize();
		}
	}

	#restoreFullscreenConstraint(): void {
		if (this.#released || this.#window.isDestroyed()) return;
		this.#platformConstraints.clearFullscreen();
		this.#restoreMaximizedConstraint();
	}

	#preventDefault(event: Electron.Event): void {
		try {
			event.preventDefault();
		} catch {
			this.#reportConstraintFailure();
		}
	}

	#reportConstraintFailure(): void {
		for (const listener of this.#constraintFailureListeners) {
			try {
				listener();
			} catch {
				// Enforcement failures must never escape an Electron event callback.
			}
		}
	}

	#installListenerSet(install: (store: RetryableDisposableStore) => void): Disposable {
		let store: RetryableDisposableStore;
		store = new RetryableDisposableStore(() => this.#listenerStores.delete(store));
		this.#listenerStores.add(store);
		try {
			install(store);
			return store;
		} catch (setupError) {
			try {
				store.dispose();
			} catch (cleanupError) {
				throw new AggregateError(
					[cleanupError, setupError],
					'candidate window listener setup and rollback failed'
				);
			}
			throw setupError;
		}
	}

	#disposeOwnedListenerStores(): void {
		let failure: unknown;
		for (const store of [...this.#listenerStores].reverse()) {
			try {
				store.dispose();
			} catch (error) {
				failure ??= error;
			}
		}
		if (failure !== undefined) throw failure;
	}

	#assertPresent(): void {
		if (this.#window.isDestroyed()) throw new Error('candidate window is destroyed');
	}
}

function platformConstraintStrategy(
	platform: PlatformFamily,
	window: BrowserWindow
): CandidateWindowPlatformConstraints {
	switch (platform) {
		case 'macos':
			return new MacOSCandidateWindowConstraints(window);
		case 'windows':
			return new WindowsCandidateWindowConstraints(window);
		case 'linux':
			return new LinuxCandidateWindowConstraints(window);
	}
}

class MacOSCandidateWindowConstraints implements CandidateWindowPlatformConstraints {
	readonly #window: BrowserWindow;
	#previousApplicationMenu: ReturnType<typeof Menu.getApplicationMenu> | undefined;
	#applicationMenuCaptured = false;
	#applicationMenuSuppressed = false;
	#applicationMenuRestored = false;

	public constructor(window: BrowserWindow) {
		this.#window = window;
	}

	public apply(): void {
		if (!this.#applicationMenuCaptured) {
			this.#previousApplicationMenu = Menu.getApplicationMenu();
			this.#applicationMenuCaptured = true;
		}
		Menu.setApplicationMenu(null);
		this.#applicationMenuSuppressed = true;
		this.#window.setWindowButtonVisibility(false);
		this.#window.setResizable(true);
		this.#window.setMaximizable(true);
		this.#window.setClosable(true);
		this.#window.maximize();
		this.#window.setMaximizable(false);
		this.#window.setMovable(false);
		this.#window.setMinimizable(false);
		this.#window.setContentProtection(true);
	}

	public verify(moveVetoCount: number, resizeVetoCount: number): PlatformConstraintVerification {
		return {
			contentProtection: this.#window.isContentProtected() ? 'enabled' : 'failed',
			maximizePrevented: !this.#window.isMaximizable() && Menu.getApplicationMenu() === null,
			menuHidden: Menu.getApplicationMenu() === null,
			minimizePrevented: !this.#window.isMinimizable(),
			movePrevented: moveVetoCount > 0 && !this.#window.isMovable(),
			resizePrevented: resizeVetoCount > 0
		};
	}

	public isFullscreen(): boolean {
		return this.#window.isFullScreen() || this.#window.isSimpleFullScreen();
	}

	public clearFullscreen(): void {
		this.#window.setFullScreen(false);
		this.#window.setSimpleFullScreen(false);
	}

	public completeRelease(): void {
		if (!this.#applicationMenuSuppressed || this.#applicationMenuRestored) return;
		Menu.setApplicationMenu(this.#previousApplicationMenu ?? null);
		if (Menu.getApplicationMenu() !== this.#previousApplicationMenu) {
			throw new Error('candidate window application menu restoration could not be verified');
		}
		this.#applicationMenuRestored = true;
	}
}

class WindowsCandidateWindowConstraints implements CandidateWindowPlatformConstraints {
	readonly #window: BrowserWindow;

	public constructor(window: BrowserWindow) {
		this.#window = window;
	}

	public apply(): void {
		this.#suppressWindowMenu();
		this.#window.setResizable(true);
		this.#window.setMaximizable(true);
		this.#window.setClosable(true);
		this.#window.maximize();
		this.#window.setResizable(false);
		this.#window.setMaximizable(false);
		this.#window.setMovable(false);
		this.#window.setMinimizable(false);
		this.#window.setContentProtection(true);
	}

	public verify(moveVetoCount: number, resizeVetoCount: number): PlatformConstraintVerification {
		return {
			contentProtection: this.#window.isContentProtected() ? 'enabled' : 'failed',
			maximizePrevented: !this.#window.isMaximizable(),
			menuHidden: !this.#window.isMenuBarVisible(),
			minimizePrevented: !this.#window.isMinimizable(),
			movePrevented: moveVetoCount > 0 && !this.#window.isMovable(),
			resizePrevented: resizeVetoCount > 0 && !this.#window.isResizable()
		};
	}

	public isFullscreen(): boolean {
		return this.#window.isFullScreen();
	}

	public clearFullscreen(): void {
		this.#window.setFullScreen(false);
	}

	public completeRelease(): void {}

	#suppressWindowMenu(): void {
		this.#window.setMenu(null);
		this.#window.setAutoHideMenuBar(true);
		this.#window.setMenuBarVisibility(false);
	}
}

class LinuxCandidateWindowConstraints implements CandidateWindowPlatformConstraints {
	readonly #window: BrowserWindow;

	public constructor(window: BrowserWindow) {
		this.#window = window;
	}

	public apply(): void {
		this.#window.setMenu(null);
		this.#window.setAutoHideMenuBar(true);
		this.#window.setMenuBarVisibility(false);
		this.#window.setResizable(true);
		this.#window.maximize();
		this.#window.setResizable(false);
	}

	public verify(_moveVetoCount: number, resizeVetoCount: number): PlatformConstraintVerification {
		return {
			contentProtection: 'unavailable',
			maximizePrevented: false,
			menuHidden: !this.#window.isMenuBarVisible(),
			minimizePrevented: false,
			movePrevented: false,
			resizePrevented: resizeVetoCount > 0 && !this.#window.isResizable()
		};
	}

	public isFullscreen(): boolean {
		return this.#window.isFullScreen();
	}

	public clearFullscreen(): void {
		this.#window.setFullScreen(false);
	}

	public completeRelease(): void {}
}

class RetryableDisposableStore implements Disposable {
	readonly #pending: Disposable[] = [];
	readonly #onEmpty: () => void;

	public constructor(onEmpty: () => void) {
		this.#onEmpty = onEmpty;
	}

	public add(disposable: Disposable): void {
		this.#pending.push(disposable);
	}

	public dispose(): void {
		let failure: unknown;
		for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
			try {
				this.#pending[index]?.dispose();
				this.#pending.splice(index, 1);
			} catch (error) {
				failure ??= error;
			}
		}
		if (this.#pending.length === 0) this.#onEmpty();
		if (failure !== undefined) throw failure;
	}
}

function absentWindowState(): CandidateWindowState {
	return Object.freeze({
		certainty: 'complete',
		presence: 'absent',
		focus: 'not_focused',
		visibility: 'not_visible',
		placement: 'unknown'
	});
}

function unknownWindowState(): CandidateWindowState {
	return Object.freeze({
		certainty: 'unknown',
		presence: 'unknown',
		focus: 'unknown',
		visibility: 'unknown',
		placement: 'unknown'
	});
}

function platformFamily(platform: NodeJS.Platform): PlatformFamily {
	if (platform === 'darwin') return 'macos';
	if (platform === 'win32') return 'windows';
	if (platform === 'linux') return 'linux';
	throw new Error(`unsupported Electron platform: ${platform}`);
}

function isValidDisplayTargetId(value: string): boolean {
	let length = 0;
	for (const _codePoint of value) {
		length += 1;
		if (length > 128) return false;
	}
	return length > 0;
}
