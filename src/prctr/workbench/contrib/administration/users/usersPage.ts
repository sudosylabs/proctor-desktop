/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import type { SelectControl } from '../../../../base/browser/ui/select/selectControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	ADMINISTRATION_PAGE_SIZE,
	affiliationKinds,
	type AdministrationIntentOf
} from '../../../../platform/administration/common/administrationProtocol.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { InviteDialog } from '../invitations/inviteDialog.js';
import { PageFilters } from '../../../browser/authenticated/pages/pageFilters.js';
import {
	AdminList,
	type AdminCell,
	type AdminListItem,
	type AdminListQuery
} from '../widgets/adminList.js';
import { readOnce, readPages, readUnitTree, unitLabel } from '../widgets/adminReads.js';
import { BulkUserChanges } from './bulkUserChanges.js';
import { PageMenuButton } from '../../../browser/authenticated/pages/rowMenuButton.js';
import { UserActions, type AdminUser } from './userActions.js';
import { SaveViewDialog } from './saveViewDialog.js';
import { PageTabs } from '../../../browser/authenticated/pages/pageTabs.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import {
	MAX_SAVED_USER_VIEWS,
	type SavedUserFilter
} from '../../../../platform/settings/common/administrationLists.js';
import { IAdministrationListsService } from '../../../services/administration/common/administrationLists.js';
import './media/usersPage.css';

type Status = 'active' | 'disabled' | 'any';
type LastActive = 'any' | 'never' | 'recent' | 'idle';
const DAY = 86_400_000;
type AffiliationKind = (typeof affiliationKinds)[number];

const ANY = 'any';
const EVERYONE = 'everyone';
/** Pictures kept for people already shown. */
const PHOTO_CACHE = 200;
/** Below this width the selection bar keeps only its count, one menu and Clear selection. */
const COMPACT_BAR = 560;
export const AFFILIATION_TEXT: Readonly<Record<AffiliationKind, AdministrationText>> = {
	student: 'affiliationStudent',
	teacher: 'affiliationTeacher',
	staff: 'affiliationStaff',
	external: 'affiliationExternal'
};

/** Everyone with an account, found by name, email or username, ten at a time. */
export class UsersPage extends Disposable implements PageView {
	private readonly list: AdminList<'users'>;
	private readonly filters: PageFilters;
	private readonly unit: SelectControl<string>;
	private readonly status: SelectControl<Status>;
	private readonly role: SelectControl<string>;
	private readonly search: HTMLInputElement;
	private readonly affiliation: SelectControl<AffiliationKind | typeof ANY>;
	private readonly lastActive: SelectControl<LastActive>;
	/** Everyone the filters match is chosen, not only the page shown. */
	private everyoneChosen = false;
	private readonly viewsHost: HTMLElement;
	private readonly tabsHolder: HTMLElement;
	private readonly viewTools: HTMLElement;
	private readonly saveView: ButtonControl;
	private readonly removeView: ButtonControl;
	private readonly viewTabs = this._register(new MutableDisposable<PageTabs<string>>());
	private readonly viewDialog = this._register(new MutableDisposable<SaveViewDialog>());
	/** The tab shown: Everyone, or a saved view by its place. */
	private currentView = EVERYONE;
	/** Each saved view's count, by its name, read once it is shown. */
	private readonly viewCounts = new Map<string, string>();
	private readonly bulk: BulkUserChanges;
	private enableButton: ButtonControl | undefined;
	private disableButton: ButtonControl | undefined;
	private readonly invite = this._register(new MutableDisposable<InviteDialog>());
	private query: AdminListQuery<'users'> = { includeDisabled: true };
	/** Each person's picture, read once: their own or the default the server draws. Bounded. */
	private readonly photos = new Map<string, string>();

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IAdministrationListsService private readonly lists: IAdministrationListsService
	) {
		super();
		const importButton = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: format.text('usersImport'),
				icon: proctorIconFactory('action.upload')
			})
		);
		this._register(
			importButton.onDidRequest(() => navigation.selectAdministrationPage('imports'))
		);
		const inviteButton = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('usersInvite'),
				icon: proctorIconFactory('action.invite')
			})
		);
		this._register(inviteButton.onDidRequest(() => this.openInvite()));

		// Saved views are tabs above the filters, each a set of filters with its own count.
		const $ = createElementFactory(body.ownerDocument);
		this.tabsHolder = $('div.prctr-admin-users-views__tabs');
		this.viewTools = $('div.prctr-admin-users-views__tools');
		this.viewsHost = $('div.prctr-admin-users-views', {}, this.tabsHolder);
		body.append(this.viewsHost);
		this.saveView = this._register(
			new ButtonControl(this.viewTools, {
				variant: 'ghost',
				size: 'small',
				label: format.text('viewsSaveAs'),
				icon: proctorIconFactory('action.saveView', 14)
			})
		);
		this.removeView = this._register(
			new ButtonControl(this.viewTools, {
				variant: 'ghost',
				size: 'small',
				label: format.text('viewsRemove'),
				icon: proctorIconFactory('action.delete', 14)
			})
		);
		this._register(this.saveView.onDidRequest(() => this.openSaveView()));
		this._register(this.removeView.onDidRequest(() => void this.removeCurrentView()));
		this._register(this.lists.onDidChange(() => this.renderViews()));
		this.filters = this._register(new PageFilters(body));
		const filters = this.filters;
		// Save as view and Remove view end the filter row.
		filters.element.append(this.viewTools);
		this.search = filters.addSearch(format.text('usersFind'), (q) => this.setQuery({ q }));
		this.status = filters.addSelect<Status>(
			format.text('usersStatus'),
			'status.success',
			this.statusChoices(false),
			'any',
			(status) =>
				// Only an Institution-wide viewer may ask for disabled accounts alone.
				this.setQuery(
					status === 'disabled'
						? { state: 'disabled', includeDisabled: undefined }
						: { state: undefined, includeDisabled: status === 'any' ? true : undefined }
				)
		);
		this.affiliation = filters.addSelect<AffiliationKind | typeof ANY>(
			format.text('usersAffiliation'),
			'admin.roles',
			[
				{ value: ANY, label: format.text('usersAffiliationAny') },
				...affiliationKinds.map((kind) => ({
					value: kind,
					label: format.text(AFFILIATION_TEXT[kind])
				}))
			],
			ANY,
			(kind) => this.setQuery({ affiliation: kind === ANY ? undefined : [kind] })
		);
		this.unit = filters.addSelect<string>(
			format.text('usersUnit'),
			'area.administration',
			[{ value: ANY, label: format.text('usersUnitAny') }],
			ANY,
			(unit) => this.setQuery({ academicUnitId: unit === ANY ? undefined : unit })
		);
		this.role = filters.addSelect<string>(
			format.text('usersRole'),
			'admin.roles',
			[{ value: ANY, label: format.text('usersRoleAny') }],
			ANY,
			(role) => this.setQuery({ roleIds: role === ANY ? undefined : [role] }),
			true
		);
		this.lastActive = filters.addSelect<LastActive>(
			format.text('usersColumnLastActive'),
			'status.time',
			[
				{ value: 'any', label: format.text('usersLastActiveAny') },
				{ value: 'never', label: format.text('usersLastActiveNever') },
				{ value: 'recent', label: format.text('usersLastActiveRecent') },
				{ value: 'idle', label: format.text('usersLastActiveIdle') }
			],
			'any',
			(choice) => this.setLastActive(choice),
			true
		);
		filters.addMoreFilters(format.text('usersMoreFilters'), this.pane.menu);
		filters.setMoreFiltersAvailable(false);
		const actions = this._register(
			instantiationService.createInstance(
				UserActions,
				() => void this.list.refresh(),
				(id) => this.list.focusRow(id)
			)
		);
		this.bulk = this._register(
			instantiationService.createInstance(BulkUserChanges, () => {
				this.list.clearSelection();
				void this.list.refresh();
			})
		);
		this.createSelectionBar(format);
		this.list = this._register(
			instantiationService.createInstance(AdminList<'users'>, body, 'users', this.query, {
				label: format.text('usersTable'),
				filters: this.filters,
				selectable: true,
				columns: [
					{
						label: format.text('usersColumnPerson'),
						width: '30%',
						sort: { key: 'name', first: 'asc' },
						cell: (user) => {
							const photo = this.photos.get(user.id);
							return {
								kind: 'person',
								name: user.displayName,
								detail: user.email ?? user.username,
								...(photo === undefined ? {} : { photo })
							};
						}
					},
					{
						label: format.text('usersAffiliation'),
						width: '21%',
						cell: (user) => this.affiliationCell(user)
					},
					{
						label: format.text('usersColumnRoles'),
						width: '17%',
						priority: 4,
						cell: (user) => ({ kind: 'text', primary: this.roles(user), quiet: true })
					},
					{
						label: format.text('usersColumnLastActive'),
						width: '13%',
						align: 'end',
						priority: 2,
						sort: { key: 'last_active', first: 'desc', gated: true },
						foldLabel: true,
						cell: (user) => ({
							kind: 'text',
							mono: true,
							quiet: true,
							primary:
								user.lastActivityAt === undefined
									? format.text('usersNeverActive')
									: format.relativeStandalone(user.lastActivityAt)
						})
					},
					{
						label: format.text('usersColumnStatus'),
						width: '104px',
						cell: (user) =>
							user.disabledAt === undefined
								? {
										kind: 'status',
										text: format.text('userActive'),
										tone: 'neutral'
									}
								: {
										kind: 'status',
										text: format.text('userDisabled'),
										tone: 'neutral'
									}
					}
				],
				rowId: (user) => user.id,
				rowName: (user) => user.displayName,
				sorting: {
					initial: { key: 'name', dir: 'asc' },
					params: (sort) => ({
						sort: sort.key as 'name' | 'last_active',
						dir: sort.dir
					})
				},
				open: (user) => navigation.selectAdministrationPage('user', user.id),
				actions: (user) => actions.for(user, true),
				icon: 'admin.users',
				empty: {
					title: format.text('usersEmpty'),
					text: format.text('usersEmptyText'),
					action: {
						label: format.text('usersInvite'),
						icon: 'action.invite',
						run: () => this.openInvite()
					}
				},
				filteredEmpty: format.text('usersNoMatch')
			})
		);
		this._register(this.list.onDidChangeSelection((users) => this.showSelection(users)));
		this._register(this.list.onDidLoad((users) => void this.loadPhotos(users)));
		void this.loadUnits();
		void this.loadReach();
		this._register(this.list.onDidLoad(() => this.updateViewTools()));
		void this.lists.ready.then(() => this.renderViews());
	}

	// #region Saved views

	private renderViews(): void {
		if (this._store.isDisposed) return;
		const views = this.lists.userViews;
		if (this.currentView !== EVERYONE && Number(this.currentView) >= views.length)
			this.currentView = EVERYONE;
		const tabs = new PageTabs<string>(
			this.tabsHolder,
			this.format.text('viewsLabel'),
			[
				{ id: EVERYONE, label: this.format.text('viewsEveryone') },
				...views.map((view, index) => ({ id: String(index), label: view.name }))
			],
			this.currentView
		);
		this.tabsHolder.replaceChildren(tabs.element);
		tabs.onDidChange((id) => this.applyView(id));
		this.viewTabs.value = tabs;
		const total = this.list.totalCount;
		if (total !== undefined)
			tabs.setCount(EVERYONE, this.format.count(total.count) + (total.atLeast ? '+' : ''));
		views.forEach((view, index) => {
			const known = this.viewCounts.get(view.name);
			if (known !== undefined) tabs.setCount(String(index), known);
			else void this.countView(view.filter, view.name, String(index));
		});
		this.updateViewTools();
	}

	private async countView(filter: SavedUserFilter, name: string, id: string): Promise<void> {
		const read = await readOnce(this.administration, {
			...this.queryFor(filter),
			kind: 'users',
			limit: ADMINISTRATION_PAGE_SIZE
		} as Parameters<typeof readOnce<'users'>>[1]);
		if (this._store.isDisposed || read.kind !== 'data' || read.value.total === undefined)
			return;
		const text =
			this.format.count(read.value.total) + (read.value.totalAtLeast === true ? '+' : '');
		this.viewCounts.set(name, text);
		this.viewTabs.value?.setCount(id, text);
	}

	/** Save as view while filters are set; Remove view on a saved view's own tab. */
	private updateViewTools(): void {
		const views = this.lists.userViews;
		const filtered = Object.keys(this.savedFilter()).length > 0;
		const onView = this.currentView !== EVERYONE;
		// Save as view stays on Everyone, as the boards draw it; saving needs a filter set.
		this.saveView.element.hidden = onView || views.length >= MAX_SAVED_USER_VIEWS;
		this.saveView.setState({
			label: this.format.text('viewsSaveAs'),
			icon: proctorIconFactory('action.saveView', 14),
			disabled: !filtered
		});
		this.removeView.element.hidden = !onView;
		if (this.currentView === EVERYONE) {
			const total = this.list.totalCount;
			if (total !== undefined)
				this.viewTabs.value?.setCount(
					EVERYONE,
					this.format.count(total.count) + (total.atLeast ? '+' : '')
				);
		}
	}

	/** The Users filters now set, as a saved view keeps them. */
	private savedFilter(): SavedUserFilter {
		const q = this.search.value.trim();
		const status = this.status.value;
		return {
			...(q === '' ? {} : { q }),
			...(this.affiliation.value === ANY ? {} : { affiliation: [this.affiliation.value] }),
			...(this.unit.value === ANY ? {} : { academicUnitId: this.unit.value }),
			...(this.role.value === ANY ? {} : { roleIds: [this.role.value] }),
			...(status === 'any' ? {} : { status }),
			...(this.lastActive.value === 'any' ? {} : { lastActive: this.lastActive.value })
		};
	}

	private queryFor(filter: SavedUserFilter): AdminListQuery<'users'> {
		const now = this.format.now();
		return {
			...(filter.q === undefined ? {} : { q: filter.q }),
			...(filter.affiliation === undefined ? {} : { affiliation: filter.affiliation }),
			...(filter.academicUnitId === undefined
				? {}
				: { academicUnitId: filter.academicUnitId }),
			...(filter.roleIds === undefined ? {} : { roleIds: filter.roleIds }),
			// Everyone, whatever their status, unless the view narrows it.
			...(filter.status === 'disabled'
				? { state: 'disabled' as const }
				: filter.status === 'active'
					? {}
					: { includeDisabled: true }),
			...(filter.lastActive === 'never' ? { neverSignedIn: true } : {}),
			...(filter.lastActive === 'recent' ? { lastActiveAfter: now - 30 * DAY } : {}),
			...(filter.lastActive === 'idle' ? { lastActiveBefore: now - 90 * DAY } : {})
		};
	}

	/** Shows a tab: its filters fill the bar and the list reads from its first page. */
	private applyView(id: string): void {
		this.currentView = id;
		const filter = id === EVERYONE ? {} : (this.lists.userViews[Number(id)]?.filter ?? {});
		this.search.value = filter.q ?? '';
		this.status.setValue(filter.status ?? 'any');
		this.affiliation.setValue(filter.affiliation?.[0] ?? ANY);
		this.unit.setValue(filter.academicUnitId ?? ANY);
		this.role.setValue(filter.roleIds?.[0] ?? ANY);
		this.lastActive.setValue(filter.lastActive ?? 'any');
		this.query = this.queryFor(filter);
		this.list.setQuery(this.query);
		this.updateViewTools();
	}

	private openSaveView(): void {
		const filter = this.savedFilter();
		this.viewDialog.value = this.instantiationService.createInstance(
			SaveViewDialog,
			this.filterWords(),
			async (name) => {
				const views = [...this.lists.userViews, { name, filter }];
				const saved = await this.lists.setUserViews(views);
				if (saved && !this._store.isDisposed) {
					this.currentView = String(views.length - 1);
					this.renderViews();
				}
				return saved;
			}
		);
	}

	private async removeCurrentView(): Promise<void> {
		if (this.currentView === EVERYONE) return;
		const index = Number(this.currentView);
		const views = this.lists.userViews.filter((_, place) => place !== index);
		const removed = await this.lists.setUserViews(views);
		if (this._store.isDisposed) return;
		if (!removed) {
			this.pane.toast(this.format.text('viewsNotSaved'));
			return;
		}
		this.applyView(EVERYONE);
		this.renderViews();
	}

	// #endregion

	private statusChoices(wide: boolean) {
		return [
			{ value: 'active' as const, label: this.format.text('usersStatusActive') },
			...(wide
				? [{ value: 'disabled' as const, label: this.format.text('usersStatusDisabled') }]
				: []),
			{ value: 'any' as const, label: this.format.text('usersStatusAny') }
		];
	}

	/**
	 * Some filters and the Last active order are for viewers who see the whole Institution; the
	 * server refuses them to a scoped administrator, so they are offered only once it accepts one.
	 */
	private async loadReach(): Promise<void> {
		const probe = await readOnce(this.administration, {
			kind: 'users',
			limit: ADMINISTRATION_PAGE_SIZE,
			neverSignedIn: true
		});
		if (this._store.isDisposed || probe.kind !== 'data') return;
		this.status.setChoices(this.statusChoices(true), this.status.value);
		this.filters.setMoreFiltersAvailable(true);
		this.list.enableSort('last_active');
		const roles = await readPages(this.administration, 'roles', {});
		if (this._store.isDisposed || roles.kind !== 'data') return;
		this.role.setChoices(
			[
				{ value: ANY, label: this.format.text('usersRoleAny') },
				...roles.value.items.map((role) => ({ value: role.id, label: role.displayName }))
			],
			this.role.value
		);
	}

	private setLastActive(choice: LastActive): void {
		const now = this.format.now();
		this.setQuery({
			neverSignedIn: choice === 'never' ? true : undefined,
			lastActiveAfter: choice === 'recent' ? now - 30 * DAY : undefined,
			lastActiveBefore: choice === 'idle' ? now - 90 * DAY : undefined
		});
	}

	private createSelectionBar(format: IAdministrationFormatService): void {
		const host = this.filters.selectionActions;
		const button = (
			label: string,
			icon: ProctorIconId,
			run: (users: readonly AdminUser[]) => void,
			variant: 'secondary' | 'dangerGhost' = 'secondary',
			everyone?: 'enrol' | 'grant' | 'signOut' | 'disable' | 'enable'
		): ButtonControl => {
			const control = this._register(
				new ButtonControl(host, {
					variant,
					size: 'small',
					label,
					icon: proctorIconFactory(icon, 14)
				})
			);
			this._register(
				control.onDidRequest(() =>
					this.everyoneChosen && everyone !== undefined
						? this.changeEveryone(everyone)
						: run(this.list.selection)
				)
			);
			return control;
		};
		button(
			format.text('usersBulkEnrol'),
			'object.student',
			(users) => this.bulk.enrol(users),
			'secondary',
			'enrol'
		);
		button(
			format.text('usersBulkGrant'),
			'admin.roles',
			(users) => this.bulk.grant(users),
			'secondary',
			'grant'
		);
		// The less used changes give way to ⋯ when the bar is narrow, so it never wraps.
		const signOut = (users: readonly AdminUser[]): void => this.bulk.signOut(users);
		const enable = (users: readonly AdminUser[]): void =>
			this.bulk.enable(users.filter((user) => user.disabledAt !== undefined));
		const disable = (users: readonly AdminUser[]): void =>
			this.bulk.disable(users.filter((user) => user.disabledAt === undefined));
		button(
			format.text('usersBulkSignOut'),
			'action.signOut',
			signOut,
			'secondary',
			'signOut'
		).element.dataset.secondary = 'true';
		this.enableButton = button(
			format.text('usersBulkEnable'),
			'action.enable',
			enable,
			'secondary',
			'enable'
		);
		this.enableButton.element.dataset.secondary = 'true';
		this.disableButton = button(
			format.text('usersBulkDisable'),
			'action.end',
			disable,
			'dangerGhost',
			'disable'
		);
		this.disableButton.element.dataset.secondary = 'true';
		const more = this._register(
			new PageMenuButton(
				host,
				format.text('usersBulkMore'),
				() => {
					const users = this.list.selection;
					// Very narrow, as at 200% zoom, every change is in this menu.
					const compact = this.filters.element.clientWidth < COMPACT_BAR;
					return [
						...(compact
							? [
									{
										label: format.text('usersBulkEnrol'),
										icon: 'object.student' as const,
										run: () => this.bulk.enrol(users)
									},
									{
										label: format.text('usersBulkGrant'),
										icon: 'admin.roles' as const,
										run: () => this.bulk.grant(users)
									}
								]
							: []),
						{
							label: format.text('usersBulkSignOut'),
							icon: 'action.signOut' as const,
							run: () => signOut(users)
						},
						...(users.some((user) => user.disabledAt !== undefined)
							? [
									{
										label: format.text('usersBulkEnable'),
										icon: 'action.enable' as const,
										run: () => enable(users)
									}
								]
							: []),
						...(users.some((user) => user.disabledAt === undefined)
							? [
									{
										label: format.text('usersBulkDisable'),
										icon: 'action.end' as const,
										destructive: true,
										run: () => disable(users)
									}
								]
							: [])
					];
				},
				this.pane
			)
		);
		more.element.dataset.overflow = 'true';
		const clear = this._register(
			new ButtonControl(host, {
				variant: 'ghost',
				size: 'small',
				label: format.text('usersBulkClear'),
				icon: proctorIconFactory('action.close', 14)
			})
		);
		// The bar leaves with the selection, so focus goes to the checkbox that chooses a page.
		clear.element.dataset.keep = 'true';
		this._register(
			clear.onDidRequest(() => {
				this.list.clearSelection();
				this.list.focusPageAll();
			})
		);
	}

	private showSelection(users: readonly AdminUser[]): void {
		if (users.length === 0) {
			this.everyoneChosen = false;
			this.filters.setSelection(undefined);
			this.filters.setSelectionLink(undefined);
			return;
		}
		const total = this.list.totalCount;
		if (this.everyoneChosen && total !== undefined) {
			// Every change applies to everyone matching; the server checks each person first.
			const all = this.format.count(total.count) + (total.atLeast ? '+' : '');
			this.filters.setSelection(
				this.format.text('usersAllMatching', { count: all }),
				this.format.text('usersAllMatching', { count: all })
			);
			this.filters.setSelectionLink(undefined);
			this.enableButton!.element.hidden = false;
			this.disableButton!.element.hidden = false;
			return;
		}
		// A whole page chosen from a longer list offers everyone the filters match.
		const wholePage = users.length === this.list.rows.length;
		this.filters.setSelectionLink(
			wholePage && total !== undefined && total.count > users.length
				? this.format.text('usersSelectAllMatching', {
						count: this.format.count(total.count) + (total.atLeast ? '+' : '')
					})
				: undefined,
			() => {
				this.everyoneChosen = true;
				this.showSelection(this.list.selection);
			}
		);
		this.filters.setSelection(
			this.format.counted('usersSelected', users.length),
			this.format.counted('usersSelectionLabel', users.length)
		);
		this.enableButton!.element.hidden = !users.some((user) => user.disabledAt !== undefined);
		this.disableButton!.element.hidden = !users.some((user) => user.disabledAt === undefined);
	}

	/** Everyone the filters match, as the server's directory filter. */
	private directoryFilter(): AdministrationIntentOf<'createAcademicPreview'>['filter'] {
		const query = this.query;
		return {
			...(query.q === undefined ? {} : { q: query.q }),
			...(query.affiliation === undefined ? {} : { affiliation: query.affiliation }),
			...(query.academicUnitId === undefined ? {} : { academicUnitId: query.academicUnitId }),
			...(query.roleIds === undefined ? {} : { roleIds: query.roleIds }),
			// The list shows active accounts unless it was asked for every status.
			...(query.state !== undefined
				? { state: query.state }
				: query.includeDisabled === true
					? {}
					: { state: 'active' as const }),
			...(query.neverSignedIn === undefined ? {} : { neverSignedIn: query.neverSignedIn }),
			...(query.lastActiveAfter === undefined
				? {}
				: { lastActiveAfter: query.lastActiveAfter }),
			...(query.lastActiveBefore === undefined
				? {}
				: { lastActiveBefore: query.lastActiveBefore })
		};
	}

	/** The filters in words, as the check of a change for everyone shows them. */
	private filterWords(): string {
		const chosen = <T extends string>(select: SelectControl<T>, none: T | ''): string[] =>
			select.value === none || select.element.closest('[hidden]') !== null
				? []
				: [select.select.options[select.select.selectedIndex]?.textContent ?? ''];
		const words = [
			...(this.search.value.trim() === '' ? [] : [`“${this.search.value.trim()}”`]),
			...chosen(this.status, ''),
			...chosen(this.affiliation, ANY),
			...chosen(this.unit, ANY),
			...chosen(this.role, ANY),
			...chosen(this.lastActive, 'any')
		].filter((word) => word !== '');
		return words.length === 0 ? this.format.text('usersEveryone') : words.join(' · ');
	}

	private changeEveryone(kind: 'enrol' | 'grant' | 'signOut' | 'disable' | 'enable'): void {
		const total = this.list.totalCount;
		if (total === undefined) return;
		this.bulk.everyone(kind, this.directoryFilter(), total.count, this.filterWords());
	}

	private affiliationCell(user: AdminListItem<'users'>): AdminCell {
		const summary = user.summary;
		if (summary === undefined || summary.affiliations.length === 0)
			return { kind: 'text', primary: this.format.text('usersNoAffiliation'), quiet: true };
		const kinds = this.more(
			summary.affiliations.map((affiliation) =>
				this.format.text(AFFILIATION_TEXT[affiliation.kind])
			),
			summary.affiliationsMore
		);
		const units = summary.affiliations.flatMap((affiliation) =>
			affiliation.units.map((unit) => unit.name)
		);
		const unitsMore = summary.affiliations.reduce(
			(sum, affiliation) => sum + affiliation.unitsMore,
			0
		);
		const unique = [...new Set(units)];
		return {
			kind: 'text',
			primary: kinds,
			secondary: unique.length === 0 ? '' : this.more(unique, unitsMore)
		};
	}

	private roles(user: AdminListItem<'users'>): string {
		const roles = user.summary?.roles;
		if (roles === undefined || roles.length === 0) return this.format.text('usersNoRole');
		return this.more(
			[...new Set(roles.map((role) => role.displayName))],
			user.summary?.rolesMore ?? 0
		);
	}

	private more(items: readonly string[], more: number): string {
		const list = items.join(', ');
		return more > 0 ? this.format.text('usersMore', { list, count: more }) : list;
	}

	private async loadPhotos(users: readonly AdminListItem<'users'>[]): Promise<void> {
		const missing = users.filter((user) => !this.photos.has(user.id));
		if (missing.length === 0) return;
		const photos = await Promise.all(
			missing.map((user) =>
				readOnce(this.administration, { kind: 'userPhoto', userId: user.id })
			)
		);
		if (this._store.isDisposed) return;
		let changed = false;
		missing.forEach((user, index) => {
			const photo = photos[index]!;
			if (photo.kind !== 'data') return;
			this.photos.set(user.id, photo.value.dataUrl);
			changed = true;
		});
		// Keep the pictures of the last few pages only; each is a decoded image.
		for (const id of this.photos.keys()) {
			if (this.photos.size <= PHOTO_CACHE) break;
			this.photos.delete(id);
		}
		if (changed) this.list.redraw();
	}

	private async loadUnits(): Promise<void> {
		const units = await readUnitTree(this.administration);
		if (this._store.isDisposed || units.kind === 'failure') return;
		this.unit.setChoices(
			[
				{ value: ANY, label: this.format.text('usersUnitAny') },
				...units.value.map((unit) => ({ value: unit.id, label: unitLabel(unit) }))
			],
			this.query.academicUnitId ?? ANY
		);
	}

	private setQuery(change: Partial<AdminListQuery<'users'>>): void {
		const next: Record<string, unknown> = { ...this.query, ...change };
		for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
		this.query = next as AdminListQuery<'users'>;
		this.list.setQuery(this.query);
	}

	private openInvite(): void {
		this.invite.value = this.instantiationService.createInstance(InviteDialog);
	}

	setVisible(visible: boolean): void {
		this.list.setActive(visible);
	}
}
