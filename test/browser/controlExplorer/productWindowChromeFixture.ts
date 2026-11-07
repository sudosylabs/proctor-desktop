import { Emitter } from '../../../src/prctr/base/common/event.ts';
import { Disposable, DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import {
	ProductWindowChrome,
	synchronizeProductWindowTitle,
	type ProductWindowChromeThemeService
} from '../../../src/prctr/platform/windows/browser/productWindowChrome.ts';
import {
	PRODUCT_WINDOW_TITLE,
	type ProductWindowChromeClient,
	type ProductWindowChromeConfiguration,
	type ProductWindowChromeUpdate
} from '../../../src/prctr/platform/windows/common/windowChrome.ts';
import { getTheme, type ThemeId } from '../../../src/prctr/platform/theme/common/themes.ts';
import type { ControlFixtureResult } from './manifest.ts';

const variants: readonly {
	readonly id: string;
	readonly direction: 'ltr' | 'rtl';
	readonly configuration: ProductWindowChromeConfiguration;
}[] = Object.freeze([
	{
		id: 'windows-overlay-ltr',
		direction: 'ltr',
		configuration: {
			platform: 'win32',
			mode: 'nativeOverlay',
			controlsLocation: 'right',
			titlebarHeight: 35,
			fullscreen: false,
			material: 'none' as const
		}
	},
	{
		id: 'linux-overlay-rtl',
		direction: 'rtl',
		configuration: {
			platform: 'linux',
			mode: 'nativeOverlay',
			controlsLocation: 'right',
			titlebarHeight: 35,
			fullscreen: false,
			material: 'none' as const
		}
	},
	{
		id: 'traffic-ltr',
		direction: 'ltr',
		configuration: {
			platform: 'darwin',
			mode: 'nativeTrafficLights',
			controlsLocation: 'left',
			titlebarHeight: 28,
			fullscreen: false,
			material: 'none' as const
		}
	},
	{
		id: 'traffic-rtl',
		direction: 'rtl',
		configuration: {
			platform: 'darwin',
			mode: 'nativeTrafficLights',
			controlsLocation: 'right',
			titlebarHeight: 32,
			fullscreen: false,
			material: 'none' as const
		}
	}
]);

export function productWindowChromeFixture(host: HTMLElement): ControlFixtureResult {
	const store = new DisposableStore();
	const document = host.ownerDocument;
	const themeService = store.add(new FixtureThemeService());
	const rows: HTMLElement[] = [];
	const updates = new Map<string, ProductWindowChromeUpdate[]>();
	const zoomFactors = new Map(variants.map((variant) => [variant.id, 1]));
	const fullscreenListeners = new Map<string, (fullscreen: boolean) => unknown>();
	const creations: Promise<ProductWindowChrome>[] = [];
	for (const variant of variants) {
		const row = document.createElement('div');
		row.dataset.chromeFixture = variant.id;
		row.dir = variant.direction;
		row.style.inlineSize = '160px';
		host.append(row);
		rows.push(row);
		const variantUpdates: ProductWindowChromeUpdate[] = [];
		updates.set(variant.id, variantUpdates);
		const client: ProductWindowChromeClient = {
			configuration: async () => variant.configuration,
			onDidChangeMaterial: () => ({ dispose() {} }),
			onDidChangeFullscreen: (listener) => {
				fullscreenListeners.set(variant.id, listener);
				return {
					dispose: () => fullscreenListeners.delete(variant.id)
				};
			},
			zoomFactor: () => zoomFactors.get(variant.id)!,
			update: async (update) => {
				variantUpdates.push(
					Object.freeze({
						...update,
						titlebarHeight: Math.round(
							update.titlebarHeight * zoomFactors.get(variant.id)!
						)
					})
				);
			}
		};
		creations.push(
			ProductWindowChrome.create(row, client, themeService).then((chrome) =>
				store.add(chrome)
			)
		);
	}
	return {
		states: variants.length + 8,
		disposable: {
			dispose: () => {
				store.dispose();
				for (const row of rows) row.remove();
			}
		},
		verify: async (): Promise<number> => {
			const chromes = await Promise.all(creations);
			for (const [index, chrome] of chromes.entries()) {
				const variant = variants[index]!;
				if (
					chrome.element.dataset.chromePlatform !== variant.configuration.platform ||
					chrome.element.dataset.chromeMode !== variant.configuration.mode ||
					chrome.element.dataset.controlsLocation !==
						variant.configuration.controlsLocation ||
					chrome.element.dataset.contentDirection !== variant.direction
				)
					throw new Error(`Window chrome fixture lost ${variant.id} geometry`);
				const title = document.createElement('span');
				title.textContent = 'Proctor';
				const action = document.createElement('button');
				action.textContent = 'Navigation';
				chrome.element.append(title, action);
				if (
					getComputedStyle(chrome.element).getPropertyValue('-webkit-app-region') !==
						'drag' ||
					getComputedStyle(title).getPropertyValue('-webkit-app-region') !== 'drag' ||
					getComputedStyle(action).getPropertyValue('-webkit-app-region') !== 'no-drag'
				)
					throw new Error(
						`Window chrome fixture lost ${variant.id} native drag/control regions`
					);
				title.remove();
				action.remove();
				fullscreenListeners.get(variant.id)?.(true);
				const inset = chrome.element.querySelector<HTMLElement>(
					'.prctr-product-window-chrome__controls-inset'
				);
				if (
					chrome.element.dataset.fullscreen !== 'true' ||
					inset === null ||
					getComputedStyle(inset).display !== 'none'
				)
					throw new Error(`Window chrome fixture lost ${variant.id} fullscreen state`);
				fullscreenListeners.get(variant.id)?.(false);
				verifyControlInsetGeometry(chrome, variant);
				// A titlebar account action must remain beside native controls in both
				// text directions; it cannot move the controls away from their OS edge.
				const account = document.createElement('button');
				account.textContent = 'Account';
				account.style.cssText = 'width:72px;height:24px;flex-shrink:0';
				chrome.actions.append(account);
				chrome.element.style.inlineSize = '640px';
				verifyControlInsetGeometry(chrome, variant);
				const actionBounds = account.getBoundingClientRect();
				const controlsBounds = inset.getBoundingClientRect();
				const titlebarBounds = chrome.element.getBoundingClientRect();
				if (
					Math.abs(
						(actionBounds.top + actionBounds.bottom) / 2 -
							(titlebarBounds.top + titlebarBounds.bottom) / 2
					) > 1 ||
					(variant.configuration.controlsLocation === 'right'
						? actionBounds.right > controlsBounds.left
						: actionBounds.left < controlsBounds.right) ||
					actionBounds.left < titlebarBounds.left + titlebarBounds.width / 2 ||
					getComputedStyle(account).getPropertyValue('-webkit-app-region') !== 'no-drag'
				)
					throw new Error(
						`Window chrome ${variant.id} misplaced its interactive titlebar action`
					);
				account.remove();
				chrome.element.style.inlineSize = '160px';
			}

			for (const theme of [
				'light',
				'dark',
				'highContrastLight',
				'highContrastDark'
			] as const) {
				themeService.setTheme(theme);
				await Promise.all(chromes.map((chrome) => chrome.synchronize()));
				for (const variant of variants) {
					if (updates.get(variant.id)?.at(-1)?.theme !== theme)
						throw new Error(`Window chrome did not synchronize ${theme}`);
				}
			}

			themeService.setTheme('light', {
				'titleBar.activeBackground': '#123456',
				'titleBar.activeForeground': '#abcdef'
			});
			await Promise.all(chromes.map((chrome) => chrome.synchronize()));
			for (const variant of variants) {
				const colors = updates.get(variant.id)?.at(-1)?.colors;
				if (colors?.background !== '#123456' || colors.foreground !== '#abcdef')
					throw new Error('Custom title-bar colors did not reach the native adapter');
			}
			themeService.setForcedColors(true);
			await Promise.all(chromes.map((chrome) => chrome.synchronize()));
			for (const variant of variants) {
				if (
					updates.get(variant.id)?.at(-1)?.colors?.background !==
					getTheme('highContrastLight').colors['titleBar.activeBackground']
				)
					throw new Error(
						'Forced colors retained the custom non-contrast native palette'
					);
				if (updates.get(variant.id)?.at(-1)?.theme !== 'highContrastLight')
					throw new Error('Window chrome did not synchronize forced-color light');
			}
			themeService.setTheme('dark');
			await Promise.all(chromes.map((chrome) => chrome.synchronize()));
			for (const variant of variants) {
				if (updates.get(variant.id)?.at(-1)?.theme !== 'highContrastDark')
					throw new Error('Window chrome did not synchronize forced-color dark');
			}
			themeService.setForcedColors(false);
			for (const chrome of chromes) await chrome.setDimmed(true);
			for (const variant of variants) {
				if (updates.get(variant.id)?.at(-1)?.dimmed !== true)
					throw new Error('Window chrome did not synchronize modal dimming');
			}
			for (const chrome of chromes) await chrome.setDimmed(false);

			const windowsIndex = variants.findIndex(
				(variant) => variant.configuration.platform === 'win32'
			);
			const windowsChrome = chromes[windowsIndex]!;
			const windowsVariant = variants[windowsIndex]!;
			const updateCount = updates.get(windowsVariant.id)!.length;
			document.documentElement.style.zoom = '2';
			await windowsChrome.synchronize();
			verifyControlInsetGeometry(windowsChrome, windowsVariant, 2);
			if (
				updates.get(windowsVariant.id)!.length !== updateCount + 1 ||
				updates.get(windowsVariant.id)!.at(-1)?.titlebarHeight !== 70
			)
				throw new Error('Window chrome did not synchronize 200% physical height');
			document.documentElement.style.zoom = '';
			await windowsChrome.synchronize();

			verifyMacOsTitleWorkaround();
			await verifyFailedSetupCleanup(document, themeService);
			await verifyFailedConstructionCleanup(document, themeService);
			await verifyDimmedRetry(document);
			await verifyDisposalFence(document);
			return 12;
		}
	};
}

class FixtureThemeService extends Disposable implements ProductWindowChromeThemeService {
	readonly #themeEmitter = this._register(new Emitter<ReturnType<typeof getTheme>>());
	readonly onDidChangeTheme = this.#themeEmitter.event;
	readonly #presentationEmitter = this._register(new Emitter<void>());
	readonly onDidChangePresentation = this.#presentationEmitter.event;
	#theme = getTheme('light');
	#forcedColors = false;

	get theme(): ReturnType<typeof getTheme> {
		return this.#theme;
	}

	get forcedColorsActive(): boolean {
		return this.#forcedColors;
	}

	get followsSystemColorScheme(): boolean {
		return false;
	}

	setTheme(id: ThemeId, colors: Parameters<typeof getTheme>[1] = {}): void {
		this.#theme = getTheme(id, colors);
		this.#themeEmitter.fire(this.#theme);
		this.#presentationEmitter.fire();
	}

	setForcedColors(active: boolean): void {
		this.#forcedColors = active;
		this.#presentationEmitter.fire();
	}
}

function verifyMacOsTitleWorkaround(): void {
	let title = PRODUCT_WINDOW_TITLE;
	const assignments: string[] = [];
	const document = {
		get title(): string {
			return title;
		},
		set title(value: string) {
			title = value;
			assignments.push(value);
		}
	};
	synchronizeProductWindowTitle(document, 'nativeTrafficLights');
	if (
		assignments.length !== 2 ||
		assignments[0] !== `${PRODUCT_WINDOW_TITLE} \u200b` ||
		assignments[1] !== PRODUCT_WINDOW_TITLE
	)
		throw new Error('macOS window-title workaround was not preserved');
}

async function verifyFailedSetupCleanup(
	document: Document,
	themeService: ProductWindowChromeThemeService
): Promise<void> {
	const host = document.createElement('div');
	document.body.append(host);
	const setupFailure = new Error('injected chrome setup failure');
	let fullscreenSubscriptionDisposed = false;
	let rejected = false;
	try {
		await ProductWindowChrome.create(
			host,
			{
				configuration: async () => variants[0]!.configuration,
				onDidChangeMaterial: () => ({ dispose() {} }),
				onDidChangeFullscreen: () => ({
					dispose: () => {
						fullscreenSubscriptionDisposed = true;
					}
				}),
				zoomFactor: () => 1,
				update: async () => undefined
			},
			{
				theme: themeService.theme,
				forcedColorsActive: themeService.forcedColorsActive,
				followsSystemColorScheme: false,
				onDidChangeTheme: () => {
					throw setupFailure;
				},
				onDidChangePresentation: themeService.onDidChangePresentation
			}
		);
	} catch (error) {
		rejected = error === setupFailure;
	}
	if (
		!rejected ||
		!fullscreenSubscriptionDisposed ||
		host.classList.contains('prctr-product-window-chrome') ||
		host.childElementCount !== 0 ||
		host.dataset.chromeMode !== undefined ||
		host.style.getPropertyValue('--prctr-product-titlebar-height') !== ''
	)
		throw new Error('Failed window chrome setup did not roll back owned state');
	host.remove();
}

async function verifyFailedConstructionCleanup(
	document: Document,
	themeService: ProductWindowChromeThemeService
): Promise<void> {
	const host = document.createElement('div');
	document.body.append(host);
	let rejected = false;
	try {
		await ProductWindowChrome.create(
			host,
			{
				configuration: async () => variants[0]!.configuration,
				onDidChangeMaterial: () => ({ dispose() {} }),
				onDidChangeFullscreen: () => ({ dispose() {} }),
				zoomFactor: () => 1,
				update: async () => {
					throw new Error('injected chrome update failure');
				}
			},
			themeService
		);
	} catch (error) {
		rejected = error instanceof Error && error.message === 'injected chrome update failure';
	}
	if (
		!rejected ||
		host.classList.contains('prctr-product-window-chrome') ||
		host.childElementCount !== 0
	)
		throw new Error('Failed window chrome construction did not roll back owned DOM');
	host.remove();
}

async function verifyDimmedRetry(document: Document): Promise<void> {
	const host = document.createElement('div');
	document.body.append(host);
	const themeService = new FixtureThemeService();
	const updates: ProductWindowChromeUpdate[] = [];
	let rejectFirstDimmedUpdate = true;
	const chrome = await ProductWindowChrome.create(
		host,
		{
			configuration: async () => variants[0]!.configuration,
			onDidChangeMaterial: () => ({ dispose() {} }),
			onDidChangeFullscreen: () => ({ dispose() {} }),
			zoomFactor: () => 1,
			update: async (update) => {
				updates.push(update);
				if (update.dimmed && rejectFirstDimmedUpdate) {
					rejectFirstDimmedUpdate = false;
					throw new Error('injected dimming update failure');
				}
			}
		},
		themeService
	);
	let rejected = false;
	try {
		await chrome.setDimmed(true);
	} catch (error) {
		rejected = error instanceof Error && error.message === 'injected dimming update failure';
	}
	await chrome.setDimmed(true);
	if (!rejected || updates.filter((update) => update.dimmed).length !== 2)
		throw new Error('Window chrome did not retry an unchanged failed dimming request');
	chrome.dispose();
	themeService.dispose();
	host.remove();
}

async function verifyDisposalFence(document: Document): Promise<void> {
	const host = document.createElement('div');
	document.body.append(host);
	const themeService = new FixtureThemeService();
	let updateCalls = 0;
	let releasePending!: () => void;
	const pending = new Promise<void>((resolve) => {
		releasePending = resolve;
	});
	const chrome = await ProductWindowChrome.create(
		host,
		{
			configuration: async () => variants[0]!.configuration,
			onDidChangeMaterial: () => ({ dispose() {} }),
			onDidChangeFullscreen: () => ({ dispose() {} }),
			zoomFactor: () => 1,
			update: async () => {
				updateCalls++;
				if (updateCalls === 2) await pending;
			}
		},
		themeService
	);
	themeService.setTheme('dark');
	while (updateCalls < 2) await Promise.resolve();
	themeService.setTheme('highContrastLight');
	chrome.dispose();
	releasePending();
	await Promise.resolve();
	await Promise.resolve();
	if (updateCalls !== 2)
		throw new Error('Disposed window chrome executed a queued privileged update');
	themeService.dispose();
	host.remove();
}

function verifyControlInsetGeometry(
	chrome: ProductWindowChrome,
	variant: (typeof variants)[number],
	documentZoom = 1
): void {
	const inset = chrome.element.querySelector<HTMLElement>(
		'.prctr-product-window-chrome__controls-inset'
	);
	if (inset === null) throw new Error(`Window chrome ${variant.id} has no native inset`);
	const hostBounds = chrome.element.getBoundingClientRect();
	const insetBounds = inset.getBoundingClientRect();
	const expectedWidth = variant.configuration.platform === 'darwin' ? 70 * documentZoom : 138;
	if (
		variant.configuration.platform !== 'linux' &&
		Math.abs(insetBounds.width - expectedWidth) > 1
	)
		throw new Error(`Window chrome ${variant.id} has the wrong physical inset width`);
	const expectedEdge =
		variant.configuration.controlsLocation === 'left'
			? Math.abs(insetBounds.left - hostBounds.left)
			: Math.abs(insetBounds.right - hostBounds.right);
	if (expectedEdge > 1)
		throw new Error(`Window chrome ${variant.id} inset is on the wrong physical edge`);
	if (chrome.element.scrollWidth > chrome.element.clientWidth)
		throw new Error(`Window chrome ${variant.id} overflows its constrained container`);
}
