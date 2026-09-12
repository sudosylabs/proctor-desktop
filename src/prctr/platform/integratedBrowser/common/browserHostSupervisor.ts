/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../base/common/errors.js';
import type { BrowserEnforcementDelegate, PrivilegedBrowserEngine } from './browserEnforcement.js';
import type { IntegratedBrowserSurface } from './browserProtocol.js';

export interface SupervisedBrowserHost extends PrivilegedBrowserEngine {
	setSurface(surface: IntegratedBrowserSurface): void;
	surfaceFocused(): boolean;
	onDidChangeSurfaceFocus(listener: (focused: boolean) => void): { dispose(): void };
}
export interface BrowserHostFactory {
	/** Create a fresh ephemeral partition and native contents for each host instance. */
	create(delegate: BrowserEnforcementDelegate): Promise<SupervisedBrowserHost>;
}

/** Gates destroy the remote document, including live sockets, workers and page timers.
 * Releasing a gate reconstructs only the last approved URL, under the same source authority.
 * A host epoch fences every callback: an old renderer can never regain activity permission.
 */
export class BrowserHostSupervisor implements SupervisedBrowserHost {
	private host: SupervisedBrowserHost | undefined;
	private focusRegistration: { dispose(): void } | undefined;
	private readonly focusListeners = new Set<(focused: boolean) => void>();
	private serial: Promise<unknown> = Promise.resolve();
	private teardown: Promise<void> | undefined;
	private blocked = true;
	private closed = false;
	private epoch = 0;
	private location: string | undefined;
	private surface: IntegratedBrowserSurface | undefined;
	private failure: unknown;
	private readonly factory: BrowserHostFactory;
	private readonly delegate: BrowserEnforcementDelegate;
	private readonly unavailable: () => void;
	constructor(
		factory: BrowserHostFactory,
		delegate: BrowserEnforcementDelegate,
		unavailable: () => void
	) {
		this.factory = factory;
		this.delegate = delegate;
		this.unavailable = unavailable;
	}
	async open(url: string): Promise<void> {
		this.location = url;
		await this.enqueue(() => this.ensureHost());
	}
	async navigate(url: string): Promise<void> {
		await this.enqueue(async () => {
			this.assertInteractive();
			await this.ensureHost();
			this.assertInteractive();
			await this.host!.navigate(url);
		});
	}
	async back(): Promise<void> {
		await this.command((host) => host.back());
	}
	async forward(): Promise<void> {
		await this.command((host) => host.forward());
	}
	async reload(): Promise<void> {
		await this.command((host) => host.reload());
	}
	private async command(action: (host: SupervisedBrowserHost) => Promise<void>): Promise<void> {
		await this.enqueue(async () => {
			this.assertInteractive();
			await this.ensureHost();
			this.assertInteractive();
			await action(this.host!);
		});
	}
	setInputBlocked(blocked: boolean): void {
		if (this.closed || this.blocked === blocked) return;
		this.blocked = blocked;
		if (blocked) {
			this.epoch++;
			this.host?.setInputBlocked(true);
			this.emitFocus(false);
			// Destruction cannot wait behind loadURL: a stalled response must not keep sockets alive.
			void this.destroyHost().catch(() => this.unavailable());
		} else {
			void this.enqueue(() => this.ensureHost()).catch(() => this.unavailable());
		}
	}
	private async ensureHost(): Promise<void> {
		if (this.teardown) await this.teardown;
		if (this.closed || this.blocked || !this.location) return;
		if (this.failure) throw new Error('Browser host teardown requires recovery');
		if (this.host) return;
		const epoch = ++this.epoch;
		const current = () => epoch === this.epoch && !this.blocked && !this.closed;
		const denied = () => ({
			allowed: false as const,
			location: { scheme: 'blocked', host: '', port: '', path: '/' },
			reason: 'unlistedOrigin' as const,
			consequence: 'activity' as const
		});
		const host = await this.factory.create({
			checkTopLevel: (...args) =>
				current() ? this.delegate.checkTopLevel(...args) : denied(),
			checkSubresource: (url) => current() && this.delegate.checkSubresource(url),
			blockPopup: (url) => {
				if (current()) this.delegate.blockPopup(url);
			},
			commitTopLevel: (url, kind) => {
				if (current()) {
					this.location = url;
					this.delegate.commitTopLevel(url, kind);
				}
			}
		});
		if (!current()) {
			host.setInputBlocked(true);
			await host.close();
			return;
		}
		this.host = host;
		this.focusRegistration = host.onDidChangeSurfaceFocus((focused) => {
			if (current()) this.emitFocus(focused);
		});
		host.setInputBlocked(false);
		if (this.surface) host.setSurface(this.surface);
		try {
			await host.open(this.location);
		} catch (error) {
			await this.destroyHost();
			throw error;
		}
	}
	private destroyHost(): Promise<void> {
		if (this.teardown) return this.teardown;
		const operation = this.performDestroyHost();
		this.teardown = operation;
		void operation
			.finally(() => {
				if (this.teardown === operation) this.teardown = undefined;
			})
			.catch(() => {});
		return operation;
	}
	private async performDestroyHost(): Promise<void> {
		const host = this.host;
		if (!host) return;
		host.setInputBlocked(true);
		this.focusRegistration?.dispose();
		this.focusRegistration = undefined;
		try {
			await host.close();
		} catch (error) {
			this.failure = error;
			this.unavailable();
			throw error;
		}
		if (this.host === host) this.host = undefined;
		this.failure = undefined;
	}
	setSurface(surface: IntegratedBrowserSurface): void {
		this.surface = Object.freeze({ ...surface, bounds: Object.freeze({ ...surface.bounds }) });
		this.host?.setSurface({
			...surface,
			visible: surface.visible && !this.blocked && !this.closed,
			focus: surface.focus && !this.blocked && !this.closed
		});
	}
	surfaceFocused(): boolean {
		return !this.closed && !this.blocked && (this.host?.surfaceFocused() ?? false);
	}
	onDidChangeSurfaceFocus(listener: (focused: boolean) => void): { dispose(): void } {
		this.focusListeners.add(listener);
		return { dispose: () => this.focusListeners.delete(listener) };
	}
	private emitFocus(focused: boolean): void {
		for (const listener of this.focusListeners) {
			try {
				listener(focused);
			} catch (error) {
				onUnexpectedError(error);
			}
		}
	}
	historyState(): { readonly canGoBack: boolean; readonly canGoForward: boolean } {
		return !this.blocked && !this.closed && this.host
			? this.host.historyState()
			: { canGoBack: false, canGoForward: false };
	}
	async close(): Promise<void> {
		this.closed = true;
		this.blocked = true;
		this.epoch++;
		this.location = undefined;
		this.host?.setInputBlocked(true);
		await this.destroyHost();
		// A factory already in flight remains fenced and must dispose its late result.
		await this.enqueue(() => this.destroyHost());
		this.focusListeners.clear();
	}
	private assertInteractive(): void {
		if (this.blocked || this.closed || this.failure)
			throw new Error('Browser host is unavailable');
	}
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const pending = this.serial.then(operation);
		this.serial = pending.catch(() => {});
		return pending;
	}
}
