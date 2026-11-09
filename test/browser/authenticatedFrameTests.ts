import { bootstrapWorkbench } from '../../src/prctr/workbench/browser/bootstrap.js';
import { authenticatedComposition } from '../../src/prctr/workbench/browser/authenticatedManifest.js';
import { commonWorkbenchContributions } from '../../src/prctr/workbench/workbench.common.main.js';
import { createDesktopWorkbenchContribution } from '../../src/prctr/code/electron-browser/workbench.desktop.main.js';
import { authenticatedFrameContribution } from '../../src/prctr/workbench/browser/authenticated/authenticated.contribution.js';
import { IAuthenticatedNavigationService } from '../../src/prctr/workbench/services/authenticatedNavigation/common/authenticatedNavigation.js';
import { ICommandService } from '../../src/prctr/platform/commands/common/commands.js';
import { isMacintosh } from '../../src/prctr/base/common/platform.js';
import { settingsContribution } from '../../src/prctr/workbench/contrib/settings/settings.contribution.js';
import type { UserSettingsProjection } from '../../src/prctr/platform/settings/common/settingsRendererProtocol.js';
import { IBrowserThemeService } from '../../src/prctr/platform/theme/browser/themeService.js';
import { authenticatedWindowServices } from '../../src/prctr/code/electron-browser/authenticatedServices.js';
import {
	inertContribution,
	unavailableAccount,
	unavailableAdministration,
	unusedClipboard
} from './authenticatedTestServices.js';

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`Authenticated frame: ${message}`);
}
async function eventually(predicate: () => boolean, message: string): Promise<void> {
	const deadline = performance.now() + 2000;
	while (!predicate()) {
		if (performance.now() > deadline) throw new Error(`Authenticated frame: ${message}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
/** Name the running step in the harness, so a stalled fixture reports where it stopped. */
function step(name: string): void {
	document.body.dataset.currentSuite = `authenticated-frame: ${name}`;
}
function close(actual: number, expected: number, message: string): void {
	check(Math.abs(actual - expected) < 1.5, `${message}: ${actual} != ${expected}`);
}
function key(target: Element, key: string, init: KeyboardEventInit = {}): void {
	target.dispatchEvent(
		new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
	);
}

const LAYOUT_KEYS = [
	'prctr.authenticated.layout.sidebarVisible',
	'prctr.authenticated.layout.sidebarWidth'
];

/** The production frame in a resizable window-sized frame, with no server or Settings runtime. */
export async function runAuthenticatedFrameTests(): Promise<void> {
	const frame = document.createElement('iframe');
	frame.style.cssText = 'position:fixed;inset:0;width:1180px;height:760px;border:0';
	document.body.append(frame);
	const child = frame.contentDocument!;
	for (const style of document.head.querySelectorAll('link[rel="stylesheet"], style'))
		child.head.append(style.cloneNode(true));
	const storage = child.defaultView!.localStorage;
	const saved = LAYOUT_KEYS.map((name) => [name, storage.getItem(name)] as const);
	for (const name of LAYOUT_KEYS) storage.removeItem(name);
	try {
		await exerciseFrame(child, frame);
	} finally {
		for (const [name, value] of saved)
			if (value === null) storage.removeItem(name);
			else storage.setItem(name, value);
		frame.remove();
	}
}

async function exerciseFrame(document: Document, frame: HTMLIFrameElement): Promise<void> {
	let signOuts = 0;
	const settingsListeners = new Set<(projection: UserSettingsProjection) => void>();
	let resolveSnapshot!: (projection: UserSettingsProjection) => void;
	const projection = (
		presented: Partial<UserSettingsProjection['presentation']>
	): UserSettingsProjection => ({
		source: '{}',
		revision: 'revision:one',
		availability: 'available',
		writable: true,
		presentation: {
			windowTheme: 'system',
			highContrast: false,
			zoomPercent: 100,
			reducedMotion: false,
			...presented
		}
	});
	const settingsClient = {
		projection: () =>
			new Promise<UserSettingsProjection>((resolve) => {
				resolveSnapshot = resolve;
			}),
		async preview() {},
		async cancelPreview() {},
		async commit() {
			return { kind: 'unavailable' as const };
		},
		onDidChange(listener: (projection: UserSettingsProjection) => void) {
			settingsListeners.add(listener);
			return () => settingsListeners.delete(listener);
		}
	};
	step('bootstrap');
	const result = await bootstrapWorkbench(
		document,
		authenticatedComposition,
		[
			...commonWorkbenchContributions,
			createDesktopWorkbenchContribution('authenticated', async () => ({
				kind: 'authenticated',
				windowId: 'window:frame-test',
				institutionOrigin: 'https://institution.example.test',
				principalId: 'y'.repeat(26),
				sessionId: 'b'.repeat(26),
				initialDestination: 'activity',
				identity: {
					principalId: 'y'.repeat(26),
					sessionId: 'b'.repeat(26),
					institutionOrigin: 'https://institution.example.test',
					institutionName: 'Northbridge University',
					displayName: 'Amara Okafor',
					availableProductAreas: [
						'account',
						'settings',
						'student_activity',
						'administration'
					],
					noCurrentAffiliation: false,
					noAssignedAccess: false
				}
			})),
			authenticatedFrameContribution,
			inertContribution('prctr.authenticated.exams', ['prctr.authenticated.navigation']),
			inertContribution('prctr.authenticated.account', ['prctr.authenticated.navigation']),
			inertContribution('prctr.authenticated.administration', [
				'prctr.authenticated.navigation'
			]),
			settingsContribution
		],
		{
			windowChrome: {
				async configuration() {
					return {
						platform: 'win32',
						mode: 'nativeOverlay',
						controlsLocation: 'right',
						titlebarHeight: 32,
						fullscreen: false,
						material: 'none' as const
					};
				},
				onDidChangeMaterial: () => ({ dispose() {} }),
				onDidChangeFullscreen: () => ({ dispose() {} }),
				zoomFactor: () => 1,
				async update() {}
			},
			services: authenticatedWindowServices({
				async signOut() {
					signOuts++;
					throw new Error('sign-out unavailable');
				},
				account: unavailableAccount,
				administration: unavailableAdministration,
				settings: settingsClient,
				clipboard: unusedClipboard
			})
		}
	);
	const [navigation, commands, themes] = result.instantiationService.invokeFunction(
		(accessor) =>
			[
				accessor.get(IAuthenticatedNavigationService),
				accessor.get(ICommandService),
				accessor.get(IBrowserThemeService)
			] as const
	);
	const shell = result.shell;
	const root = shell.element;
	const rail = shell.part('navigation');
	const sidebar = shell.part('sidebar');
	const content = shell.part('content');
	const areas = () => [...rail.querySelectorAll<HTMLButtonElement>('.prctr-area-rail__area')];
	const photo = rail.querySelector<HTMLButtonElement>('.prctr-area-rail__account')!;
	const entry = (id: string) =>
		[...sidebar.querySelectorAll<HTMLButtonElement>('.prctr-area-sidebar__entry')].find(
			(button) => button.dataset.entry === id && button.closest('[hidden]') === null
		);
	const topButton = (action: string) =>
		content.querySelector<HTMLButtonElement>(
			`.prctr-content-top-bar__button[data-action="${action}"]`
		)!;
	const nav = (): IAuthenticatedNavigationService => navigation;
	const presentation = (): string | undefined => root.dataset.sidebarPresentation;
	// A timer backs up the frame callback, which an unfocused window may not deliver promptly.
	const frameLayout = () =>
		new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
			setTimeout(resolve, 50);
		});
	try {
		check(!root.querySelector('[data-part="status"]'), 'AuthenticatedWindow has no status bar');
		check(
			!root.querySelector('[data-layout-action], [data-region="trigger"]'),
			'Removed titlebar controls are absent'
		);
		check(
			rail.tagName === 'NAV' && rail.getAttribute('aria-label') === 'Areas',
			'Rail is a labelled navigation landmark'
		);
		check(
			sidebar.tagName === 'NAV' && !!sidebar.getAttribute('aria-labelledby'),
			'Sidebar is a labelled navigation landmark'
		);
		const visibleAreas = areas().filter((button) => !button.hidden);
		check(
			visibleAreas.map((button) => button.textContent).join() === 'Activity,Admin',
			'Rail lists only the areas the server makes available'
		);
		check(
			photo.textContent === 'AO' &&
				photo.getAttribute('aria-label') === 'Account: Amara Okafor',
			'Photo shows initials and names the account'
		);
		check(visibleAreas[0]!.getAttribute('aria-current') === 'page', 'Initial area is current');
		check(
			document.getElementById(sidebar.getAttribute('aria-labelledby')!)?.textContent ===
				'Activity',
			'Sidebar title follows the area'
		);
		check(
			entry('overview')?.getAttribute('aria-current') === 'page',
			'Overview is the current Activity page'
		);
		check(!!root.querySelector('.prctr-window-title'), 'Windows title bar names the product');
		check(
			!!content.querySelector('.prctr-unavailable-page:not([hidden])'),
			'Areas without pages say so'
		);

		await frameLayout();
		const bounds = root.getBoundingClientRect();
		const contentBounds = content.getBoundingClientRect();
		close(rail.getBoundingClientRect().width, 76, 'rail width');
		close(sidebar.getBoundingClientRect().width, 232, 'default sidebar width');
		const rtl = document.defaultView!.getComputedStyle(root).direction === 'rtl';
		const sidebarBounds = sidebar.getBoundingClientRect();
		close(
			rtl ? contentBounds.left - bounds.left : bounds.right - contentBounds.right,
			0,
			'content reaches the far edge'
		);
		close(bounds.bottom - contentBounds.bottom, 0, 'content reaches the bottom edge');
		close(
			rtl ? sidebarBounds.left : contentBounds.left,
			rtl ? contentBounds.right : sidebarBounds.right,
			'content follows the sidebar'
		);
		close(
			content.querySelector('.prctr-content-top-bar')!.getBoundingClientRect().height,
			52,
			'top bar height'
		);
		check(topButton('showSidebar').hidden, 'Show sidebar is hidden while the sidebar is shown');
		check(topButton('back').disabled && topButton('forward').disabled, 'History starts empty');

		step('Rail keyboard: one tab stop, arrow keys move and wrap to the photo.');
		visibleAreas[0]!.focus();
		key(visibleAreas[0]!, 'ArrowDown');
		check(document.activeElement === visibleAreas[1], 'ArrowDown moves within the rail');
		key(visibleAreas[1]!, 'End');
		check(document.activeElement === photo, 'End reaches the account photo');
		check(
			areas().filter((button) => button.tabIndex === 0).length === 0 && photo.tabIndex === 0,
			'Rail keeps one tab stop'
		);

		step('Navigation and history.');
		entry('upcoming')!.click();
		check(nav().activityView === 'upcoming', 'Sidebar page selects the Activity view');
		photo.click();
		check(
			nav().current === 'account' && photo.getAttribute('aria-current') === 'page',
			'Photo opens Account'
		);
		check(
			['profile', 'security', 'sessions', 'tokens', 'settings'].every((id) => !!entry(id)) &&
				!!sidebar.querySelector('[data-action="signOut"]:not([hidden])'),
			'Account sidebar lists its pages and Sign out'
		);
		entry('sessions')!.click();
		check(nav().accountPage === 'sessions', 'Sessions and devices opens Sessions');
		entry('tokens')!.click();
		check(nav().accountPage === 'tokens', 'Access tokens opens its own page');
		entry('settings')!.click();
		check(nav().accountPage === 'settings', 'Settings opens its Account page');
		check(!topButton('back').disabled, 'Back becomes available');
		topButton('back').click();
		check(nav().accountPage === 'tokens', 'Back returns to the previous page');
		topButton('forward').click();
		check(nav().accountPage === 'settings', 'Forward retraces');
		await commands.executeCommand('prctr.authenticated.navigateBack');
		await commands.executeCommand('prctr.authenticated.navigateBack');
		await commands.executeCommand('prctr.authenticated.navigateBack');
		await commands.executeCommand('prctr.authenticated.navigateBack');
		check(
			nav().current === 'activity' && nav().activityView === 'upcoming',
			'Back command crosses areas'
		);

		nav().select('administration');
		check(
			[...sidebar.querySelectorAll('.prctr-area-sidebar__section-title')]
				.filter((title) => !title.closest('[hidden]'))
				.map((title) => title.textContent)
				.join() === 'People,Organisation,Access,Records,Operations',
			'Administration groups its pages under their headings'
		);
		entry('users')!.click();
		check(nav().administration.page === 'users', 'Users opens its Administration page');
		nav().selectAdministrationPage('user', 'u'.repeat(26));
		check(
			entry('users')?.getAttribute('aria-current') === 'page' &&
				nav().administration.subject === 'u'.repeat(26),
			'A user’s page keeps Users marked in the sidebar'
		);

		step('Sign out asks first, and a failure stays in the Account sidebar.');
		photo.click();
		const signOutEntry = sidebar.querySelector<HTMLButtonElement>('[data-action="signOut"]')!;
		const confirmation = (): HTMLElement | null =>
			sidebar.ownerDocument.querySelector<HTMLElement>('.prctr-overlay-host__surface');
		const dialogButton = (label: string): HTMLButtonElement =>
			[...confirmation()!.querySelectorAll<HTMLButtonElement>('button')].find(
				(button) => button.textContent?.trim() === label
			)!;
		signOutEntry.click();
		check(
			confirmation()?.textContent?.includes('Sign out of Proctor?') === true,
			'Sign out asks for confirmation'
		);
		check(signOuts === 0, 'Nothing signs out before confirming');
		dialogButton('Cancel').click();
		check(confirmation() === null && signOuts === 0, 'Cancel keeps the session');
		signOutEntry.click();
		dialogButton('Sign out').click();
		await eventually(
			() =>
				sidebar.querySelector('.prctr-area-sidebar__feedback')?.textContent ===
				'Sign-out could not be completed.',
			'Sign-out failure is reported'
		);
		check(Number(signOuts) === 1, 'Sign out ran once');

		step('Hiding and showing the docked sidebar is remembered on the device.');
		const hide = sidebar.querySelector<HTMLButtonElement>('.prctr-area-sidebar__hide')!;
		hide.focus();
		hide.click();
		check(sidebar.hidden && presentation() === 'hidden', 'Hide sidebar hides it');
		check(document.activeElement === topButton('showSidebar'), 'Focus moves to Show sidebar');
		check(
			document.defaultView!.localStorage.getItem(LAYOUT_KEYS[0]!) === 'false',
			'Hidden preference is saved'
		);
		await frameLayout();
		close(
			rtl
				? bounds.right - content.getBoundingClientRect().right
				: content.getBoundingClientRect().left - bounds.left,
			76,
			'hidden sidebar releases its column'
		);
		topButton('showSidebar').click();
		check(
			!sidebar.hidden && sidebar.contains(document.activeElement),
			'Show sidebar moves focus into it'
		);
		key(document.activeElement!, 'b', {
			code: 'KeyB',
			keyCode: 66,
			metaKey: isMacintosh,
			ctrlKey: !isMacintosh
		});
		await eventually(() => sidebar.hidden === true, 'Ctrl/Cmd+B hides the sidebar');
		await commands.executeCommand('prctr.authenticated.toggleSidebar');
		check(!sidebar.hidden, 'Toggle command shows the sidebar');

		step('Keyboard resizing stays within bounds and is remembered.');
		const sash = sidebar.querySelector<HTMLElement>('.prctr-sidebar-sash')!;
		check(
			sash.getAttribute('role') === 'separator' && sash.tabIndex === 0,
			'Sash is a focusable separator'
		);
		for (let index = 0; index < 20; index++)
			key(sash, rtl ? 'ArrowLeft' : 'ArrowRight', { shiftKey: true });
		check(sash.getAttribute('aria-valuenow') === '320', 'Sidebar width stops at its maximum');
		await frameLayout();
		close(sidebar.getBoundingClientRect().width, 320, 'resized sidebar width');
		for (let index = 0; index < 20; index++)
			key(sash, rtl ? 'ArrowRight' : 'ArrowLeft', { shiftKey: true });
		check(sash.getAttribute('aria-valuenow') === '200', 'Sidebar width stops at its minimum');
		check(
			document.defaultView!.localStorage.getItem(LAYOUT_KEYS[1]!) === '200',
			'Width is saved'
		);
		key(sash, 'Home');
		check(sash.getAttribute('aria-valuenow') === '232', 'Home restores the default width');

		step(
			'Narrow windows hide the sidebar without overwriting the preference, then overlay it.'
		);
		frame.style.width = '800px';
		await eventually(() => presentation() === 'hidden', 'Narrow window hides the sidebar');
		check(
			document.defaultView!.localStorage.getItem(LAYOUT_KEYS[0]!) === 'true',
			'Responsive hiding keeps the preference'
		);
		topButton('showSidebar').click();
		check(presentation() === 'overlay', 'Narrow sidebar opens as an overlay');
		check(sash.hidden, 'Overlay cannot be resized');
		key(document.activeElement!, 'Escape');
		check(
			presentation() === 'hidden' && document.activeElement === topButton('showSidebar'),
			'Escape closes the overlay and restores focus'
		);
		topButton('showSidebar').click();
		entry('profile')!.click();
		check(
			presentation() === 'hidden' && nav().accountPage === 'profile',
			'Choosing a page closes the overlay'
		);
		frame.style.width = '1180px';
		await eventually(() => presentation() === 'docked', 'Wide window docks the sidebar again');

		step('Areas follow fresh server context.');
		navigation.setProductAreas(['account']);
		check(
			areas().every((button) => button.hidden) && nav().current === 'account',
			'Losing every area leaves Account'
		);
		navigation.setProductStatus({ tone: 'info', title: 'No access assigned' });
		const notice = document.querySelector<HTMLButtonElement>('.prctr-area-rail__notice')!;
		check(
			!notice.hidden &&
				notice.getAttribute('aria-label') === 'No access assigned' &&
				!sidebar.textContent?.includes('No access assigned'),
			'An access fact sits in the rail above the account, not in the sidebar'
		);
		notice.click();
		const note = document.querySelector<HTMLElement>('.prctr-area-rail__note')!;
		check(
			!note.hidden &&
				notice.getAttribute('aria-expanded') === 'true' &&
				note.querySelector<HTMLElement>('.prctr-area-rail__note-retry')!.hidden,
			'Its note opens beside the rail, with nothing to press'
		);
		key(note, 'Escape');
		check(note.hidden && document.activeElement === notice, 'Escape closes the note');
		navigation.setProductStatus(undefined);
		check(notice.hidden, 'The notice leaves with the fact');

		step('Cmd/Ctrl+K focuses search; a modal blocks frame shortcuts.');
		key(document.body, 'k', { code: 'KeyK', metaKey: isMacintosh, ctrlKey: !isMacintosh });
		check(
			document.activeElement?.classList.contains('prctr-content-top-bar__input'),
			'Shortcut focuses search'
		);
		const gate = shell.overlayHost.acquireExternalModal();
		const before = sidebar.hidden;
		await commands.executeCommand('prctr.authenticated.toggleSidebar').catch(() => undefined);
		check(sidebar.hidden === before, 'Layout changes are blocked behind a modal');
		gate.dispose();

		step('The window follows the settings it is shown, and Ctrl/Cmd+, opens Settings.');
		const motion = (): string => themes.presentationPreferences.motion;
		for (const listener of settingsListeners)
			listener(projection({ windowTheme: 'dark', reducedMotion: true }));
		// The first read resolves after a newer change and must not replace it.
		resolveSnapshot(projection({ windowTheme: 'light' }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		check(
			themes.theme.isDark && !themes.theme.isHighContrast,
			'A dark window theme pins the dark theme, and a stale read does not replace it'
		);
		check(motion() === 'reduced', 'Reduced motion applies');
		for (const listener of settingsListeners)
			listener(projection({ windowTheme: 'light', highContrast: true }));
		check(
			!themes.theme.isDark && themes.theme.isHighContrast,
			'High contrast uses the high-contrast theme of the chosen scheme'
		);
		check(motion() === 'full', 'Full motion returns');
		navigation.selectAccountPage('profile');
		key(document.body, ',', {
			code: 'Comma',
			keyCode: 188,
			metaKey: isMacintosh,
			ctrlKey: !isMacintosh
		});
		await eventually(
			() => nav().current === 'account' && nav().accountPage === 'settings',
			'Ctrl/Cmd+, opens Account Settings'
		);
		navigation.selectAccountPage('profile');
		await commands.executeCommand('prctr.authenticated.openSettings');
		check(nav().accountPage === 'settings', 'The Open Settings command opens Account Settings');
	} finally {
		result.disposables.dispose();
	}
}
