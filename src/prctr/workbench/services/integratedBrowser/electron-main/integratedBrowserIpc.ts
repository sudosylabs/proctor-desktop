/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	BrowserWindow,
	type IpcMain,
	type IpcMainInvokeEvent,
	type WebContents
} from 'electron/main';
import {
	validateIntegratedBrowserIntent,
	validateIntegratedBrowserSurface,
	type IntegratedBrowserSurface
} from '../../../../platform/integratedBrowser/common/browserProtocol.js';
import { CANDIDATE_BROWSER_CHANNELS } from '../../../../platform/windows/common/windowChannels.js';
import type { IntegratedBrowserCoordinator } from '../common/integratedBrowserCoordinator.js';

export interface IntegratedBrowserSurfaceFocusSource {
	current(): boolean;
	onDidChange(listener: (focused: boolean) => void): { dispose(): void };
}
export type IntegratedBrowserIpcModel = Pick<
	IntegratedBrowserCoordinator,
	'observe' | 'handleIntent' | 'onDidChange'
>;

export class IntegratedBrowserIpcBridge {
	readonly #ipcMain: IpcMain;
	readonly #candidateContents: WebContents;
	readonly #changeSubscription: { dispose(): void };
	readonly #focusSubscription: { dispose(): void };
	readonly #surface: (surface: IntegratedBrowserSurface) => void;
	constructor(
		ipcMain: IpcMain,
		candidateContents: WebContents,
		coordinator: IntegratedBrowserIpcModel,
		surface: (surface: IntegratedBrowserSurface) => void,
		focus: IntegratedBrowserSurfaceFocusSource
	) {
		this.#ipcMain = ipcMain;
		this.#candidateContents = candidateContents;
		this.#surface = surface;
		const handled: string[] = [];
		let changeSubscription: { dispose(): void } | undefined;
		let focusSubscription: { dispose(): void } | undefined;
		try {
			ipcMain.handle(CANDIDATE_BROWSER_CHANNELS.projection, (event) => {
				this.#assertSender(event);
				return coordinator.observe();
			});
			handled.push(CANDIDATE_BROWSER_CHANNELS.projection);
			ipcMain.handle(CANDIDATE_BROWSER_CHANNELS.intent, async (event, value: unknown) => {
				this.#assertSender(event);
				await coordinator.handleIntent(validateIntegratedBrowserIntent(value));
			});
			handled.push(CANDIDATE_BROWSER_CHANNELS.intent);
			ipcMain.handle(CANDIDATE_BROWSER_CHANNELS.surface, (event, value: unknown) => {
				this.#assertSender(event);
				this.#surface(this.#toNativeSurface(validateIntegratedBrowserSurface(value)));
			});
			handled.push(CANDIDATE_BROWSER_CHANNELS.surface);
			ipcMain.handle(CANDIDATE_BROWSER_CHANNELS.surfaceFocus, (event) => {
				this.#assertSender(event);
				return focus.current();
			});
			handled.push(CANDIDATE_BROWSER_CHANNELS.surfaceFocus);
			changeSubscription = coordinator.onDidChange((projection) => {
				if (!candidateContents.isDestroyed())
					candidateContents.send(CANDIDATE_BROWSER_CHANNELS.changed, projection);
			});
			focusSubscription = focus.onDidChange((focused) => {
				if (!candidateContents.isDestroyed())
					candidateContents.send(CANDIDATE_BROWSER_CHANNELS.surfaceFocusChanged, focused);
			});
		} catch (error) {
			focusSubscription?.dispose();
			changeSubscription?.dispose();
			for (const channel of handled) ipcMain.removeHandler(channel);
			throw error;
		}
		this.#changeSubscription = changeSubscription;
		this.#focusSubscription = focusSubscription;
	}
	#toNativeSurface(surface: IntegratedBrowserSurface): IntegratedBrowserSurface {
		const owner = BrowserWindow.fromWebContents(this.#candidateContents);
		if (owner === null || owner.isDestroyed())
			throw new Error('CandidateWindow no longer owns an integrated browser surface');
		const zoom = this.#candidateContents.getZoomFactor();
		if (!Number.isFinite(zoom) || zoom <= 0)
			throw new Error('CandidateWindow zoom factor is invalid');
		const content = owner.getContentBounds();
		const left = Math.max(0, Math.min(content.width, Math.floor(surface.bounds.x * zoom)));
		const top = Math.max(0, Math.min(content.height, Math.floor(surface.bounds.y * zoom)));
		const right = Math.max(
			left,
			Math.min(content.width, Math.ceil((surface.bounds.x + surface.bounds.width) * zoom))
		);
		const bottom = Math.max(
			top,
			Math.min(content.height, Math.ceil((surface.bounds.y + surface.bounds.height) * zoom))
		);
		const visible = surface.visible && right > left && bottom > top;
		return Object.freeze({
			visible,
			focus: visible && surface.focus,
			bounds: Object.freeze({ x: left, y: top, width: right - left, height: bottom - top })
		});
	}
	#assertSender(event: IpcMainInvokeEvent): void {
		if (
			event.sender.id !== this.#candidateContents.id ||
			event.senderFrame !== this.#candidateContents.mainFrame
		)
			throw new Error('Integrated browser IPC sender is not the bound CandidateWindow');
	}
	dispose(): void {
		this.#focusSubscription.dispose();
		this.#changeSubscription.dispose();
		this.#ipcMain.removeHandler(CANDIDATE_BROWSER_CHANNELS.projection);
		this.#ipcMain.removeHandler(CANDIDATE_BROWSER_CHANNELS.intent);
		this.#ipcMain.removeHandler(CANDIDATE_BROWSER_CHANNELS.surface);
		this.#ipcMain.removeHandler(CANDIDATE_BROWSER_CHANNELS.surfaceFocus);
	}
}
