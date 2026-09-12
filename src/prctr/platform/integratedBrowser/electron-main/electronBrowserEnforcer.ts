/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import type { BrowserHostFactory } from '../common/browserHostSupervisor.js';
import {
	WebContentsView,
	session,
	type CallbackResponse,
	type Event as ElectronEvent,
	type OnBeforeRequestListenerDetails,
	type OnBeforeRedirectListenerDetails,
	type OnCompletedListenerDetails,
	type OnErrorOccurredListenerDetails,
	type Session,
	type WebContents,
	type WebContentsWillNavigateEventParams,
	type WebContentsWillRedirectEventParams
} from 'electron/main';
import { onUnexpectedError } from '../../../base/common/errors.js';
import type {
	BrowserEnforcementDelegate,
	PrivilegedBrowserEngine
} from '../common/browserEnforcement.js';
import type { IntegratedBrowserSurface } from '../common/browserProtocol.js';

const ownedSessions = new WeakSet<Session>();

export interface ElectronBrowserViewHost {
	updateSurface(view: WebContentsView, surface: IntegratedBrowserSurface): void;
	detachAndDestroy(view: WebContentsView): void | Promise<void>;
}
export interface ElectronBrowserView {
	readonly view: WebContentsView;
	readonly engine: ElectronBrowserEnforcer;
}

/** Concrete factory selected by the privileged composition root. Each reconstruction has an
 * unpersisted partition, so paused documents cannot retain a service worker or connection. */
export function createElectronBrowserHostFactory(
	host: ElectronBrowserViewHost
): BrowserHostFactory {
	return {
		async create(delegate) {
			return (
				await createElectronBrowserView(`prctr-browser-${randomUUID()}`, host, delegate)
			).engine;
		}
	};
}

export async function createElectronBrowserView(
	partition: string,
	host: ElectronBrowserViewHost,
	delegate: BrowserEnforcementDelegate
): Promise<ElectronBrowserView> {
	if (!/^prctr-browser-[A-Za-z0-9_-]{16,128}$/u.test(partition))
		throw new TypeError('Integrated browser partition identity is invalid');
	const browserSession = session.fromPartition(partition, { cache: false });
	if (ownedSessions.has(browserSession))
		throw new Error('Integrated browser partition already has an owner');
	const view = new WebContentsView({
		webPreferences: {
			partition,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			webviewTag: false,
			devTools: false,
			safeDialogs: true,
			navigateOnDragDrop: false,
			spellcheck: false,
			autoplayPolicy: 'document-user-activation-required'
		}
	});
	ownedSessions.add(browserSession);
	try {
		return Object.freeze({
			view,
			engine: new ElectronBrowserEnforcer(view, browserSession, host, delegate)
		});
	} catch (error) {
		try {
			await host.detachAndDestroy(view);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Integrated browser view creation and rollback failed'
			);
		}
		ownedSessions.delete(browserSession);
		throw error;
	}
}

export class ElectronBrowserEnforcer implements PrivilegedBrowserEngine {
	readonly #view: WebContentsView;
	readonly #contents: WebContents;
	readonly #session: Session;
	readonly #host: ElectronBrowserViewHost;
	readonly #delegate: BrowserEnforcementDelegate;
	readonly #requestRuleIds = new Map<number, string>();
	readonly #focusListeners = new Set<(focused: boolean) => void>();
	#focused = false;
	#blocked = true;
	#closed = false;
	#closePromise: Promise<void> | undefined;
	#redirectFromRuleId: string | undefined;
	#redirectPending = false;
	#surface: IntegratedBrowserSurface = Object.freeze({
		visible: false,
		focus: false,
		bounds: Object.freeze({ x: 0, y: 0, width: 0, height: 0 })
	});
	readonly #willNavigate = (event: ElectronEvent<WebContentsWillNavigateEventParams>): void => {
		if (!event.isMainFrame) return;
		const decision = this.#delegate.checkTopLevel(event.url, 'navigation');
		if (!decision.allowed) event.preventDefault();
		else this.#redirectFromRuleId = decision.rule.id;
	};
	readonly #willRedirect = (event: ElectronEvent<WebContentsWillRedirectEventParams>): void => {
		if (!event.isMainFrame) return;
		const decision = this.#delegate.checkTopLevel(
			event.url,
			'redirect',
			this.#redirectFromRuleId
		);
		if (!decision.allowed) event.preventDefault();
		else this.#redirectFromRuleId = decision.rule.id;
	};
	readonly #didNavigate = (_event: ElectronEvent, url: string): void => {
		this.#delegate.commitTopLevel(url, this.#redirectPending ? 'redirect' : 'navigation');
		this.#redirectPending = false;
	};
	readonly #didNavigateInPage = (
		_event: ElectronEvent,
		url: string,
		isMainFrame: boolean
	): void => {
		if (!isMainFrame || this.#blocked || this.#closed) return;
		const decision = this.#delegate.checkTopLevel(url, 'navigation');
		if (!decision.allowed) {
			this.setInputBlocked(true);
			return;
		}
		this.#delegate.commitTopLevel(url, 'navigation');
	};
	readonly #beforeInput = (
		event: ElectronEvent,
		input: { control: boolean; meta: boolean; key: string }
	): void => {
		if (
			this.#blocked ||
			((input.control || input.meta) && ['p', 's', 'o'].includes(input.key.toLowerCase()))
		)
			event.preventDefault();
	};
	readonly #willAttachWebview = (event: ElectronEvent): void => {
		event.preventDefault();
	};
	readonly #devToolsOpened = (): void => {
		if (!this.#contents.isDestroyed()) this.#contents.closeDevTools();
	};
	readonly #contextMenu = (event: ElectronEvent): void => {
		event.preventDefault();
	};
	readonly #willPreventUnload = (event: ElectronEvent): void => {
		event.preventDefault();
	};
	readonly #didFocus = (): void => {
		this.#setFocused(true);
	};
	readonly #didBlur = (): void => {
		this.#setFocused(false);
	};
	readonly #willDownload = (event: ElectronEvent): void => {
		event.preventDefault();
	};
	readonly #beforeRequest = (
		details: OnBeforeRequestListenerDetails,
		callback: (response: CallbackResponse) => void
	): void => {
		if (this.#blocked || this.#closed || details.webContentsId !== this.#contents.id) {
			callback({ cancel: true });
			return;
		}
		if (details.resourceType !== 'mainFrame') {
			callback({ cancel: !this.#delegate.checkSubresource(details.url) });
			return;
		}
		const redirectFromRuleId = this.#requestRuleIds.get(details.id);
		const decision = this.#delegate.checkTopLevel(
			details.url,
			redirectFromRuleId === undefined ? 'navigation' : 'redirect',
			redirectFromRuleId
		);
		if (decision.allowed) {
			this.#requestRuleIds.set(details.id, decision.rule.id);
			this.#redirectFromRuleId = decision.rule.id;
		} else this.#requestRuleIds.delete(details.id);
		callback({ cancel: !decision.allowed });
	};
	readonly #beforeRedirect = (details: OnBeforeRedirectListenerDetails): void => {
		if (
			this.#blocked ||
			this.#closed ||
			details.webContentsId !== this.#contents.id ||
			details.resourceType !== 'mainFrame'
		)
			return;
		// The HTTP response establishes this successful hop before the destination is contacted.
		this.#delegate.commitTopLevel(
			details.url,
			this.#redirectPending ? 'redirect' : 'navigation'
		);
		this.#redirectPending = true;
	};
	readonly #requestCompleted = (
		details: OnCompletedListenerDetails | OnErrorOccurredListenerDetails
	): void => {
		this.#requestRuleIds.delete(details.id);
	};
	constructor(
		view: WebContentsView,
		browserSession: Session,
		host: ElectronBrowserViewHost,
		delegate: BrowserEnforcementDelegate
	) {
		this.#view = view;
		this.#contents = view.webContents;
		this.#session = browserSession;
		this.#host = host;
		this.#delegate = delegate;
		try {
			this.#contents.setWindowOpenHandler((details) => {
				this.#delegate.blockPopup(details.url);
				return { action: 'deny' };
			});
			this.#contents.on('will-navigate', this.#willNavigate);
			this.#contents.on('will-redirect', this.#willRedirect);
			this.#contents.on('did-navigate', this.#didNavigate);
			this.#contents.on('did-navigate-in-page', this.#didNavigateInPage);
			this.#contents.on('before-input-event', this.#beforeInput);
			this.#contents.on('will-attach-webview', this.#willAttachWebview);
			this.#contents.on('devtools-opened', this.#devToolsOpened);
			this.#contents.on('context-menu', this.#contextMenu);
			this.#contents.on('will-prevent-unload', this.#willPreventUnload);
			this.#contents.on('focus', this.#didFocus);
			this.#contents.on('blur', this.#didBlur);
			this.#session.setDevicePermissionHandler(() => false);
			this.#session.setPermissionCheckHandler(() => false);
			this.#session.setPermissionRequestHandler((_contents, _permission, callback) =>
				callback(false)
			);
			this.#session.on('will-download', this.#willDownload);
			this.#session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, this.#beforeRequest);
			this.#session.webRequest.onBeforeRedirect(
				{ urls: ['<all_urls>'] },
				this.#beforeRedirect
			);
			this.#session.webRequest.onCompleted({ urls: ['<all_urls>'] }, this.#requestCompleted);
			this.#session.webRequest.onErrorOccurred(
				{ urls: ['<all_urls>'] },
				this.#requestCompleted
			);
			this.#contents.setIgnoreMenuShortcuts(true);
			this.#contents.setZoomMode('isolated');
			this.#contents.setVisualZoomLevelLimits(1, 3).catch(() => {});
			this.#contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
			this.setInputBlocked(true);
		} catch (error) {
			try {
				this.#unregister();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Integrated browser enforcement registration and rollback failed'
				);
			}
			throw error;
		}
	}
	async open(url: string): Promise<void> {
		this.#assertLive();
		const decision = this.#delegate.checkTopLevel(url, 'navigation');
		if (!decision.allowed) throw new Error('Integrated browser start location is blocked');
		this.#redirectFromRuleId = decision.rule.id;
		this.#redirectPending = false;
		await this.#contents.loadURL(decision.navigationUrl).catch(() => {
			throw new Error('Integrated browser navigation failed');
		});
	}
	async navigate(url: string): Promise<void> {
		this.#assertLive();
		if (this.#blocked) throw new Error('Integrated browser input is blocked');
		const decision = this.#delegate.checkTopLevel(url, 'navigation');
		if (!decision.allowed) return;
		this.#redirectFromRuleId = decision.rule.id;
		this.#redirectPending = false;
		await this.#contents.loadURL(decision.navigationUrl).catch(() => {
			throw new Error('Integrated browser navigation failed');
		});
	}
	async back(): Promise<void> {
		this.#assertInteractive();
		if (this.#contents.navigationHistory.canGoBack()) this.#contents.navigationHistory.goBack();
	}
	async forward(): Promise<void> {
		this.#assertInteractive();
		if (this.#contents.navigationHistory.canGoForward())
			this.#contents.navigationHistory.goForward();
	}
	async reload(): Promise<void> {
		this.#assertInteractive();
		this.#contents.reload();
	}
	async close(): Promise<void> {
		if (this.#closed) return;
		if (this.#closePromise !== undefined) return this.#closePromise;
		this.#closePromise = this.#performClose();
		try {
			await this.#closePromise;
		} finally {
			if (!this.#closed) this.#closePromise = undefined;
		}
	}
	async #performClose(): Promise<void> {
		this.setInputBlocked(true);
		if (!this.#contents.isDestroyed()) this.#contents.stop();
		let acknowledge = () => {};
		const destroyed = new Promise<void>((resolve) => {
			acknowledge = resolve;
		});
		if (this.#contents.isDestroyed()) acknowledge();
		else this.#contents.once('destroyed', acknowledge);
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				(async () => {
					try {
						await this.#host.detachAndDestroy(this.#view);
					} catch (error) {
						if (!this.#contents.isDestroyed()) throw error;
					}
					// WebContents.close() initiates asynchronous native destruction.
					await destroyed;
				})(),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(
						() => reject(new Error('Integrated browser native destruction timed out')),
						5000
					);
				})
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
			this.#contents.off('destroyed', acknowledge);
		}
		await this.#session.closeAllConnections();
		await this.#session.clearStorageData();
		await this.#session.clearCache();
		this.#unregister();
		ownedSessions.delete(this.#session);
		this.#closed = true;
	}
	setSurface(surface: IntegratedBrowserSurface): void {
		if (this.#closed || this.#contents.isDestroyed()) return;
		this.#surface = Object.freeze({
			visible: surface.visible,
			focus: false,
			bounds: surface.bounds
		});
		this.#applySurface(surface.focus);
	}
	surfaceFocused(): boolean {
		return this.#focused;
	}
	onDidChangeSurfaceFocus(listener: (focused: boolean) => void): { dispose(): void } {
		this.#focusListeners.add(listener);
		return Object.freeze({ dispose: () => this.#focusListeners.delete(listener) });
	}
	setInputBlocked(blocked: boolean): void {
		if (blocked && !this.#blocked && !this.#closed && !this.#contents.isDestroyed())
			this.#contents.stop();
		this.#blocked = blocked;
		this.#applySurface();
	}
	#applySurface(requestFocus = false): void {
		const visible =
			!this.#blocked &&
			!this.#closed &&
			!this.#contents.isDestroyed() &&
			this.#surface.visible;
		this.#host.updateSurface(
			this.#view,
			Object.freeze({ visible, focus: visible && requestFocus, bounds: this.#surface.bounds })
		);
	}
	#setFocused(focused: boolean): void {
		if (this.#focused === focused) return;
		this.#focused = focused;
		for (const listener of [...this.#focusListeners]) {
			try {
				listener(focused);
			} catch (error) {
				onUnexpectedError(error);
			}
		}
	}
	historyState(): { readonly canGoBack: boolean; readonly canGoForward: boolean } {
		return this.#closed || this.#contents.isDestroyed()
			? { canGoBack: false, canGoForward: false }
			: {
					canGoBack: this.#contents.navigationHistory.canGoBack(),
					canGoForward: this.#contents.navigationHistory.canGoForward()
				};
	}
	#assertInteractive(): void {
		this.#assertLive();
		if (this.#blocked) throw new Error('Integrated browser input is blocked');
	}
	#assertLive(): void {
		if (this.#closed || this.#contents.isDestroyed())
			throw new Error('Integrated browser is closed');
	}
	#unregister(): void {
		this.#contents.off('will-navigate', this.#willNavigate);
		this.#contents.off('will-redirect', this.#willRedirect);
		this.#contents.off('did-navigate', this.#didNavigate);
		this.#contents.off('did-navigate-in-page', this.#didNavigateInPage);
		this.#contents.off('before-input-event', this.#beforeInput);
		this.#contents.off('will-attach-webview', this.#willAttachWebview);
		this.#contents.off('devtools-opened', this.#devToolsOpened);
		this.#contents.off('context-menu', this.#contextMenu);
		this.#contents.off('will-prevent-unload', this.#willPreventUnload);
		this.#contents.off('focus', this.#didFocus);
		this.#contents.off('blur', this.#didBlur);
		this.#setFocused(false);
		this.#focusListeners.clear();
		this.#session.off('will-download', this.#willDownload);
		this.#session.webRequest.onBeforeRequest(null);
		this.#session.webRequest.onBeforeRedirect(null);
		this.#session.webRequest.onCompleted(null);
		this.#session.webRequest.onErrorOccurred(null);
		this.#requestRuleIds.clear();
		this.#session.setDevicePermissionHandler(null);
		this.#session.setPermissionCheckHandler(null);
		this.#session.setPermissionRequestHandler(null);
	}
	dispose(): void {
		void this.close().catch(onUnexpectedError);
	}
}
