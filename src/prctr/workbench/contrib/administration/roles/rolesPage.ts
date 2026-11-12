/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import type { AdministrationValue } from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import {
	PageSection,
	type PageRowAction
} from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { permissionMatrix, readableCode } from '../common/administrationPresentation.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { renderDetails } from '../widgets/adminDetails.js';
import { AdminFormDialog } from '../widgets/adminFormDialog.js';
import { AdminMenuButton } from '../widgets/adminMenuButton.js';
import { readPages } from '../widgets/adminReads.js';
import './media/rolesPage.css';

type Role = AdministrationValue<'roles'>['items'][number];

/**
 * What each role allows: the roles listed beside the chosen one's details and a grid of its
 * permissions by area. Built-in roles are read-only; custom roles are created from the
 * permissions existing roles hold, edited and deleted.
 */
export class RolesPage extends Disposable implements PageView {
	private readonly list: HTMLElement;
	private readonly listNote: HTMLElement;
	private readonly listStore = this._register(new DisposableStore());
	private readonly details: PageSection;
	private readonly permissions: PageSection;
	private readonly menu: AdminMenuButton;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly gridStore = this._register(new DisposableStore());
	private roles: readonly Role[] = [];
	private chosen: string | undefined;
	private loaded = false;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		const create = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('rolesNew'),
				icon: proctorIconFactory('action.add')
			})
		);
		this._register(create.onDidRequest(() => this.edit(undefined)));
		this.menu = this._register(
			new AdminMenuButton(
				headerActions,
				format.text('classMore'),
				() => this.menuActions(),
				pane
			)
		);
		this.menu.element.hidden = true;

		const $ = createElementFactory(body.ownerDocument);
		this.list = $('div.prctr-admin-roles__list', {
			attrs: { role: 'listbox', 'aria-label': format.text('rolesList') }
		});
		this.listNote = $('p.prctr-admin-roles__note', { hidden: true });
		const aside = $(
			'aside.prctr-admin-roles__aside',
			{ attrs: { 'aria-label': format.text('rolesList') } },
			$('span.prctr-admin-roles__aside-title', { textContent: format.text('rolesList') }),
			this.list,
			this.listNote
		);
		const main = $('div.prctr-admin-roles__main');
		body.append($('div.prctr-admin-roles', {}, aside, main));
		this.details = this._register(
			instantiationService.createInstance(PageSection, main, {
				title: format.text('rolesChoose')
			})
		);
		this.details.setState({ kind: 'ready' }, false);
		this.permissions = this._register(
			instantiationService.createInstance(PageSection, main, {
				title: format.text('rolesPermissions'),
				description: format.text('rolesPermissionsDescription')
			})
		);
		this.permissions.hidden = true;
		this._register(
			addDisposableListener(this.list, 'keydown', (event) => this.onKeyDown(event))
		);
	}

	setVisible(visible: boolean): void {
		if (visible && !this.loaded) {
			this.loaded = true;
			void this.load();
		}
	}

	private async load(): Promise<void> {
		this.listNote.hidden = true;
		const roles = await readPages(this.administration, 'roles', {}, 200);
		if (this._store.isDisposed) return;
		if (roles.kind === 'failure') {
			this.note(this.format.failure(roles.reason));
			return;
		}
		this.roles = roles.value.items.filter((role) => role.archivedAt === undefined);
		if (this.roles.length === 0) this.note(this.format.text('rolesNone'));
		if (this.chosen === undefined || !this.roles.some((role) => role.id === this.chosen))
			this.chosen = this.roles[0]?.id;
		this.renderList();
		this.renderRole();
	}

	private note(text: string): void {
		this.listNote.textContent = text;
		this.listNote.hidden = false;
	}

	/** Every permission an existing role holds, the catalogue a custom role chooses from. */
	private catalogue(): readonly string[] {
		return [...new Set(this.roles.flatMap((role) => role.permissions))].sort();
	}

	private renderList(): void {
		this.listStore.clear();
		const $ = createElementFactory(this.list.ownerDocument);
		this.list.replaceChildren(
			...this.roles.map((role) => {
				const holders = role.holders;
				const label = [
					role.displayName,
					...(holders === undefined
						? []
						: [this.people(holders.users, holders.usersIsLowerBound)]),
					...(role.builtIn ? [this.format.text('rolesBuiltIn')] : [])
				].join(', ');
				const item = $(
					'div.prctr-admin-roles__item',
					{
						tabIndex: role.id === this.chosen ? 0 : -1,
						data: { roleId: role.id },
						attrs: {
							role: 'option',
							'aria-selected': String(role.id === this.chosen),
							'aria-label': label
						}
					},
					$('span.prctr-admin-roles__item-name', { textContent: role.displayName }),
					// How many people hold it, when the viewer may see who does.
					...(holders === undefined
						? []
						: [
								$('span.prctr-admin-roles__item-count', {
									textContent: this.amount(
										holders.users,
										holders.usersIsLowerBound
									),
									attrs: { 'aria-hidden': 'true' }
								})
							]),
					// A built-in role can't be changed; the lock says so where it is chosen.
					...(role.builtIn
						? [
								$(
									'span.prctr-admin-roles__item-meta',
									{},
									this.listStore.add(
										createProctorIcon(this.list.ownerDocument, {
											id: 'status.locked',
											size: 14
										})
									).element,
									$('span', { textContent: this.format.text('rolesBuiltIn') })
								)
							]
						: [])
				);
				this.listStore.add(
					addDisposableListener(item, 'click', () => this.choose(role.id))
				);
				return item;
			})
		);
	}

	private choose(id: string): void {
		this.chosen = id;
		this.renderList();
		this.renderRole();
		this.list.querySelector<HTMLElement>(`[data-role-id="${CSS.escape(id)}"]`)?.focus();
	}

	private onKeyDown(event: KeyboardEvent): void {
		const index = this.roles.findIndex((role) => role.id === this.chosen);
		const next =
			event.key === 'ArrowDown'
				? index + 1
				: event.key === 'ArrowUp'
					? index - 1
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? this.roles.length - 1
							: undefined;
		if (next === undefined) return;
		event.preventDefault();
		const role = this.roles[Math.max(0, Math.min(this.roles.length - 1, next))];
		if (role !== undefined) this.choose(role.id);
	}

	private renderRole(): void {
		const role = this.roles.find((candidate) => candidate.id === this.chosen);
		this.menu.element.hidden = role === undefined || role.builtIn;
		this.permissions.hidden = role === undefined;
		if (role === undefined) {
			this.details.setHeading(this.format.text('rolesChoose'));
			this.details.content.replaceChildren();
			return;
		}
		this.details.setHeading(
			role.displayName,
			role.description || (role.builtIn ? this.format.text('rolesBuiltInNote') : undefined)
		);
		renderDetails(this.details.content, [
			{
				label: this.format.text('rolesKind'),
				value: this.format.text(role.builtIn ? 'rolesBuiltIn' : 'rolesCustom')
			},
			{ label: this.format.text('rolesName'), value: role.name },
			...(role.holders === undefined
				? []
				: [
						{
							label: this.format.text('rolesGivenTo'),
							value:
								role.holders.users === 0
									? this.format.text('rolesGivenToNobody')
									: this.format.text('rolesGivenToPeople', {
											people: this.people(
												role.holders.users,
												role.holders.usersIsLowerBound
											),
											places: this.places(
												role.holders.scopes,
												role.holders.scopesIsLowerBound
											)
										})
						}
					]),
			{
				label: this.format.text('rolesPermissionCount'),
				value: this.format.text('rolesPermissionTotal', {
					count: this.format.count(role.permissions.length)
				})
			}
		]);
		this.renderGrid(role);
	}

	/** A count as shown, "10,000+" when the server stopped counting. */
	private amount(count: number, atLeast: boolean): string {
		return atLeast
			? this.format.text('rolesAtLeast', { count: this.format.count(count) })
			: this.format.count(count);
	}

	/** "23 people", "1 person", "10,000+ people". */
	private people(count: number, atLeast: boolean): string {
		return atLeast
			? this.format.text('rolesPeople', { count: this.amount(count, true) })
			: this.format.counted('rolesPeople', count);
	}

	/** "6 places", "1 place": the institution, units and classes it is given in. */
	private places(count: number, atLeast: boolean): string {
		return atLeast
			? this.format.text('rolesPlaces', { count: this.amount(count, true) })
			: this.format.counted('rolesPlaces', count);
	}

	/** The role's permissions as areas by verbs, a tick where it allows the pair. */
	private renderGrid(role: Role): void {
		this.gridStore.clear();
		// Only the areas the role reaches, and only the verbs those areas offer, so the grid fits.
		const areas = new Set(
			role.permissions.map((code) => code.slice(0, Math.max(0, code.lastIndexOf('.'))))
		);
		const matrix = permissionMatrix(
			this.catalogue().filter((code) =>
				areas.has(code.slice(0, Math.max(0, code.lastIndexOf('.'))))
			),
			role.permissions
		);
		this.permissions.setState(
			{ kind: 'ready' },
			role.permissions.length === 0 ? this.format.text('rolesNoPermissions') : false
		);
		const $ = createElementFactory(this.permissions.content.ownerDocument);
		if (role.permissions.length === 0) {
			this.permissions.content.replaceChildren();
			return;
		}
		const allowed = this.format.text('rolesAllowed');
		const notAllowed = this.format.text('rolesNotAllowed');
		const table = $(
			'table.prctr-admin-roles__grid',
			{ attrs: { 'aria-label': this.format.text('rolesPermissions') } },
			$(
				'thead',
				{},
				$(
					'tr',
					{},
					$('th', {
						textContent: this.format.text('rolesArea'),
						attrs: { scope: 'col' }
					}),
					...matrix.verbs.map((verb) =>
						$('th', {
							textContent: readableCode(verb),
							attrs: { scope: 'col' },
							data: { align: 'center' }
						})
					)
				)
			),
			$(
				'tbody',
				{},
				...matrix.areas
					.filter((area) => area.cells.some((cell) => cell === 'allowed'))
					.map((area) =>
						$(
							'tr',
							{},
							$('th', {
								textContent: readableCode(area.area),
								attrs: { scope: 'row' }
							}),
							...area.cells.map((cell, index) => {
								const td = $('td', { data: { align: 'center' } });
								if (cell === 'allowed') {
									const icon = this.gridStore.add(
										createProctorIcon(td.ownerDocument, {
											id: 'action.confirm',
											size: 16
										})
									);
									icon.element.setAttribute('role', 'img');
									icon.element.setAttribute(
										'aria-label',
										`${readableCode(matrix.verbs[index]!)}: ${allowed}`
									);
									td.append(icon.element);
								} else if (cell === 'denied')
									td.append(
										$('span', {
											textContent: '—',
											attrs: {
												'aria-label': `${readableCode(matrix.verbs[index]!)}: ${notAllowed}`
											}
										})
									);
								return td;
							})
						)
					)
			)
		);
		this.permissions.content.replaceChildren(table);
	}

	private menuActions(): readonly PageRowAction[] {
		const role = this.roles.find((candidate) => candidate.id === this.chosen);
		if (role === undefined || role.builtIn) return [];
		return [
			{
				label: this.format.text('rolesEdit'),
				icon: 'action.edit',
				run: () => this.edit(role)
			},
			{
				label: this.format.text('rolesDelete'),
				icon: 'action.delete',
				destructive: true,
				run: () => this.remove(role)
			}
		];
	}

	private edit(role: Role | undefined): void {
		const matrix = permissionMatrix(this.catalogue(), role?.permissions ?? []);
		const groups = matrix.areas.map((area) => ({
			label: readableCode(area.area),
			choices: matrix.verbs
				.filter((_, index) => area.cells[index] !== 'absent')
				.map((verb) => ({ value: `${area.area}.${verb}`, label: readableCode(verb) }))
		}));
		const name = role?.displayName ?? '';
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			title:
				role === undefined
					? this.format.text('rolesNewTitle')
					: this.format.text('rolesEditTitle', { name }),
			confirmLabel: this.format.text(
				role === undefined ? 'structureCreate' : 'structureSave'
			),
			confirmIcon: role === undefined ? 'action.add' : 'action.confirm',
			fields: [
				{
					kind: 'text',
					id: 'displayName',
					label: this.format.text('structureDisplayName'),
					value: name,
					required: true
				},
				...(role === undefined
					? [
							{
								kind: 'text' as const,
								id: 'name',
								label: this.format.text('rolesName'),
								hint: this.format.text('rolesNameHint'),
								required: true
							}
						]
					: []),
				{
					kind: 'longText',
					id: 'description',
					label: this.format.text('structureDescriptionField'),
					value: role?.description ?? ''
				},
				{
					kind: 'checklist',
					id: 'permissions',
					label: this.format.text('rolesPermissionsField'),
					hint: this.format.text('rolesPermissionsHint'),
					groups,
					value: role?.permissions ?? []
				}
			],
			submit: (values) => {
				const permissions = (values.permissions as readonly string[] | undefined) ?? [];
				const description = values.description as string | undefined;
				return role === undefined
					? {
							kind: 'createRole',
							name: values.name as string,
							displayName: values.displayName as string,
							permissions,
							...(description === undefined ? {} : { description })
						}
					: {
							kind: 'updateRole',
							id: role.id,
							displayName: values.displayName as string,
							permissions,
							...(description === undefined ? {} : { description })
						};
			},
			summary: (values) => [String(values.displayName ?? '')],
			onDidComplete: (result) => {
				this.pane.toast(
					result.kind === 'error'
						? this.format.failure(result.reason)
						: this.format.text('rolesSaved', {
								name: name || this.format.text('rolesNewTitle')
							})
				);
				if (result.kind === 'created') this.chosen = result.id;
				void this.load();
			}
		});
	}

	private remove(role: Role): void {
		const name = role.displayName;
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('rolesDeleteTitle', { name }),
				message: this.format.text('rolesDeleteBody'),
				confirmLabel: this.format.text('rolesDeleteConfirm'),
				confirmIcon: 'action.delete',
				destructive: true,
				run: () => this.changes.send({ kind: 'deleteRole', id: role.id }, [name]),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('rolesDeleted', { name })
					);
					this.chosen = undefined;
					void this.load();
				}
			},
			() => this.pane.focusPage()
		);
	}
}
