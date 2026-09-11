import { bootstrapWorkbench } from '../../src/prctr/workbench/browser/bootstrap.js';
import { authenticatedComposition } from '../../src/prctr/workbench/browser/authenticatedManifest.js';
import { commonWorkbenchContributions } from '../../src/prctr/workbench/workbench.common.main.js';
import { createDesktopWorkbenchContribution } from '../../src/prctr/code/electron-browser/workbench.desktop.main.js';
import { createAuthenticatedContribution } from '../../src/prctr/workbench/contrib/authenticated/browser/authenticatedContribution.js';
import {
	AUTHENTICATED_LAYOUT_SERVICE,
	type AuthenticatedLayout
} from '../../src/prctr/workbench/contrib/authenticated/browser/authenticatedLayout.js';
import { WORKBENCH_COMMAND_SERVICE } from '../../src/prctr/workbench/common/serviceIds.js';
import type { ICommandService } from '../../src/prctr/platform/commands/common/commands.js';
import {
	AUTHENTICATED_NAVIGATION_SERVICE,
	type AuthenticatedNavigationService
} from '../../src/prctr/workbench/contrib/authenticated/browser/authenticatedNavigation.js';
import { IQuickInputService } from '../../src/prctr/platform/quickinput/common/quickInput.js';
import { ServiceCollection } from '../../src/prctr/platform/instantiation/common/serviceCollection.js';
import { WORKBENCH_SERVICE_COLLECTION } from '../../src/prctr/workbench/common/serviceIds.js';
import { isMacintosh } from '../../src/prctr/base/common/platform.js';

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}
async function eventually(predicate: () => boolean): Promise<void> {
	const deadline = performance.now() + 4000;
	while (!predicate()) {
		if (performance.now() > deadline) throw new Error('Layout control did not settle.');
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** Real shell/services with no Settings runtime or server needed to arrange the window. */
export async function exerciseAuthenticatedLayout(): Promise<void> {
	const saved = new Map(
		[
			'prctr.authenticated.layout.v1.sidebarVisible',
			'prctr.authenticated.layout.v2.primarySide'
		].map((key) => [key, localStorage.getItem(key)])
	);

	let commands!: ICommandService;
	let layout!: AuthenticatedLayout;
	let services!: ServiceCollection;
	let settingsRequests = 0;
	const result = await bootstrapWorkbench(document, authenticatedComposition, [
		...commonWorkbenchContributions,
		createDesktopWorkbenchContribution(
			'authenticated',
			async () => ({
				protocolVersion: 1,
				kind: 'authenticated',
				windowId: 'window:layout-test',
				institutionOrigin: 'https://institution.example.test',
				principalId: 'principal:one',
				sessionId: 'session:one',
				initialDestination: 'account'
			}),
			{
				async configuration() {
					return {
						protocolVersion: 1,
						platform: isMacintosh ? 'darwin' : 'linux',
						mode: isMacintosh ? 'nativeTrafficLights' : 'nativeOverlay',
						controlsLocation: isMacintosh ? 'left' : 'right',
						titlebarHeight: 35,
						fullscreen: false
					};
				},
				onDidChangeFullscreen() {
					return { dispose() {} };
				},
				zoomFactor() {
					return 1;
				},
				async update() {}
			}
		),
		createAuthenticatedContribution({ async signOut() {}, async close() {} }, true),
		{
			id: 'prctr.authenticated.account',
			phase: 'ready',
			dependencies: ['prctr.authenticated.navigation'],
			messages: [],
			activate(context) {
				commands = context.getService(WORKBENCH_COMMAND_SERVICE);
				layout = context.getService(AUTHENTICATED_LAYOUT_SERVICE);
				services = context.getService(WORKBENCH_SERVICE_COLLECTION);
				context.disposables.add(
					context
						.getService<AuthenticatedNavigationService>(
							AUTHENTICATED_NAVIGATION_SERVICE
						)
						.onDidRequestSettings(() => settingsRequests++)
				);
			}
		},
		{
			id: 'prctr.authenticated.settings',
			phase: 'ready',
			dependencies: ['prctr.authenticated.navigation'],
			messages: [],
			activate() {}
		}
	]);
	try {
		check(
			!result.shell.element.querySelector('[data-part="status"]'),
			'Status bar was retained.'
		);
		check(
			!result.shell.element.querySelector('.prctr-notifications-indicator'),
			'Notification bell was retained.'
		);
		const primary = document.querySelector<HTMLButtonElement>(
			'[data-layout-action="primary"]'
		)!;
		const secondary = document.querySelector<HTMLButtonElement>(
			'[data-layout-action="secondary"]'
		)!;
		check(
			secondary.disabled && !result.shell.secondaryVisible,
			'Secondary starts unavailable and closed.'
		);
		const settings = document.querySelector<HTMLButtonElement>(
			'[data-region="settings-trigger"]'
		)!;
		const account = document.querySelector<HTMLButtonElement>('[data-region="trigger"]')!;
		check(
			settings.previousElementSibling?.getAttribute('data-region') === 'titlebar-separator',
			'Settings lacks its layout separator.'
		);
		check(
			settings.nextElementSibling?.nextElementSibling === account,
			'Account is not last after the Settings separator.'
		);
		settings.click();
		check(settingsRequests === 1, 'Titlebar Settings did not request the existing modal.');
		account.click();
		check(
			![...document.querySelectorAll('[role="menuitem"]')].some(
				(item) => item.textContent === 'Settings'
			),
			'Settings remained in account menu.'
		);
		account.click();
		primary.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		await eventually(
			() =>
				!!document
					.querySelector('.monaco-hover')
					?.textContent?.includes('Toggle Primary Side Bar')
		);
		const tooltip = document.querySelector<HTMLElement>('.monaco-hover')!;
		check(
			tooltip.textContent?.includes(isMacintosh ? '⌘B' : 'Ctrl+B'),
			'Tooltip omitted the registered shortcut.'
		);
		check(
			tooltip.getBoundingClientRect().top >= primary.getBoundingClientRect().bottom,
			'Titlebar tooltip overlaps its trigger.'
		);
		primary.dispatchEvent(new MouseEvent('mouseleave'));
		const before = result.shell.navigationVisible;
		primary.focus();
		primary.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'b',
				code: 'KeyB',
				keyCode: 66,
				metaKey: isMacintosh,
				ctrlKey: !isMacintosh,
				bubbles: true,
				cancelable: true
			})
		);
		await eventually(() => result.shell.navigationVisible !== before);
		await commands.executeCommand('prctr.authenticated.toggleSidebar');
		check(result.shell.navigationVisible === before, 'Command did not restore the primary.');
		let disposed = 0;
		const registration = layout.registerSecondary('account/profile', (container) => {
			const input = document.createElement('input');
			container.append(input);
			return {
				dispose() {
					disposed++;
					input.remove();
				}
			};
		});
		await commands.executeCommand('prctr.authenticated.toggleSecondarySidebar');
		check(result.shell.secondaryVisible, 'Available secondary did not open.');
		result.shell.part('sidebar').querySelector('input')!.focus();
		registration.dispose();
		check(
			disposed === 1 && secondary.disabled && !result.shell.secondaryVisible,
			'Secondary registration cleanup failed.'
		);
		check(
			document.activeElement === result.shell.part('content'),
			'Removing secondary content stranded focus.'
		);
		await commands.executeCommand('prctr.authenticated.customizeLayout');
		await eventually(
			() => !!document.querySelector<HTMLElement>('.quick-input-widget')?.offsetHeight
		);
		const row = [
			...document.querySelectorAll<HTMLElement>('.quick-input-list .prctr-list-row')
		].find((element) => element.textContent?.trim() === 'Right');
		check(row, 'Source picker omitted Right.');
		row.click();
		await eventually(() => result.shell.primarySide === 'right');
		check(
			document.querySelector<HTMLElement>('.quick-input-widget')!.offsetHeight > 0,
			'Picker closed after selection.'
		);
		const escape = () =>
			document.activeElement!.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Escape',
					code: 'Escape',
					keyCode: 27,
					bubbles: true,
					cancelable: true
				})
			);
		escape();
		await eventually(
			() => !document.querySelector<HTMLElement>('.quick-input-widget')?.offsetHeight
		);
		// Another controller installed by the lazy Settings composition must not steal layout commands.
		const original = services.get(IQuickInputService);
		let otherHidden = false;
		const other = new Proxy(original, {
			get(target, key, receiver) {
				return key === 'cancel'
					? () => {
							otherHidden = true;
						}
					: Reflect.get(target, key, receiver);
			}
		});
		services.set(IQuickInputService, other);
		await commands.executeCommand('prctr.authenticated.customizeLayout');
		await eventually(
			() => !!document.querySelector<HTMLElement>('.quick-input-widget')?.offsetHeight
		);
		const close = document.querySelector<HTMLElement>('.quick-input-titlebar .codicon-close')!;
		check(close, 'Source close action missing.');
		const probe = document.createElement('span');
		probe.style.color = 'var(--prctr-theme-icon-foreground)';
		result.shell.element.append(probe);
		check(
			getComputedStyle(close).color === getComputedStyle(probe).color,
			'Picker action is not using the source muted icon token.'
		);
		probe.remove();
		close.focus();
		escape();
		await eventually(
			() => !document.querySelector<HTMLElement>('.quick-input-widget')?.offsetHeight
		);
		check(
			!otherHidden && services.get(IQuickInputService) === other,
			'Picker command ownership did not restore the other controller.'
		);
		services.set(IQuickInputService, original);
		await commands.executeCommand('prctr.authenticated.customizeLayout');
		await eventually(
			() => !!document.querySelector<HTMLElement>('.quick-input-widget')?.offsetHeight
		);
		const lease = result.shell.overlayHost.acquireExternalModal();
		check(primary.disabled, 'Modal gate did not disable the toolbar.');
		await commands.executeCommand('prctr.authenticated.toggleSidebar');
		check(result.shell.navigationVisible === before, 'Layout changed behind a modal.');
		lease.dispose();
		check(!primary.disabled, 'Toolbar did not recover after modal.');
	} finally {
		result.disposables.dispose();
		for (const [key, value] of saved) {
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		}
	}
}
