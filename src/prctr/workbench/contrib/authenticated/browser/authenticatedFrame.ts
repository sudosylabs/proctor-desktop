/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { alert } from '../../../../base/browser/ui/aria/aria.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import type { LocalizationValue } from '../../../../base/common/localization.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import {
	IProductWindowChromeService,
	IWorkbenchPaneHostService,
	IWorkbenchShellService,
	IWorkbenchWindowService
} from '../../../browser/workbenchServices.js';
import { WorkbenchModalContext } from '../../../common/contextKeys.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { registerProctorAction } from '../../../services/actions/common/proctorActions.js';
import { IAuthenticatedHostService } from '../../../services/authenticatedHost/common/authenticatedHost.js';
import { ILocalizationService } from '../../../services/localization/common/localization.js';
import {
	activityViews,
	AuthenticatedNavigationModel,
	type AccountPage,
	type ActivityView,
	type AuthenticatedDestination,
	type AuthenticatedLocation,
	type AuthenticatedLocationChange
} from '../common/authenticatedNavigationModel.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { AreaRail } from './areaRail.js';
import { AreaSidebar, type SidebarArea, type SidebarSelection } from './areaSidebar.js';
import { authenticatedMessages as m, type AuthenticatedMessage } from './authenticatedMessages.js';
import { AuthenticatedLayoutState } from './authenticatedLayoutState.js';
import { IAuthenticatedHoverService } from './authenticatedHover.js';
import type { IAuthenticatedNavigationService } from './authenticatedNavigation.js';
import { ContentTopBar, type TopBarAction } from './contentTopBar.js';
import { SidebarSash } from './sidebarSash.js';
import { UnavailablePage } from './unavailablePage.js';
import { WindowTitle } from './windowTitle.js';

/** Below this window width the sidebar stops docking and opens over the content instead. */
const DOCKED_SIDEBAR_MIN_WINDOW_WIDTH = 1000;

const activityIcons: Readonly<Record<ActivityView, ProctorIconId>> = Object.freeze({
	overview: 'area.overview',
	upcoming: 'activity.upcoming',
	available: 'activity.available',
	in_progress: 'activity.inProgress',
	submitted: 'activity.submitted',
	results_available: 'activity.results',
	past: 'activity.past'
});

const sidebarAreas: readonly SidebarArea[] = Object.freeze([
	{
		destination: 'activity',
		title: 'activityTitle',
		entries: activityViews.map((view) => ({ id: view, label: view, icon: activityIcons[view] }))
	},
	{
		destination: 'management',
		title: 'managementTitle',
		entries: [{ id: 'overview', label: 'overview', icon: 'area.overview' }]
	},
	{
		destination: 'administration',
		title: 'administrationTitle',
		entries: [{ id: 'overview', label: 'overview', icon: 'area.overview' }]
	},
	{
		destination: 'account',
		title: 'accountTitle',
		entries: [
			{ id: 'profile', label: 'profile', icon: 'account.profile' },
			{ id: 'security', label: 'security', icon: 'account.security' },
			{ id: 'sessions', label: 'sessions', icon: 'account.sessions' },
			{ id: 'tokens', label: 'tokens', icon: 'account.tokens' },
			{ id: 'history', label: 'history', icon: 'account.history' },
			{ id: 'settings', label: 'settings', icon: 'account.settings' }
		]
	}
] satisfies SidebarArea[]);

const destinationTitles: Readonly<Record<AuthenticatedDestination, AuthenticatedMessage>> =
	Object.freeze({
		activity: 'activityTitle',
		management: 'managementTitle',
		administration: 'administrationTitle',
		account: 'accountTitle'
	});

/**
 * AuthenticatedWindow's frame: the area rail, the contextual sidebar and the
 * content top bar, and the navigation and sidebar state they present. Product
 * contributions fill the content area for their own destinations.
 */
export class AuthenticatedFrame extends Disposable implements IAuthenticatedNavigationService {
	declare readonly _serviceBrand: undefined;

	private readonly destinationEmitter = this._register(new Emitter<AuthenticatedDestination>());
	readonly onDidChange: Event<AuthenticatedDestination> = this.destinationEmitter.event;
	private readonly activityViewEmitter = this._register(new Emitter<ActivityView>());
	readonly onDidChangeActivityView: Event<ActivityView> = this.activityViewEmitter.event;
	private readonly accountPageEmitter = this._register(new Emitter<AccountPage>());
	readonly onDidChangeAccountPage: Event<AccountPage> = this.accountPageEmitter.event;
	private readonly sidebarVisibilityEmitter = this._register(new Emitter<boolean>());
	readonly onDidChangeSidebarVisibility: Event<boolean> = this.sidebarVisibilityEmitter.event;

	private readonly productPages: boolean;
	private readonly model: AuthenticatedNavigationModel;
	private readonly preferences: AuthenticatedLayoutState;
	private readonly rail: AreaRail;
	private readonly sidebar: AreaSidebar;
	private readonly sash: SidebarSash;
	private readonly topBar: ContentTopBar;
	private readonly unavailable: UnavailablePage;

	private sidebarPreferred: boolean;
	private sidebarWidth: number;
	private compact = false;
	private overlayOpen = false;
	private shownSidebar: boolean | undefined;
	private signingOut = false;
	private readonly institutionName: string | undefined;

	constructor(
		@IWorkbenchShellService private readonly shell: IWorkbenchShellService,
		@IWorkbenchPaneHostService private readonly paneHost: IWorkbenchPaneHostService,
		@IProductWindowChromeService chrome: IProductWindowChromeService,
		@IWorkbenchWindowService window: IWorkbenchWindowService,
		@ILocalizationService private readonly localization: ILocalizationService,
		@IAuthenticatedHostService private readonly host: IAuthenticatedHostService,
		@IAccountService private readonly accountService: IAccountService,
		@IAuthenticatedHoverService hoverService: IAuthenticatedHoverService
	) {
		super();
		const binding = window.binding;
		if (binding.kind !== 'authenticated') {
			throw new Error('The authenticated frame requires an authenticated window binding');
		}
		this.productPages = host.hasProductPages;
		const hover = (target: HTMLElement, label: string, command?: string): IDisposable =>
			hoverService.setupHover(target, label, command);
		this.institutionName = binding.identity?.institutionName;
		const document = this.shell.element.ownerDocument;
		this.preferences = new AuthenticatedLayoutState(localStorageOf(document));
		this.sidebarPreferred = this.preferences.sidebarVisible;
		this.sidebarWidth = this.preferences.sidebarWidth;
		this.model = this._register(
			new AuthenticatedNavigationModel(
				binding.identity?.availableProductAreas ?? [],
				binding.initialDestination
			)
		);
		const sidebarPart = this.shell.part('sidebar');
		const accountName = binding.identity?.displayName ?? this.text('account');
		this.rail = this._register(
			new AreaRail(this.shell.part('navigation'), this.localization, accountName, hover)
		);
		this.shell.part('navigation').setAttribute('aria-label', this.text('areas'));
		this.sidebar = this._register(
			new AreaSidebar(sidebarPart, this.localization, sidebarAreas, hover)
		);
		this.sash = this._register(new SidebarSash(sidebarPart, this.text('resizeSidebar')));
		const content = this.shell.part('content');
		this.topBar = this._register(
			new ContentTopBar(
				content,
				this.localization,
				sidebarPart.id,
				isMacintosh
					? { label: '⌘K', keys: 'Meta+K' }
					: { label: 'Ctrl K', keys: 'Control+K' },
				hover
			)
		);
		this.unavailable = this._register(new UnavailablePage(content, this.text('waiting')));
		if (chrome.configuration.mode === 'nativeOverlay') {
			this._register(
				new WindowTitle(chrome.element, chrome.actions, this.text('productName'))
			);
		}
		this.registerActions();
		this.registerListeners(document);
		this.observeWidth();
		this.render();
		this.layoutSidebar();
		this._register(this.accountService.onDidChangePhoto((photo) => this.rail.setPhoto(photo)));
		void this.loadPhoto();
	}

	private text(
		key: AuthenticatedMessage,
		values?: Readonly<Record<string, LocalizationValue>>
	): string {
		return this.localization.format(m[key], values);
	}

	// #region AuthenticatedNavigationService

	get current(): AuthenticatedDestination {
		return this.model.location.destination;
	}

	get activityView(): ActivityView {
		return this.model.location.activityView;
	}

	get accountPage(): AccountPage {
		return this.model.location.accountPage;
	}

	select(destination: string): void {
		if (destination === 'settings') {
			this.selectAccountPage('settings');
			return;
		}
		this.model.navigate({ destination: destination as AuthenticatedDestination });
	}

	selectActivityView(view: ActivityView): void {
		if (!activityViews.includes(view) || !this.model.isAvailable('activity')) return;
		this.model.navigate({ destination: 'activity', activityView: view });
	}

	selectAccountPage(page: AccountPage): void {
		this.model.navigate({ destination: 'account', accountPage: page });
	}

	setProductAreas(areas: readonly string[]): void {
		this.model.setAreas(areas);
	}

	setProductStatus(message: string, retry?: () => void): void {
		this.sidebar.setStatus(message, retry);
	}

	setAccountCount(page: AccountPage, count: number | undefined): void {
		const text =
			count === undefined || count <= 0
				? undefined
				: new Intl.NumberFormat(
						this.localization.locale === 'pseudo' ? 'en' : this.localization.locale
					).format(count);
		this.sidebar.setBadge('account', page, text);
	}

	// #endregion

	// #region Sidebar visibility

	get sidebarVisible(): boolean {
		return this.presentation() !== 'hidden';
	}

	setSidebarVisible(visible: boolean): void {
		if (this.compact) this.overlayOpen = visible;
		else {
			this.sidebarPreferred = visible;
			this.preferences.sidebarVisible = visible;
		}
		this.layoutSidebar();
	}

	// #endregion

	private registerActions(): void {
		const modalBlocked = WorkbenchModalContext.toNegated();
		this._register(
			registerProctorAction({
				command: {
					id: 'prctr.authenticated.toggleSidebar',
					title: m.toggleSidebar,
					precondition: modalBlocked
				},
				handler: () => this.toggleSidebar(),
				keybindings: [
					{
						primary: KeyMod.CtrlCmd | KeyCode.KeyB,
						weight: KeybindingWeight.WorkbenchContrib
					}
				],
				commandPalette: true
			})
		);
		this._register(
			registerProctorAction({
				command: {
					id: 'prctr.authenticated.navigateBack',
					title: m.navigateBack,
					precondition: modalBlocked
				},
				handler: () => this.model.back(),
				keybindings: [
					{
						primary: KeyMod.Alt | KeyCode.LeftArrow,
						mac: { primary: KeyMod.CtrlCmd | KeyCode.BracketLeft },
						weight: KeybindingWeight.WorkbenchContrib
					}
				],
				commandPalette: true
			})
		);
		this._register(
			registerProctorAction({
				command: {
					id: 'prctr.authenticated.navigateForward',
					title: m.navigateForward,
					precondition: modalBlocked
				},
				handler: () => this.model.forward(),
				keybindings: [
					{
						primary: KeyMod.Alt | KeyCode.RightArrow,
						mac: { primary: KeyMod.CtrlCmd | KeyCode.BracketRight },
						weight: KeybindingWeight.WorkbenchContrib
					}
				],
				commandPalette: true
			})
		);
		this._register(
			registerProctorAction({
				command: {
					id: 'prctr.authenticated.focusSearch',
					title: m.focusSearch,
					precondition: modalBlocked
				},
				handler: () => this.topBar.focusSearch(),
				commandPalette: true
			})
		);
	}

	private registerListeners(document: Document): void {
		this._register(this.model.onDidChange((change) => this.onLocationChange(change)));
		this._register(this.model.onDidChangeHistory(() => this.renderTopBar()));
		this._register(this.model.onDidChangeAreas(() => this.render()));
		this._register(this.rail.onDidSelect((destination) => this.select(destination)));
		this._register(this.sidebar.onDidSelect((selection) => this.onSidebarSelect(selection)));
		this._register(this.sidebar.onDidRequestHide(() => this.hideSidebar()));
		this._register(this.sidebar.onDidRequestSignOut(() => this.signOut()));
		this._register(this.topBar.onDidRequest((action) => this.onTopBarAction(action)));
		this._register(
			this.sash.onDidResize((width) => {
				this.sidebarWidth = width;
				this.layoutSidebar();
			})
		);
		this._register(
			this.sash.onDidEnd((width) => {
				this.sidebarWidth = width;
				this.preferences.sidebarWidth = width;
				this.layoutSidebar();
			})
		);
		const window = document.defaultView;
		if (window !== null)
			this._register(
				// Window capture runs before the keybinding service, so the shortcut never starts a chord.
				addDisposableListener(
					window,
					'keydown',
					(event) => this.onWindowKeyDown(event),
					true
				)
			);
		this._register(
			addDisposableListener(this.shell.part('sidebar'), 'keydown', (event) => {
				if (event.key !== 'Escape' || !this.overlayOpen) return;
				event.preventDefault();
				this.hideSidebar();
			})
		);
		this._register(
			addDisposableListener(
				document,
				'pointerdown',
				(event) => this.dismissOverlayFrom(event.target),
				true
			)
		);
		this._register(
			addDisposableListener(document, 'focusin', (event) =>
				this.dismissOverlayFrom(event.target)
			)
		);
	}

	private observeWidth(): void {
		const element = this.shell.element;
		const update = (): void => {
			const width = element.clientWidth;
			const compact = width > 0 && width < DOCKED_SIDEBAR_MIN_WINDOW_WIDTH;
			if (compact === this.compact) return;
			this.compact = compact;
			this.overlayOpen = false;
			this.layoutSidebar();
		};
		const observer = new ResizeObserver(update);
		observer.observe(element);
		this._register({ dispose: () => observer.disconnect() });
		update();
	}

	private onLocationChange({ previous, current }: AuthenticatedLocationChange): void {
		this.render();
		if (previous.destination !== current.destination)
			this.destinationEmitter.fire(current.destination);
		else if (
			current.destination === 'activity' &&
			previous.activityView !== current.activityView
		)
			this.activityViewEmitter.fire(current.activityView);
		else if (current.destination === 'account' && previous.accountPage !== current.accountPage)
			this.accountPageEmitter.fire(current.accountPage);
	}

	private onSidebarSelect({ destination, entry }: SidebarSelection): void {
		if (destination === 'activity') this.selectActivityView(entry as ActivityView);
		else if (destination === 'account') this.selectAccountPage(entry as AccountPage);
		else this.select(destination);
		if (this.overlayOpen) {
			this.overlayOpen = false;
			this.layoutSidebar();
			this.shell.focusVisiblePart(['content']);
		}
	}

	private onTopBarAction(action: TopBarAction): void {
		if (action === 'back') this.model.back();
		else if (action === 'forward') this.model.forward();
		else this.showSidebar();
	}

	private onWindowKeyDown(event: KeyboardEvent): void {
		if (event.code !== 'KeyK' || event.altKey || event.shiftKey) return;
		const primary = isMacintosh
			? event.metaKey && !event.ctrlKey
			: event.ctrlKey && !event.metaKey;
		if (!primary || this.shell.overlayHost.visible) return;
		event.preventDefault();
		event.stopPropagation();
		this.topBar.focusSearch();
	}

	/** The overlaid sidebar closes when the person works anywhere else. */
	private dismissOverlayFrom(target: EventTarget | null): void {
		if (!this.overlayOpen || !(target instanceof Node)) return;
		if (this.shell.part('sidebar').contains(target) || this.topBar.isShowSidebar(target))
			return;
		this.overlayOpen = false;
		this.layoutSidebar();
	}

	private toggleSidebar(): void {
		if (this.shell.overlayHost.visible) return;
		if (this.sidebarVisible) this.hideSidebar();
		else this.showSidebar();
	}

	private showSidebar(): void {
		this.setSidebarVisible(true);
		alert(this.text('sidebarShown'));
		this.sidebar.focus();
	}

	private hideSidebar(): void {
		const sidebarPart = this.shell.part('sidebar');
		const hadFocus = sidebarPart.contains(sidebarPart.ownerDocument.activeElement);
		this.setSidebarVisible(false);
		alert(this.text('sidebarHidden'));
		if (hadFocus && !this.topBar.focusShowSidebar()) this.shell.focusVisiblePart(['content']);
	}

	/** Asks first; signing out ends this computer's session and returns to LaunchWindow. */
	signOut(): void {
		if (this.signingOut || this.shell.overlayHost.visible) return;
		this.shell.overlayHost.show({
			kind: 'dialog',
			title: this.text('signOutConfirmTitle'),
			message:
				this.institutionName === undefined
					? this.text('signOutConfirmBodyGeneric')
					: this.text('signOutConfirmBody', { institution: this.institutionName }),
			accessibleLabel: this.text('signOutConfirmTitle'),
			dismissOnEscape: true,
			actions: [
				{
					id: 'cancel',
					label: this.text('cancel'),
					variant: 'secondary',
					icon: proctorIconFactory('action.close'),
					onRequest: () => {}
				},
				{
					id: 'signOut',
					label: this.text('signOut'),
					variant: 'primary',
					icon: proctorIconFactory('action.signOut'),
					onRequest: () => this.signOutNow()
				}
			]
		});
	}

	private signOutNow(): void {
		if (this.signingOut) return;
		this.signingOut = true;
		this.sidebar.setSigningOut(true);
		this.host.signOut().catch(() => {
			if (this._store.isDisposed) return;
			this.signingOut = false;
			this.sidebar.setSigningOut(false, this.text('signOutFailed'));
		});
	}

	private async loadPhoto(): Promise<void> {
		try {
			const photo = await this.accountService.readPhoto();
			if (photo !== undefined && !this._store.isDisposed) this.rail.setPhoto(photo);
		} catch {
			/* Initials remain until a confirmed photo arrives. */
		}
	}

	private presentation(): 'docked' | 'overlay' | 'hidden' {
		if (this.compact) return this.overlayOpen ? 'overlay' : 'hidden';
		return this.sidebarPreferred ? 'docked' : 'hidden';
	}

	private layoutSidebar(): void {
		if (this._store.isDisposed) return;
		const presentation = this.presentation();
		this.shell.setSidebarPresentation(presentation, this.sidebarWidth);
		this.sash.element.hidden = presentation !== 'docked';
		this.sash.setWidth(this.sidebarWidth);
		this.sidebar.setExpanded(presentation !== 'hidden');
		this.renderTopBar();
		const shown = presentation !== 'hidden';
		if (this.shownSidebar !== shown) {
			const initial = this.shownSidebar === undefined;
			this.shownSidebar = shown;
			if (!initial) this.sidebarVisibilityEmitter.fire(shown);
		}
	}

	private render(): void {
		const location = this.model.location;
		this.rail.render(this.model.destinations, location.destination);
		this.sidebar.render(location.destination, entryOf(location));
		this.shell.part('sidebar').dataset.destination = location.destination;
		this.renderTopBar();
		this.renderUnavailable(location.destination);
	}

	private renderTopBar(): void {
		this.topBar.render({
			sidebarShown: this.presentation() !== 'hidden',
			canGoBack: this.model.canGoBack,
			canGoForward: this.model.canGoForward
		});
	}

	/** Without product pages, product areas say so and the content area holds no other page. */
	private renderUnavailable(destination: AuthenticatedDestination): void {
		const unavailable = !this.productPages && destination !== 'account';
		this.unavailable.show(unavailable ? this.text(destinationTitles[destination]) : undefined);
		this.paneHost.element.hidden = unavailable;
		if (unavailable) void this.paneHost.clear().catch(() => undefined);
	}
}

function entryOf(location: AuthenticatedLocation): string {
	if (location.destination === 'activity') return location.activityView;
	if (location.destination === 'account') return location.accountPage;
	return 'overview';
}

function localStorageOf(document: Document): Storage | undefined {
	try {
		return document.defaultView?.localStorage;
	} catch {
		return undefined;
	}
}
