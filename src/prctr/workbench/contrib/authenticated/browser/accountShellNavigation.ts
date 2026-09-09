import { AuthenticatedLayoutState } from './authenticatedLayoutState.js';
import { registerProctorAction } from '../../../services/actions/common/proctorActions.js';
import {
	PRODUCT_WINDOW_CHROME_SERVICE,
	type ProductWindowChrome
} from '../../../../platform/windows/browser/productWindowChrome.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { MenuControl } from '../../../../base/browser/ui/menu/menu.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { defineMessage } from '../../../../base/common/localization.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import type { WorkbenchBootstrapContext } from '../../../browser/bootstrap.js';
import {
	AUTHENTICATED_NAVIGATION_SERVICE,
	type AuthenticatedNavigationService
} from './authenticatedNavigation.js';
import type { AuthenticatedRendererClient } from './authenticatedContribution.js';
import './accountShellNavigation.css';

export const accountShellMessages = {
	toggleSidebar: defineMessage({
		id: 'authenticated.shell.toggle.sidebar',
		defaultMessage: 'Toggle sidebar visibility',
		description: 'Show or hide product navigation.'
	}),
	showSidebar: defineMessage({
		id: 'authenticated.shell.show.sidebar',
		defaultMessage: 'Show sidebar',
		description: 'Reveal product navigation.'
	}),
	hideSidebar: defineMessage({
		id: 'authenticated.shell.hide.sidebar',
		defaultMessage: 'Hide sidebar',
		description: 'Hide product navigation.'
	}),
	profile: defineMessage({
		id: 'authenticated.shell.profile',
		defaultMessage: 'Profile',
		description: 'Own profile destination.'
	}),
	sessions: defineMessage({
		id: 'authenticated.shell.sessions',
		defaultMessage: 'Sessions',
		description: 'Sessions and registered desktops destination.'
	}),
	product: defineMessage({
		id: 'authenticated.shell.product',
		defaultMessage: 'Proctor',
		description: 'Product name in authenticated navigation.'
	}),
	account: defineMessage({
		id: 'authenticated.shell.account',
		defaultMessage: 'Account',
		description: 'Account navigation group.'
	}),
	settings: defineMessage({
		id: 'authenticated.shell.settings',
		defaultMessage: 'Settings',
		description: 'User settings destination.'
	}),
	exams: defineMessage({
		id: 'authenticated.shell.exams',
		defaultMessage: 'My exams',
		description: 'Student examination destination.'
	}),
	signOut: defineMessage({
		id: 'authenticated.shell.sign.out',
		defaultMessage: 'Log out',
		description: 'End the current desktop session.'
	}),
	failed: defineMessage({
		id: 'authenticated.shell.sign.out.failed',
		defaultMessage: 'Sign-out could not be completed.',
		description: 'Account menu failure.'
	}),
	title: defineMessage({
		id: 'authenticated.shell.title',
		defaultMessage: 'Proctor',
		description: 'Authenticated window title.'
	}),
	waiting: defineMessage({
		id: 'authenticated.shell.waiting',
		defaultMessage: 'Exam activity is not available yet.',
		description: 'Unavailable examination destination.'
	})
};
export function activateAccountShellNavigation(
	context: WorkbenchBootstrapContext,
	client: AuthenticatedRendererClient,
	binding: AuthenticatedWindowDescriptor
): void {
	const text = (key: keyof typeof accountShellMessages) =>
		context.localization.format(accountShellMessages[key]);
	context.shell.setNavigationLayout('sidebar', true);
	context.shell.setPartVisible('sidebar', false);
	const root = context.document.createElement('div');
	root.className = 'prctr-account-shell';
	root.dataset.region = 'navigation';
	context.shell.part('navigation').append(root);
	const brand = context.document.createElement('h1');
	brand.textContent = text('product');
	root.append(brand);
	const destinations = context.document.createElement('div');
	destinations.className = 'prctr-account-shell__destinations';
	const scroll = context.disposables.add(
		new DomScrollableElement(destinations, {
			className: 'prctr-account-shell__scroll',
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
			verticalScrollbarSize: 8,
			useShadows: false
		})
	);
	root.append(scroll.getDomNode());
	const observer = new ResizeObserver(() => scroll.scanDomNode());
	observer.observe(destinations);
	context.disposables.add({ dispose: () => observer.disconnect() });
	const title = context.document.createElement('span');
	title.className = 'prctr-account-shell';
	title.dataset.region = 'title';
	title.textContent = text('title');
	context.shell.part('titlebar').append(title);
	const waiting = context.document.createElement('section');
	waiting.className = 'prctr-account-shell';
	waiting.dataset.region = 'waiting';
	const heading = context.document.createElement('h1');
	heading.textContent = text('exams');
	const description = context.document.createElement('p');
	description.textContent = text('waiting');
	waiting.append(heading, description);
	context.shell.part('content').append(waiting);
	const changes = context.disposables.add(new Emitter<string>());
	let current = 'account';
	let accountSection: 'profile' | 'sessions' = 'profile';
	let exams: HTMLButtonElement | undefined;
	const select = (destination: string): void => {
		current =
			destination === 'settings' || (destination === 'activity' && exams)
				? destination
				: 'account';
		exams?.setAttribute('aria-current', current === 'activity' ? 'page' : 'false');
		waiting.hidden = current !== 'activity';
		context.shell.revealContent();
		changes.fire(current);
	};
	if (binding.identity?.availableProductAreas.includes('student_activity')) {
		exams = context.document.createElement('button');
		exams.type = 'button';
		exams.className = 'prctr-account-shell__destination';
		exams.append(
			context.disposables.add(
				createSemanticIcon(context.document, { id: 'workspace.file', size: 16 })
			).element,
			context.document.createTextNode(text('exams'))
		);
		destinations.append(exams);
		context.disposables.add(addDisposableListener(exams, 'click', () => select('activity')));
	}
	const trigger = context.document.createElement('button');
	trigger.className = 'prctr-account-shell';
	trigger.dataset.region = 'trigger';
	trigger.type = 'button';

	trigger.setAttribute('aria-haspopup', 'menu');
	trigger.setAttribute('aria-expanded', 'false');
	const avatar = context.document.createElement('span');
	avatar.className = 'prctr-account-shell__avatar';
	avatar.ariaHidden = 'true';
	const name = binding.identity?.displayName ?? text('account');
	avatar.textContent = name
		.split(/\s+/u)
		.slice(0, 2)
		.map((p) => [...p][0] ?? '')
		.join('')
		.toUpperCase();
	const userName = context.document.createElement('span');
	userName.className = 'prctr-account-shell__name';
	userName.textContent = name;
	trigger.ariaLabel = name + ', ' + text('account');
	trigger.append(avatar, userName);
	const chrome = context.getService<ProductWindowChrome>(PRODUCT_WINDOW_CHROME_SERVICE);
	const sidebarToggle = context.document.createElement('button');
	sidebarToggle.className = 'prctr-account-shell';
	sidebarToggle.dataset.region = 'sidebar-toggle';
	sidebarToggle.type = 'button';
	sidebarToggle.setAttribute('aria-controls', context.shell.part('navigation').id);
	const sidebarIcon = context.disposables.add(
		createSemanticIcon(context.document, { id: 'workbench.sidebarLeft', size: 16 })
	);
	sidebarToggle.append(sidebarIcon.element);
	chrome.actions.append(sidebarToggle, trigger);
	let storage: Storage | undefined;
	try {
		storage = context.document.defaultView?.localStorage;
	} catch {
		/* Ephemeral renderer. */
	}
	const layoutState = new AuthenticatedLayoutState(storage);
	if (!layoutState.sidebarVisible) context.shell.setNavigationVisible(false);
	const updateSidebarToggle = (): void => {
		const visible = context.shell.navigationVisible;
		const rtl =
			context.document.defaultView?.getComputedStyle(context.shell.element).direction ===
			'rtl';
		sidebarIcon.setState({
			id: rtl
				? visible
					? 'workbench.sidebarRight'
					: 'workbench.sidebarRightHidden'
				: visible
					? 'workbench.sidebarLeft'
					: 'workbench.sidebarLeftHidden',
			size: 16
		});
		sidebarToggle.setAttribute('aria-expanded', String(visible));
		sidebarToggle.ariaLabel = text(visible ? 'hideSidebar' : 'showSidebar');
		sidebarToggle.title = sidebarToggle.ariaLabel;
	};
	context.disposables.add(context.shell.onDidChangeNavigationVisibility(updateSidebarToggle));
	const directionObserver = new MutationObserver(updateSidebarToggle);
	directionObserver.observe(context.document.documentElement, {
		attributes: true,
		attributeFilter: ['dir']
	});
	directionObserver.observe(context.shell.element, {
		attributes: true,
		attributeFilter: ['dir']
	});
	context.disposables.add({ dispose: () => directionObserver.disconnect() });
	const toggleSidebar = (): void => {
		if (context.shell.overlayHost.visible) return;
		const visible = !context.shell.navigationVisible;
		context.shell.setNavigationVisible(visible);
		layoutState.sidebarVisible = visible;
	};
	context.disposables.add(
		registerProctorAction({
			command: {
				id: 'prctr.authenticated.toggleSidebar',
				title: accountShellMessages.toggleSidebar
			},
			handler: toggleSidebar
		})
	);
	context.disposables.add(addDisposableListener(sidebarToggle, 'click', toggleSidebar));
	updateSidebarToggle();
	const feedback = context.document.createElement('span');
	feedback.className = 'prctr-account-shell';
	feedback.dataset.region = 'feedback';
	feedback.role = 'status';
	context.shell.part('status').append(feedback);
	let disposed = false;
	let signingOut = false;
	const interaction = context.disposables.add(new Emitter<void>());
	context.disposables.add(
		context.shell.overlayHost.onDidChangeVisibility(() => interaction.fire())
	);
	const menu = context.disposables.add(
		new MenuControl(context.shell.overlayHost.notificationLayer, {
			canInteract: () => !disposed && !signingOut && !context.shell.overlayHost.visible,
			onDidChangeInteraction: interaction.event,
			restoreFocus: () => trigger.focus(),
			onActionError: () => {
				feedback.textContent = text('failed');
			}
		})
	);
	context.disposables.add(
		menu.onDidChangeVisibility((visible) =>
			trigger.setAttribute('aria-expanded', String(visible))
		)
	);
	const runAccountAction = async (action: string | undefined): Promise<void> => {
		if (disposed || !action) return;
		if (action === 'profile' || action === 'sessions') {
			accountSection = action;
			select('account');
		} else if (action === 'settings') select('settings');
		else if (action === 'logout') {
			signingOut = true;
			trigger.disabled = true;
			interaction.fire();
			try {
				await client.signOut();
			} catch {
				signingOut = false;
				trigger.disabled = false;
				feedback.textContent = text('failed');
			}
		}
	};
	let nativeMenuVisible = false;
	const openMenu = (): void => {
		if (client.accountMenu) {
			if (nativeMenuVisible || disposed || signingOut || context.shell.overlayHost.visible)
				return;
			nativeMenuVisible = true;
			trigger.setAttribute('aria-expanded', 'true');
			const rect = trigger.getBoundingClientRect();
			void client.accountMenu
				.show({ x: Math.max(0, rect.left), y: Math.max(0, rect.bottom + 4) })
				.then(async (action) => {
					if (disposed) return;
					trigger.focus();
					if (!context.shell.overlayHost.visible) await runAccountAction(action);
				})
				.catch(() => {
					if (!disposed) feedback.textContent = text('failed');
				})
				.finally(() => {
					nativeMenuVisible = false;
					trigger.setAttribute('aria-expanded', 'false');
				});
			return;
		}
		if (menu.visible) {
			menu.hide();
			return;
		}
		menu.show(
			trigger,
			[
				{ label: text('profile'), run: () => runAccountAction('profile') },
				{ label: text('sessions'), run: () => runAccountAction('sessions') },
				{ label: text('settings'), run: () => runAccountAction('settings') },
				{
					label: text('signOut'),
					separatorBefore: true,
					run: () => runAccountAction('logout')
				}
			],
			text('account')
		);
	};
	context.disposables.add(addDisposableListener(trigger, 'click', openMenu));
	context.disposables.add(
		addDisposableListener(trigger, 'keydown', (event) => {
			if (event.key === 'ArrowDown' && !menu.visible) {
				event.preventDefault();
				openMenu();
			}
		})
	);
	const setProfilePhoto = (dataUrl: string): void => {
		if (disposed || !/^data:image\/webp;base64,/u.test(dataUrl)) return;
		const image = context.document.createElement('img');
		image.alt = '';
		image.src = dataUrl;
		avatar.replaceChildren(image);
	};
	const navigation: AuthenticatedNavigationService = {
		get current() {
			return current;
		},
		get accountSection() {
			return accountSection;
		},
		accountMenuNavigation: true,
		onDidChange: changes.event,
		select,
		setProfilePhoto
	};
	context.setService(AUTHENTICATED_NAVIGATION_SERVICE, navigation);
	void client.account
		?.request({ kind: 'readPhoto' })
		.then((result) => {
			if (result.kind === 'photo') setProfilePhoto(result.dataUrl);
		})
		.catch(() => {});
	context.disposables.add({
		dispose() {
			disposed = true;
			root.remove();
			title.remove();
			trigger.remove();
			sidebarToggle.remove();
			waiting.remove();
			feedback.remove();
		}
	});
	select(binding.initialDestination);
}
