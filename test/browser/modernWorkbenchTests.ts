import {
	AuthenticatedLayout,
	AUTHENTICATED_LAYOUT_SERVICE
} from '../../src/prctr/workbench/contrib/authenticated/browser/authenticatedLayout.ts';
import type { WorkbenchBootstrapContext } from '../../src/prctr/workbench/browser/bootstrap.ts';
import { AuthenticatedLayoutState } from '../../src/prctr/workbench/contrib/authenticated/browser/authenticatedLayoutState.ts';
import { DisposableStore } from '../../src/prctr/base/common/lifecycle.ts';
import { createLocalization } from '../../src/prctr/base/common/localization.ts';
import {
	ProductWindowChrome,
	PRODUCT_WINDOW_CHROME_SERVICE
} from '../../src/prctr/platform/windows/browser/productWindowChrome.ts';
import {
	activateAccountShellNavigation,
	accountShellMessages
} from '../../src/prctr/workbench/contrib/authenticated/browser/accountShellNavigation.ts';
import {
	WorkbenchShell,
	type WorkbenchShellLabels
} from '../../src/prctr/workbench/browser/workbenchShell.ts';
import { authenticatedComposition } from '../../src/prctr/workbench/browser/authenticatedManifest.ts';
import { BrowserThemeService } from '../../src/prctr/platform/theme/browser/themeService.ts';

/** Exercise the same shell interface used by the authenticated composition. */
export async function runModernWorkbenchTests(
	parentDocument: Document,
	labels: WorkbenchShellLabels
): Promise<void> {
	const stored = new Map<string, string>();
	const persistence = {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => {
			stored.set(key, value);
		}
	};
	const initialLayout = new AuthenticatedLayoutState(persistence);
	if (!initialLayout.sidebarVisible) throw new Error('Sidebar must initially be visible');
	initialLayout.primarySide = 'right';
	if (new AuthenticatedLayoutState(persistence).primarySide !== 'right')
		throw new Error('Position preference failed restoration');
	initialLayout.sidebarVisible = false;
	if (new AuthenticatedLayoutState(persistence).sidebarVisible)
		throw new Error('Sidebar preference failed restoration');
	const unavailable = new AuthenticatedLayoutState({
		getItem() {
			throw new Error('unavailable');
		},
		setItem() {
			throw new Error('unavailable');
		}
	});
	unavailable.sidebarVisible = false;
	if (!unavailable.sidebarVisible)
		throw new Error('Unavailable layout storage must use its default');
	const fixture = parentDocument.createElement('iframe');
	fixture.style.cssText = 'position:fixed;inset:0;width:1100px;height:800px';
	parentDocument.body.append(fixture);
	const document = fixture.contentDocument!;
	await Promise.all(
		[...parentDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(
			(original) =>
				new Promise<void>((resolve, reject) => {
					const link = document.createElement('link');
					link.rel = 'stylesheet';
					link.href = original.href;
					link.onload = () => resolve();
					link.onerror = () =>
						reject(new Error('Modern shell fixture stylesheet unavailable'));
					document.head.append(link);
				})
		)
	);
	for (const style of parentDocument.querySelectorAll('style'))
		document.head.append(document.importNode(style, true));
	const host = document.createElement('div');
	host.style.cssText = 'position:fixed;inset:0;inline-size:1024px;block-size:720px';
	document.body.append(host);
	const theme = new BrowserThemeService(document, 'dark', {
		density: 'default',
		motion: 'reduced',
		transparency: 'reduced'
	});
	const shell = new WorkbenchShell(host, authenticatedComposition, labels);
	shell.element.dir = 'ltr';
	const view = document.defaultView!;
	const frame = () => new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
	const assert = (value: boolean, message: string) => {
		if (!value) throw new Error(`Modern workbench: ${message}`);
	};
	const close = (actual: number, expected: number, message: string) =>
		assert(Math.abs(actual - expected) < 1, `${message}: ${actual} != ${expected}`);
	try {
		shell.setNavigationLayout('sidebar');
		shell.setPartVisible('sidebar', false);
		const nav = shell.part('navigation');
		const content = shell.part('content');
		assert(
			shell.element.querySelector('[data-sash], .prctr-workbench__reset') === null,
			'fixed composition must not expose resize or reset controls'
		);
		const toggle = shell.element.querySelector<HTMLButtonElement>(
			'[data-region-toggle="sidebar"]'
		)!;
		const button = document.createElement('button');
		button.textContent = 'Account';
		nav.append(button);
		for (const color of ['dark', 'light', 'highContrastDark', 'highContrastLight'] as const) {
			theme.setTheme(color);
			for (const density of ['default', 'compact'] as const) {
				theme.setPreferences({ density, motion: 'reduced', transparency: 'reduced' });
				shell.layout();
				await frame();
				const n = nav.getBoundingClientRect();
				const c = content.getBoundingClientRect();
				const bounds = shell.element.getBoundingClientRect();
				close(n.left - bounds.left, 4, 'outer navigation gutter');
				close(bounds.right - c.right, 4, 'outer content gutter');
				close(c.left - n.right, density === 'compact' ? 0 : 4, 'density gap');
				close(n.bottom, c.bottom, 'part bottom alignment');
				close(bounds.bottom - c.bottom, 4, 'window bottom gutter without a status bar');
				const style = view.getComputedStyle(content);
				assert(
					style.boxSizing === 'border-box' && style.overflow === 'hidden',
					'content must subtract and clip its border'
				);
				assert(style.borderTopRightRadius === '8px', 'outer radius lost');
				assert(
					density !== 'compact' || style.backgroundImage.includes('radial-gradient'),
					'compact corner stroke omitted'
				);
			}
		}
		theme.setPreferences({ density: 'default', motion: 'full', transparency: 'full' });
		shell.layout();
		const width = nav.getBoundingClientRect().width;
		host.style.inlineSize = '800px';
		shell.layout();
		close(nav.getBoundingClientRect().width, width, 'sidebar stays fixed as window shrinks');
		host.style.inlineSize = '1024px';
		shell.layout();
		close(nav.getBoundingClientRect().width, width, 'sidebar stays fixed as window grows');
		shell.element.dir = 'rtl';
		shell.setPrimarySide('right');
		shell.layout();
		close(
			nav.getBoundingClientRect().left - content.getBoundingClientRect().right,
			4,
			'RTL gap'
		);
		assert(
			nav.dataset.outerRight === 'true' && content.dataset.outerLeft === 'true',
			'RTL perimeter ownership'
		);
		shell.element.dir = 'ltr';
		shell.setPrimarySide('left');
		// 1180x760 at 200% zoom has a 590x380 CSS viewport. No inaccessible squeeze.
		host.style.inlineSize = '590px';
		host.style.blockSize = '380px';
		shell.layout();
		assert(
			view.getComputedStyle(nav).display === 'none' && !toggle.hidden,
			'narrow navigation disclosure'
		);
		close(
			content.getBoundingClientRect().width,
			582,
			'narrow content uses full width minus gutters'
		);
		toggle.click();
		shell.layout();
		assert(
			view.getComputedStyle(content).display === 'none' &&
				view.getComputedStyle(nav).display !== 'none',
			'narrow navigation reveal'
		);
		button.focus();
		shell.revealContent();
		assert(
			document.activeElement === content && view.getComputedStyle(nav).display === 'none',
			'destination restores visible content focus'
		);
		host.style.inlineSize = '1024px';
		host.style.blockSize = '720px';
		shell.layout();
		assert(
			!shell.element.querySelector('[data-part="status"]'),
			'AuthenticatedWindow has no status bar'
		);
		shell.setSecondaryVisible(true);
		const side = shell.part('sidebar');
		close(
			side.getBoundingClientRect().left - content.getBoundingClientRect().right,
			4,
			'secondary gap'
		);
		shell.setPrimarySide('right');
		close(
			nav.getBoundingClientRect().left - content.getBoundingClientRect().right,
			4,
			'right primary gap'
		);
		close(
			content.getBoundingClientRect().left - side.getBoundingClientRect().right,
			4,
			'left secondary gap'
		);
		shell.setPrimarySide('left');
		shell.setSecondaryVisible(false);
		const widthBefore = content.getBoundingClientRect().width;
		for (let index = 0; index < 5; index++) shell.layout();
		close(
			content.getBoundingClientRect().width,
			widthBefore,
			'repeated layout must not compound insets'
		);
		const accountStore = new DisposableStore();
		const savedLayout = new Map(
			[
				'prctr.authenticated.layout.sidebarVisible',
				'prctr.authenticated.layout.primarySide'
			].map((key) => [key, document.defaultView!.localStorage.getItem(key)])
		);
		const preferences = new AuthenticatedLayoutState(document.defaultView!.localStorage);
		preferences.primarySide = 'left';
		preferences.sidebarVisible = true;
		try {
			const chrome = accountStore.add(
				await ProductWindowChrome.create(
					shell.part('titlebar'),
					{
						configuration: async () => ({
							platform: 'win32',
							mode: 'nativeOverlay',
							controlsLocation: 'right',
							titlebarHeight: 35,
							fullscreen: false,
							material: 'none' as const
						}),
						onDidChangeMaterial: () => ({ dispose() {} }),
						onDidChangeFullscreen: () => ({ dispose() {} }),
						zoomFactor: () => 1,
						update: async () => {}
					},
					theme
				)
			);
			const services = new Map<string, unknown>([[PRODUCT_WINDOW_CHROME_SERVICE, chrome]]);
			const context: WorkbenchBootstrapContext = {
				document,
				shell,
				composition: authenticatedComposition,
				disposables: accountStore,
				localization: createLocalization({
					requestedLocale: 'en',
					messages: Object.values(accountShellMessages)
				}),
				getService: <T>(id: string) => services.get(id) as T,
				setService: (id, value) => {
					services.set(id, value);
				},
				setWindowBinding() {},
				getWindowBinding() {}
			};
			const layout = accountStore.add(new AuthenticatedLayout(context));
			services.set(AUTHENTICATED_LAYOUT_SERVICE, layout);
			activateAccountShellNavigation(
				context,
				{ signOut: async () => {}, close: async () => {} },
				{
					kind: 'authenticated',
					windowId: 'test:titlebar',
					institutionOrigin: 'https://example.test',
					principalId: 'principal',
					sessionId: 'session',
					initialDestination: 'account'
				}
			);
			const trigger =
				chrome.actions.querySelector<HTMLButtonElement>('[data-region="trigger"]')!;
			assert(
				!!trigger && !nav.querySelector('[data-region="trigger"]'),
				'account trigger belongs only to titlebar actions'
			);
			assert(
				!trigger.querySelector('[data-prctr-semantic-icon="disclosure.expanded"]'),
				'profile chevron removed'
			);
			const sidebarToggle = chrome.actions.querySelector<HTMLButtonElement>(
				'[data-layout-action="primary"]'
			)!;
			assert(
				sidebarToggle.parentElement!.nextElementSibling?.nextElementSibling?.getAttribute(
					'data-region'
				) === 'settings-trigger',
				'layout controls precede Settings'
			);
			assert(
				trigger.previousElementSibling?.getAttribute('data-region') ===
					'titlebar-separator',
				'account follows its separator'
			);
			const checkSidebar = (visible: boolean): void => {
				assert(
					shell.navigationVisible === visible &&
						sidebarToggle.getAttribute('aria-expanded') === String(visible),
					'sidebar state and toggle semantics stay synchronized'
				);
				assert(
					sidebarToggle
						.querySelector('[data-prctr-semantic-icon]')
						?.getAttribute('data-prctr-semantic-icon') ===
						(visible ? 'workbench.sidebarLeft' : 'workbench.sidebarLeftHidden'),
					'sidebar icon follows actual visibility'
				);
			};
			const secondaryToggle = chrome.actions.querySelector<HTMLButtonElement>(
				'[data-layout-action="secondary"]'
			)!;
			assert(secondaryToggle.disabled, 'secondary toggle unavailable without page content');
			let releases = 0;
			const registration = layout.registerSecondary('account/profile', (container) => {
				const detail = document.createElement('button');
				detail.textContent = 'Item detail';
				container.append(detail);
				return {
					dispose() {
						releases++;
						detail.remove();
					}
				};
			});
			assert(
				!secondaryToggle.disabled && !shell.secondaryVisible,
				'page enables secondary without opening it'
			);
			secondaryToggle.click();
			assert(
				shell.secondaryVisible && side.textContent === 'Item detail',
				'secondary reveals page-owned content'
			);
			layout.setDestination('activity');
			assert(
				!shell.secondaryVisible &&
					secondaryToggle.disabled &&
					releases === 1 &&
					!side.textContent,
				'navigation releases secondary content'
			);
			layout.setDestination('account/profile');
			assert(!shell.secondaryVisible, 'returning to page starts with secondary closed');
			registration.dispose();
			assert(secondaryToggle.disabled, 'unregister removes page availability');
			checkSidebar(true);
			sidebarToggle.click();
			checkSidebar(false);
			close(
				content.getBoundingClientRect().width,
				1016,
				'hidden sidebar releases its full grid slot'
			);
			assert(
				!new AuthenticatedLayoutState(document.defaultView!.localStorage).sidebarVisible,
				'hidden preference survives a fresh state owner'
			);
			sidebarToggle.click();
			checkSidebar(true);
			assert(
				new AuthenticatedLayoutState(document.defaultView!.localStorage).sidebarVisible,
				'shown preference is saved'
			);
			host.style.inlineSize = '590px';
			shell.layout();
			checkSidebar(false);
			assert(
				new AuthenticatedLayoutState(document.defaultView!.localStorage).sidebarVisible,
				'responsive hiding must not overwrite explicit preference'
			);
			assert(
				shell.element.querySelector<HTMLButtonElement>('[data-region-toggle="sidebar"]')!
					.hidden === true,
				'only one sidebar toggle at narrow widths'
			);
			sidebarToggle.click();
			checkSidebar(true);
			shell.revealContent();
			checkSidebar(false);
			host.style.inlineSize = '1024px';
			shell.layout();
			checkSidebar(true);
			trigger.querySelector('.prctr-account-shell__name')!.textContent =
				'A very long full account name that must fit without covering native controls';
			for (const width of [1024, 640, 590, 320]) {
				host.style.inlineSize = `${width}px`;
				shell.layout();
				await frame();
				const action = trigger.getBoundingClientRect();
				const reserved = chrome.element
					.querySelector('.prctr-product-window-chrome__controls-inset')!
					.getBoundingClientRect();
				assert(
					action.right <= reserved.left && action.left >= 0,
					'account action overlaps native controls or leaves viewport'
				);
				assert(
					trigger.scrollWidth <= trigger.clientWidth,
					'account trigger overflows at constrained width'
				);
				close(action.height, 24, 'compact titlebar account hit area');
			}
			// Menu interactions run in authenticatedLayoutTests with the production service graph.
		} finally {
			accountStore.dispose();
			for (const [key, value] of savedLayout) {
				if (value === null) document.defaultView!.localStorage.removeItem(key);
				else document.defaultView!.localStorage.setItem(key, value);
			}
		}
	} finally {
		shell.dispose();
		theme.dispose();
		host.remove();
		fixture.remove();
	}
}
