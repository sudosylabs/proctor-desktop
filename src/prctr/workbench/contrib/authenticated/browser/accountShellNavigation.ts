import type { ProductArea } from '../../../../platform/examActivity/common/examActivityProtocol.js';
import { AUTHENTICATED_LAYOUT_SERVICE, type AuthenticatedLayout } from './authenticatedLayout.js';
import {
	PRODUCT_WINDOW_CHROME_SERVICE,
	type ProductWindowChrome
} from '../../../../platform/windows/browser/productWindowChrome.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { Action, Separator } from '../../../../base/common/actions.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { getWorkbenchMenuMotionContextMenuOptions } from '../../../browser/actions/menuMotion.js';
import {
	AUTHENTICATED_WINDOW_CONTROLS_SERVICE,
	type AuthenticatedWindowControls
} from './authenticatedWindowControls.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { defineMessage } from '../../../../base/common/localization.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import type { WorkbenchBootstrapContext } from '../../../browser/bootstrap.js';
import {
	AUTHENTICATED_NAVIGATION_SERVICE,
	activityViews,
	type ActivityView,
	type AuthenticatedNavigationService
} from './authenticatedNavigation.js';
import type { AuthenticatedRendererClient } from './authenticatedContribution.js';
import './accountShellNavigation.css';

export const accountShellMessages = {
	overview: defineMessage({
		id: 'authenticated.nav.overview',
		defaultMessage: 'Overview',
		description: 'Exam overview navigation.'
	}),
	upcoming: defineMessage({
		id: 'authenticated.nav.upcoming',
		defaultMessage: 'Upcoming',
		description: 'Upcoming exams navigation.'
	}),
	available: defineMessage({
		id: 'authenticated.nav.available',
		defaultMessage: 'Ready to join',
		description: 'Available exams navigation, subject to admission checks.'
	}),
	in_progress: defineMessage({
		id: 'authenticated.nav.progress',
		defaultMessage: 'In progress',
		description: 'Unfinished attempts navigation.'
	}),
	submitted: defineMessage({
		id: 'authenticated.nav.submitted',
		defaultMessage: 'Submitted',
		description: 'Submitted exams navigation.'
	}),
	results_available: defineMessage({
		id: 'authenticated.nav.results',
		defaultMessage: 'Results',
		description: 'Released results navigation.'
	}),
	past: defineMessage({
		id: 'authenticated.nav.history',
		defaultMessage: 'History',
		description: 'Past exam activity navigation.'
	}),
	examViews: defineMessage({
		id: 'authenticated.nav.exam.views',
		defaultMessage: 'My exams sections',
		description: 'Expand or collapse exam navigation children.'
	}),
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
	management: defineMessage({
		id: 'authenticated.shell.management',
		defaultMessage: 'Exam management',
		description: 'Authorized exam management destination.'
	}),
	administration: defineMessage({
		id: 'authenticated.shell.administration',
		defaultMessage: 'Administration',
		description: 'Authorized institution management destination.'
	}),
	retry: defineMessage({
		id: 'authenticated.shell.retry',
		defaultMessage: 'Refresh access',
		description: 'Refresh permitted product areas from the server.'
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
	const brand = context.document.createElement('div');
	brand.className = 'prctr-account-shell__brand';
	brand.textContent = binding.identity?.institutionName ?? text('product');
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
	if (!client.examActivity) context.shell.part('content').append(waiting);
	const changes = context.disposables.add(new Emitter<string>());
	const viewChanges = context.disposables.add(new Emitter<ActivityView>());
	let activityView: ActivityView = 'overview';
	let viewsExpanded = true;
	const viewButtons = new Map<ActivityView, HTMLButtonElement>();
	let viewList: HTMLElement | undefined;
	let disclosure: HTMLButtonElement | undefined;
	const updateViews = (): void => {
		for (const [view, button] of viewButtons)
			button.setAttribute(
				'aria-current',
				current === 'activity' && activityView === view ? 'page' : 'false'
			);
		if (viewList) viewList.hidden = !viewsExpanded;
		disclosure?.setAttribute('aria-expanded', String(viewsExpanded));
	};
	const selectActivityView = (view: ActivityView): void => {
		if (!activityViews.includes(view) || !destinationButtons.has('activity')) return;
		activityView = view;
		viewsExpanded = true;
		updateViews();
		if (current !== 'activity') select('activity');
		else viewChanges.fire(view);
	};
	let current = 'account';
	let accountSection: 'profile' | 'sessions' = 'profile';
	const destinationButtons = new Map<string, HTMLButtonElement>();
	const destinationStore = context.disposables.add(new DisposableStore());
	const statusStore = context.disposables.add(new DisposableStore());
	const status = context.document.createElement('div');
	status.className = 'prctr-account-shell__access';
	root.append(status);
	const settingsRequests = context.disposables.add(new Emitter<void>());
	let settingsRequested = false;
	const select = (destination: string): void => {
		if (destination === 'settings') {
			settingsRequested = true;
			settingsRequests.fire();
			return;
		}
		current =
			destination === 'account' || destinationButtons.has(destination)
				? destination
				: (destinationButtons.keys().next().value ?? 'account');
		for (const [key, button] of destinationButtons)
			button.setAttribute(
				'aria-current',
				current === key && (key !== 'activity' || !client.examActivity) ? 'page' : 'false'
			);
		if (current === 'activity') viewsExpanded = true;
		updateViews();
		waiting.hidden = current !== 'activity';
		context.shell.revealContent();
		context
			.getService<AuthenticatedLayout>(AUTHENTICATED_LAYOUT_SERVICE)
			.setDestination(current === 'account' ? `account/${accountSection}` : current);
		changes.fire(current);
	};
	const setProductAreas = (areas: readonly ProductArea[]): void => {
		const focused = context.document.activeElement;
		const focusedView = [...viewButtons].find(([, button]) => button === focused)?.[0];
		const focusedDestination = [...destinationButtons].find(
			([, button]) => button === focused
		)?.[0];
		destinationStore.clear();
		destinations.replaceChildren();
		destinationButtons.clear();
		viewButtons.clear();
		viewList = undefined;
		disclosure = undefined;
		for (const [area, destination, label] of [
			['student_activity', 'activity', 'exams'],
			['exam_management', 'management', 'management'],
			['administration', 'administration', 'administration']
		] as const) {
			if (!areas.includes(area)) continue;
			const button = context.document.createElement('button');
			button.type = 'button';
			button.className = 'prctr-account-shell__destination';
			button.dataset.destination = destination;
			button.append(
				destinationStore.add(
					createSemanticIcon(context.document, {
						id:
							area === 'student_activity'
								? 'product.exams'
								: area === 'exam_management'
									? 'product.management'
									: 'product.administration',
						size: 20
					})
				).element,
				context.document.createTextNode(text(label))
			);
			button.setAttribute(
				'aria-current',
				current === destination && (destination !== 'activity' || !client.examActivity)
					? 'page'
					: 'false'
			);
			const group = context.document.createElement('section');
			group.className = 'prctr-account-shell__group';
			const groupHeader = context.document.createElement('div');
			groupHeader.className = 'prctr-account-shell__group-header';
			groupHeader.append(button);
			group.append(groupHeader);
			destinations.append(group);
			if (destination === 'activity' && client.examActivity) {
				disclosure = context.document.createElement('button');
				disclosure.type = 'button';
				disclosure.className = 'prctr-account-shell__disclosure';
				disclosure.ariaLabel = text('examViews');
				disclosure.append(
					destinationStore.add(
						createSemanticIcon(context.document, {
							id: 'disclosure.expanded',
							size: 12
						})
					).element
				);
				viewList = context.document.createElement('div');
				viewList.className = 'prctr-account-shell__children';
				viewList.id = `${context.shell.element.id}-exam-views`;
				disclosure.setAttribute('aria-controls', viewList.id);
				groupHeader.append(disclosure);
				group.append(viewList);
				destinationStore.add(
					addDisposableListener(disclosure, 'click', () => {
						viewsExpanded = !viewsExpanded;
						updateViews();
						scroll.scanDomNode();
					})
				);
				destinationStore.add(
					context
						.getService<AuthenticatedWindowControls>(
							AUTHENTICATED_WINDOW_CONTROLS_SERVICE
						)
						.hover.setupDelayedHover(disclosure, () => ({ content: text('examViews') }))
				);
				for (const view of activityViews) {
					const child = context.document.createElement('button');
					child.type = 'button';
					child.className = 'prctr-account-shell__child';
					child.textContent = text(view);
					child.dataset.activityView = view;
					viewList.append(child);
					viewButtons.set(view, child);
					destinationStore.add(
						addDisposableListener(child, 'click', () => selectActivityView(view))
					);
				}
			}
			destinationButtons.set(destination, button);
			destinationStore.add(
				addDisposableListener(button, 'click', () => {
					if (destination === 'activity') activityView = 'overview';
					select(destination);
				})
			);
		}
		if (current !== 'account' && !destinationButtons.has(current))
			select(destinationButtons.keys().next().value ?? 'account');
		updateViews();
		if (focusedView)
			(viewButtons.get(focusedView) ?? destinationButtons.values().next().value)?.focus();
		else if (focusedDestination)
			(
				destinationButtons.get(focusedDestination) ??
				destinationButtons.values().next().value
			)?.focus();
		scroll.scanDomNode();
	};
	setProductAreas(binding.identity?.availableProductAreas ?? []);
	const setProductStatus = (message: string, retry?: () => void): void => {
		statusStore.clear();
		status.replaceChildren();
		status.hidden = !message;
		if (!message) return;
		const note = context.document.createElement('p');
		note.textContent = message;
		note.role = 'status';
		status.append(note);
		if (retry) {
			const button = context.document.createElement('button');
			button.type = 'button';
			button.className = 'prctr-account-shell__destination';
			button.textContent = text('retry');
			status.append(button);
			statusStore.add(addDisposableListener(button, 'click', retry));
		}
	};
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
	const layout = context.getService<AuthenticatedLayout>(AUTHENTICATED_LAYOUT_SERVICE);
	const settings = context.document.createElement('button');
	settings.className = 'prctr-account-shell';
	settings.dataset.region = 'settings-trigger';
	settings.type = 'button';
	settings.ariaLabel = text('settings');
	settings.setAttribute('aria-haspopup', 'dialog');
	settings.append(
		context.disposables.add(
			createSemanticIcon(context.document, { id: 'action.settings', size: 16 })
		).element
	);
	const separators = Array.from({ length: 2 }, () => {
		const separator = context.document.createElement('span');
		separator.className = 'prctr-account-shell';
		separator.dataset.region = 'titlebar-separator';
		separator.ariaHidden = 'true';
		return separator;
	});
	chrome.actions.append(separators[0]!, settings, separators[1]!, trigger);
	layout.registerTitlebarHover(settings, 'workbench.action.openSettings');
	layout.registerTitlebarHover(trigger);
	context.disposables.add(
		addDisposableListener(settings, 'click', () => {
			if (!context.shell.overlayHost.visible) select('settings');
		})
	);
	context.disposables.add(
		context.shell.overlayHost.onDidChangeVisibility((visible) => {
			settings.disabled = visible;
		})
	);
	const feedback = context.document.createElement('span');
	feedback.className = 'prctr-account-shell';
	feedback.dataset.region = 'feedback';
	feedback.role = 'status';
	context.shell.part('banner').append(feedback);
	let disposed = false;
	let signingOut = false;
	let menuVisible = false;
	const closeMenu = (): void => {
		if (menuVisible)
			context
				.getService<AuthenticatedWindowControls>(AUTHENTICATED_WINDOW_CONTROLS_SERVICE)
				.contextView.hideContextView(true);
	};
	context.disposables.add(
		context.shell.overlayHost.onDidChangeVisibility((visible) => {
			if (visible) closeMenu();
		})
	);
	context.disposables.add({ dispose: closeMenu });
	const runAccountAction = async (action: string | undefined): Promise<void> => {
		if (disposed || signingOut || context.shell.overlayHost.visible || !action) return;
		if (action === 'profile' || action === 'sessions') {
			accountSection = action;
			select('account');
		} else if (action === 'settings') select('settings');
		else if (action === 'logout') {
			signingOut = true;
			trigger.disabled = true;
			closeMenu();
			try {
				await client.signOut();
			} catch {
				signingOut = false;
				trigger.disabled = false;
				feedback.textContent = text('failed');
				context.shell.setPartVisible('banner', true);
			}
		}
	};
	let nativeMenuVisible = false;
	const openMenu = (keyboard = false): void => {
		if (disposed || signingOut || context.shell.overlayHost.visible) return;
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
					context.shell.setPartVisible('banner', true);
				})
				.finally(() => {
					nativeMenuVisible = false;
					trigger.setAttribute('aria-expanded', 'false');
				});
			return;
		}
		if (menuVisible) {
			closeMenu();
			return;
		}
		const controls = context.getService<AuthenticatedWindowControls>(
			AUTHENTICATED_WINDOW_CONTROLS_SERVICE
		);
		const actions = context.disposables.add(new DisposableStore());
		const action = (id: 'profile' | 'sessions' | 'logout', label: string) =>
			actions.add(
				new Action(`prctr.account.${id}`, label, undefined, true, () =>
					runAccountAction(id)
				)
			);
		controls.hover.hideHover();
		trigger.focus();
		menuVisible = true;
		trigger.setAttribute('aria-expanded', 'true');
		try {
			controls.contextMenu.showContextMenu({
				...getWorkbenchMenuMotionContextMenuOptions(trigger),
				anchorAlignment: AnchorAlignment.RIGHT,
				autoSelectFirstItem: keyboard,
				getActions: () => [
					action('profile', text('profile')),
					action('sessions', text('sessions')),
					new Separator(),
					action('logout', text('signOut'))
				],
				onHide: () => {
					menuVisible = false;
					trigger.setAttribute('aria-expanded', 'false');
					context.disposables.delete(actions);
				}
			});
		} catch (error) {
			menuVisible = false;
			trigger.setAttribute('aria-expanded', 'false');
			context.disposables.delete(actions);
			throw error;
		}
	};
	context.disposables.add(
		addDisposableListener(trigger, 'click', (event) => openMenu(event.detail === 0))
	);
	context.disposables.add(
		addDisposableListener(trigger, 'keydown', (event) => {
			if (event.key === 'ArrowDown' && !menuVisible && !nativeMenuVisible) {
				event.preventDefault();
				openMenu(true);
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
		get activityView() {
			return activityView;
		},
		onDidChangeActivityView: viewChanges.event,
		selectActivityView,
		get current() {
			return current;
		},
		get accountSection() {
			return accountSection;
		},
		accountMenuNavigation: true,
		productPages: !!client.examActivity,
		setProductAreas,
		setProductStatus,
		onDidChange: changes.event,
		select,
		onDidRequestSettings: settingsRequests.event,
		get settingsRequested() {
			return settingsRequested;
		},
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
			settings.remove();
			for (const separator of separators) separator.remove();
			waiting.remove();
			feedback.remove();
		}
	});
	select(
		binding.initialDestination === 'settings'
			? (destinationButtons.keys().next().value ?? 'account')
			: binding.initialDestination
	);
	if (binding.initialDestination === 'settings') select('settings');
}
