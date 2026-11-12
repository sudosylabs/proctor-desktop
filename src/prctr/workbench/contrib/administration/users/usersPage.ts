/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import type { SelectControl } from '../../../../base/browser/ui/select/selectControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { affiliationKinds } from '../../../../platform/administration/common/administrationProtocol.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { InviteDialog } from '../invitations/inviteDialog.js';
import { AdminFilters } from '../widgets/adminFilters.js';
import {
	AdminList,
	type AdminCell,
	type AdminListItem,
	type AdminListQuery
} from '../widgets/adminList.js';
import { readOnce, readPages, readUnitTree, unitLabel } from '../widgets/adminReads.js';
import { ADMINISTRATION_PAGE_SIZE } from '../../../../platform/administration/common/administrationProtocol.js';
import { BulkUserChanges } from './bulkUserChanges.js';
import { AdminMenuButton } from '../widgets/adminMenuButton.js';
import { UserActions, type AdminUser } from './userActions.js';

type Status = 'active' | 'disabled' | 'any';
type LastActive = 'any' | 'never' | 'recent' | 'idle';
const DAY = 86_400_000;
type AffiliationKind = (typeof affiliationKinds)[number];

const ANY = 'any';
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
	private readonly filters: AdminFilters;
	private readonly unit: SelectControl<string>;
	private readonly status: SelectControl<Status>;
	private readonly role: SelectControl<string>;
	private readonly bulk: BulkUserChanges;
	private enableButton: ButtonControl | undefined;
	private disableButton: ButtonControl | undefined;
	private readonly invite = this._register(new MutableDisposable<InviteDialog>());
	private query: AdminListQuery<'users'> = {};
	/** Each person's picture, read once: their own or the default the server draws. Bounded. */
	private readonly photos = new Map<string, string>();

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext
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

		this.filters = this._register(new AdminFilters(body));
		const filters = this.filters;
		filters.addSearch(format.text('usersFind'), (q) => this.setQuery({ q }));
		this.status = filters.addSelect<Status>(
			format.text('usersStatus'),
			'status.success',
			this.statusChoices(false),
			'active',
			(status) =>
				// Only an Institution-wide viewer may ask for disabled accounts alone.
				this.setQuery(
					status === 'disabled'
						? { state: 'disabled', includeDisabled: undefined }
						: { state: undefined, includeDisabled: status === 'any' ? true : undefined }
				)
		);
		filters.addSelect<AffiliationKind | typeof ANY>(
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
		filters.addSelect<LastActive>(
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
	}

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
			variant: 'secondary' | 'dangerGhost' = 'secondary'
		): ButtonControl => {
			const control = this._register(
				new ButtonControl(host, {
					variant,
					size: 'small',
					label,
					icon: proctorIconFactory(icon, 14)
				})
			);
			this._register(control.onDidRequest(() => run(this.list.selection)));
			return control;
		};
		button(format.text('usersBulkEnrol'), 'object.student', (users) => this.bulk.enrol(users));
		button(format.text('usersBulkGrant'), 'admin.roles', (users) => this.bulk.grant(users));
		// The less used changes give way to ⋯ when the bar is narrow, so it never wraps.
		const signOut = (users: readonly AdminUser[]): void => this.bulk.signOut(users);
		const enable = (users: readonly AdminUser[]): void =>
			this.bulk.enable(users.filter((user) => user.disabledAt !== undefined));
		const disable = (users: readonly AdminUser[]): void =>
			this.bulk.disable(users.filter((user) => user.disabledAt === undefined));
		button(
			format.text('usersBulkSignOut'),
			'action.signOut',
			signOut
		).element.dataset.secondary = 'true';
		this.enableButton = button(format.text('usersBulkEnable'), 'action.enable', enable);
		this.enableButton.element.dataset.secondary = 'true';
		this.disableButton = button(
			format.text('usersBulkDisable'),
			'action.end',
			disable,
			'dangerGhost'
		);
		this.disableButton.element.dataset.secondary = 'true';
		const more = this._register(
			new AdminMenuButton(
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
			this.filters.setSelection(undefined);
			return;
		}
		const count = this.format.count(users.length);
		this.filters.setSelection(
			users.length === 1
				? this.format.text('usersSelectedOne')
				: this.format.text('usersSelected', { count }),
			users.length === 1
				? this.format.text('usersSelectionLabelOne')
				: this.format.text('usersSelectionLabel', { count })
		);
		this.enableButton!.element.hidden = !users.some((user) => user.disabledAt !== undefined);
		this.disableButton!.element.hidden = !users.some((user) => user.disabledAt === undefined);
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
