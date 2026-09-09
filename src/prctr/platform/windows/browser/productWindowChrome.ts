/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port electron-window-skeleton

import { Disposable } from '../../../base/common/lifecycle.js';
import type { BrowserThemeService } from '../../theme/browser/themeService.js';
import {
	MACOS_TRAFFIC_LIGHT_INSET,
	PRODUCT_WINDOW_TITLE,
	type ProductWindowChromeClient,
	type ProductWindowChromeConfiguration,
	type ProductWindowChromeMode,
	type ProductWindowChromeTheme,
	type ProductWindowChromeUpdate,
	validateProductWindowChromeConfiguration,
	validateProductWindowChromeZoomFactor
} from '../common/windowChrome.js';
import './productWindowChrome.css';

export const PRODUCT_WINDOW_CHROME_SERVICE = 'prctr.window.chrome';

export type ProductWindowChromeThemeService = Pick<
	BrowserThemeService,
	'theme' | 'forcedColorsActive' | 'onDidChangeTheme' | 'onDidChangePresentation'
>;

export class ProductWindowChrome extends Disposable {
	readonly element: HTMLElement;
	readonly actions: HTMLElement;
	readonly configuration: ProductWindowChromeConfiguration;
	readonly #client: ProductWindowChromeClient;
	readonly #themeService: ProductWindowChromeThemeService;
	readonly #ownedElements: HTMLElement[] = [];
	#dimmed = false;
	#lastRequested: string | undefined;
	#tail: Promise<void> = Promise.resolve();

	static async create(
		host: HTMLElement,
		client: ProductWindowChromeClient,
		themeService: ProductWindowChromeThemeService
	): Promise<ProductWindowChrome> {
		let chrome: ProductWindowChrome | undefined;
		let pendingFullscreen: boolean | undefined;
		const fullscreenSubscription = client.onDidChangeFullscreen((fullscreen) => {
			if (chrome === undefined) pendingFullscreen = fullscreen;
			else chrome.#setFullscreen(fullscreen);
		});
		try {
			const configuration = validateProductWindowChromeConfiguration(
				await client.configuration()
			);
			synchronizeProductWindowTitle(host.ownerDocument, configuration.mode);
			chrome = new ProductWindowChrome(
				host,
				client,
				themeService,
				pendingFullscreen === undefined
					? configuration
					: Object.freeze({ ...configuration, fullscreen: pendingFullscreen })
			);
			chrome._register(fullscreenSubscription);
			chrome.#initialize();
			await chrome.synchronize();
			return chrome;
		} catch (error) {
			if (chrome === undefined) fullscreenSubscription.dispose();
			else chrome.dispose();
			throw error;
		}
	}

	private constructor(
		host: HTMLElement,
		client: ProductWindowChromeClient,
		themeService: ProductWindowChromeThemeService,
		configuration: ProductWindowChromeConfiguration
	) {
		super();
		this.element = host;
		this.actions = host.ownerDocument.createElement('div');
		this.actions.className = 'prctr-product-window-chrome__actions';
		this.#ownedElements.push(this.actions);
		this.#client = client;
		this.#themeService = themeService;
		this.configuration = configuration;
	}

	#initialize(): void {
		const host = this.element;
		const configuration = this.configuration;
		host.classList.add('prctr-product-window-chrome');
		host.dataset.chromeMode = configuration.mode;
		host.dataset.chromePlatform = configuration.platform;
		host.dataset.controlsLocation = configuration.controlsLocation;
		const contentDirection =
			host.closest<HTMLElement>('[dir]')?.dir ?? host.ownerDocument.documentElement.dir;
		host.dataset.contentDirection = contentDirection === 'rtl' ? 'rtl' : 'ltr';
		host.dataset.fullscreen = String(configuration.fullscreen);
		host.style.setProperty(
			'--prctr-product-titlebar-height',
			`${configuration.titlebarHeight}px`
		);

		const document = host.ownerDocument;
		const dragRegion = document.createElement('div');
		dragRegion.className = 'prctr-product-window-chrome__drag-region';
		dragRegion.setAttribute('aria-hidden', 'true');
		const controlsInset = document.createElement('div');
		controlsInset.className = 'prctr-product-window-chrome__controls-inset';
		controlsInset.setAttribute('aria-hidden', 'true');
		controlsInset.dataset.location = configuration.controlsLocation;
		if (configuration.mode === 'nativeTrafficLights') {
			controlsInset.style.setProperty(
				'--prctr-product-window-controls-inset',
				`${MACOS_TRAFFIC_LIGHT_INSET}px`
			);
		}
		this.#ownedElements.push(dragRegion, controlsInset);
		host.prepend(dragRegion);
		host.append(this.actions);
		if (configuration.controlsLocation === 'left') host.prepend(controlsInset);
		else host.append(controlsInset);
		this._register(
			this.#themeService.onDidChangeTheme(() => {
				void this.synchronize().catch(() => undefined);
			})
		);
		this._register(
			this.#themeService.onDidChangePresentation(() => {
				void this.synchronize().catch(() => undefined);
			})
		);
		const ResizeObserverConstructor = host.ownerDocument.defaultView?.ResizeObserver;
		if (ResizeObserverConstructor !== undefined) {
			const observer = new ResizeObserverConstructor(() => {
				void this.synchronize().catch(() => undefined);
			});
			this._register({ dispose: () => observer.disconnect() });
			observer.observe(host);
		}
		const targetWindow = host.ownerDocument.defaultView;
		if (targetWindow !== null) {
			const synchronizeZoom = (): void => {
				void this.synchronize().catch(() => undefined);
			};
			this._register({
				dispose: () => targetWindow.removeEventListener('resize', synchronizeZoom)
			});
			targetWindow.addEventListener('resize', synchronizeZoom);
		}
	}

	#setFullscreen(fullscreen: boolean): void {
		if (this._store.isDisposed) return;
		this.element.dataset.fullscreen = String(fullscreen);
	}

	setDimmed(dimmed: boolean): Promise<void> {
		if (this._store.isDisposed) return Promise.resolve();
		if (this.#dimmed !== dimmed) this.#dimmed = dimmed;
		return this.synchronize();
	}

	synchronize(): Promise<void> {
		if (this._store.isDisposed) return Promise.resolve();
		const browserZoomFactor = validateProductWindowChromeZoomFactor(
			this.#client.zoomFactor()
		);
		const documentZoom = Number.parseFloat(
			this.element.ownerDocument.defaultView?.getComputedStyle(
				this.element.ownerDocument.documentElement
			).zoom ?? ''
		);
		const zoomFactor =
			browserZoomFactor *
			(Number.isFinite(documentZoom) && documentZoom > 0 ? documentZoom : 1);
		this.element.style.setProperty('--prctr-product-window-zoom-factor', String(zoomFactor));
		const measuredHeight = Math.round(this.element.getBoundingClientRect().height);
		const update: ProductWindowChromeUpdate = Object.freeze({
			protocolVersion: 1,
			theme: resolveProductWindowChromeTheme(this.#themeService),
			titlebarHeight:
				measuredHeight >= 24 && measuredHeight <= 256
					? measuredHeight
					: this.configuration.titlebarHeight,
			dimmed: this.#dimmed
		});
		const key = `${update.theme}:${update.titlebarHeight}:${update.dimmed}:${zoomFactor}`;
		if (key === this.#lastRequested) return this.#tail;
		this.#lastRequested = key;
		const task = this.#tail.then(() => {
			if (this._store.isDisposed) return;
			return this.#client.update(update);
		});
		this.#tail = task.catch(() => {
			if (this.#lastRequested === key) this.#lastRequested = undefined;
		});
		return task;
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		for (const element of this.#ownedElements) element.remove();
		this.element.classList.remove('prctr-product-window-chrome');
		delete this.element.dataset.chromeMode;
		delete this.element.dataset.chromePlatform;
		delete this.element.dataset.controlsLocation;
		delete this.element.dataset.contentDirection;
		delete this.element.dataset.fullscreen;
		this.element.style.removeProperty('--prctr-product-titlebar-height');
		this.element.style.removeProperty('--prctr-product-window-zoom-factor');
		super.dispose();
	}
}

export function resolveProductWindowChromeTheme(
	themeService: Pick<ProductWindowChromeThemeService, 'theme' | 'forcedColorsActive'>
): ProductWindowChromeTheme {
	if (!themeService.forcedColorsActive || themeService.theme.isHighContrast)
		return themeService.theme.id;
	return themeService.theme.isDark ? 'highContrastDark' : 'highContrastLight';
}

export function synchronizeProductWindowTitle(
	document: Pick<Document, 'title'>,
	mode: ProductWindowChromeMode
): void {
	if (
		mode === 'nativeTrafficLights' &&
		(document.title.length === 0 || document.title === PRODUCT_WINDOW_TITLE)
	)
		document.title = `${PRODUCT_WINDOW_TITLE} \u200b`;
	document.title = PRODUCT_WINDOW_TITLE;
}
