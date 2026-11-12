/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import {
	invitationPurposes,
	invitationStates
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRowAction } from '../../../browser/authenticated/pages/pageSection.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { AdminFilters } from '../widgets/adminFilters.js';
import {
	AdminList,
	type AdminListItem,
	type AdminCell,
	type AdminListQuery
} from '../widgets/adminList.js';
import { readOnce } from '../widgets/adminReads.js';
import { InviteDialog } from './inviteDialog.js';

type Invitation = AdminListItem<'invitations'>;
type State = (typeof invitationStates)[number];
type Purpose = (typeof invitationPurposes)[number];

const STATE_TEXT: Readonly<Record<State, AdministrationText>> = {
	pending: 'invitationStatePending',
	accepted: 'invitationStateAccepted',
	revoked: 'invitationStateRevoked',
	expired: 'invitationStateExpired',
	superseded: 'invitationStateSuperseded'
};
const PURPOSE_TEXT: Readonly<Record<Purpose, AdministrationText>> = {
	student_class: 'invitationKindStudent',
	teacher_academic_unit: 'invitationKindTeacher',
	academic_unit_role: 'invitationKindUnitRole',
	institution_role: 'invitationKindInstitutionRole'
};
const ANY = 'any';
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/u;

/** Who was invited to what, whether their email arrived, and resending or revoking it. */
export class InvitationsPage extends Disposable implements PageView {
	private readonly list: AdminList<'invitations'>;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly changes: AdminChanges;
	private query: AdminListQuery<'invitations'> = { state: 'pending' };
	/** Who sent each invitation, read once per inviter. */
	private readonly names = new Map<string, string>();

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IAdministrationService private readonly administration: IAdministrationService
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
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
		const invite = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('usersInvite'),
				icon: proctorIconFactory('action.invite')
			})
		);
		const openInvite = (): void => {
			this.dialog.value = instantiationService.createInstance(InviteDialog);
		};
		this._register(invite.onDidRequest(openInvite));

		const filters = this._register(new AdminFilters(body));
		filters.addSearch(format.text('invitationsFind'), (text) =>
			this.setQuery({ email: text !== undefined && EMAIL.test(text) ? text : undefined })
		);
		filters.addSelect<State | typeof ANY>(
			format.text('invitationsStatus'),
			'status.success',
			[
				...invitationStates.map((state) => ({
					value: state,
					label: format.text(STATE_TEXT[state])
				})),
				{ value: ANY, label: format.text('invitationsAny') }
			],
			'pending',
			(state) => this.setQuery({ state: state === ANY ? undefined : state })
		);
		filters.addSelect<Purpose | typeof ANY>(
			format.text('invitationsKind'),
			'action.filter',
			[
				{ value: ANY, label: format.text('invitationsAnyKind') },
				...invitationPurposes.map((purpose) => ({
					value: purpose,
					label: format.text(PURPOSE_TEXT[purpose])
				}))
			],
			ANY,
			(purpose) => this.setQuery({ purpose: purpose === ANY ? undefined : purpose })
		);

		this.list = this._register(
			instantiationService.createInstance(
				AdminList<'invitations'>,
				body,
				'invitations',
				this.query,
				{
					label: format.text('invitationsTable'),
					columns: [
						{
							label: format.text('invitationsColumnInvitee'),
							width: '34%',
							min: 220,
							cell: (invitation) => ({
								kind: 'text',
								primary: invitation.email,
								secondary:
									invitation.delivery?.failureCode === undefined
										? ''
										: format.code('problem', invitation.delivery.failureCode),
								...(invitation.delivery?.failureCode === undefined
									? {}
									: { secondaryTone: 'fail' as const }),
								strong: true
							})
						},
						{
							label: format.text('invitationsColumnKind'),
							width: '24%',
							cell: (invitation) => ({
								kind: 'text',
								primary: format.text(PURPOSE_TEXT[invitation.purpose])
							})
						},
						{
							label: format.text('invitationsColumnBy'),
							width: '18%',
							priority: 3,
							foldLabel: true,
							cell: (invitation) => ({
								kind: 'text',
								primary:
									this.names.get(invitation.inviterId) ??
									format.text('inviteLoading'),
								quiet: true
							})
						},
						{
							label: format.text('invitationsColumnExpires'),
							width: '120px',
							align: 'end',
							priority: 2,
							cell: (invitation) => ({
								kind: 'text',
								primary: format.date(invitation.expiresAt),
								mono: true,
								quiet: true
							})
						},
						{
							label: format.text('invitationsColumnStatus'),
							cell: (invitation) => this.status(invitation)
						}
					],
					rowId: (invitation) => invitation.id,
					rowName: (invitation) => invitation.email,
					actions: (invitation) => this.actions(invitation),
					icon: 'admin.invitations',
					empty: {
						title: format.text('invitationsEmpty'),
						text: format.text('invitationsEmptyText'),
						action: {
							label: format.text('usersInvite'),
							icon: 'action.invite',
							run: openInvite
						}
					},
					filteredEmpty: format.text('invitationsNoMatch'),
					// Pending is where the page starts, so only another choice counts as filtering.
					filtered: (query) =>
						query.email !== undefined ||
						query.purpose !== undefined ||
						query.state !== 'pending'
				}
			)
		);
		this._register(this.list.onDidLoad((invitations) => void this.loadNames(invitations)));
	}

	private async loadNames(invitations: readonly Invitation[]): Promise<void> {
		const missing = [...new Set(invitations.map((invitation) => invitation.inviterId))].filter(
			(id) => !this.names.has(id)
		);
		if (missing.length === 0) return;
		const users = await Promise.all(
			missing.map((id) => readOnce(this.administration, { kind: 'user', id }))
		);
		if (this._store.isDisposed) return;
		missing.forEach((id, index) => {
			const user = users[index]!;
			this.names.set(
				id,
				user.kind === 'data'
					? user.value.displayName
					: this.format.text('classUnknownPerson')
			);
		});
		this.list.redraw();
	}

	private status(invitation: Invitation): AdminCell {
		const failed =
			invitation.state === 'pending' &&
			(invitation.delivery?.state === 'failed' ||
				invitation.delivery?.state === 'suppressed');
		if (failed)
			return { kind: 'status', text: this.format.text('invitationBounced'), tone: 'failure' };
		if (invitation.state === 'pending')
			return {
				kind: 'status',
				text: this.format.text(STATE_TEXT.pending),
				tone: 'neutral'
			};
		return {
			kind: 'status',
			text: this.format.text(STATE_TEXT[invitation.state]),
			tone: 'neutral'
		};
	}

	private actions(invitation: Invitation): readonly PageRowAction[] {
		if (invitation.state !== 'pending') return [];
		return [
			{
				label: this.format.text('invitationResend'),
				icon: 'action.sendEmail',
				run: () => void this.resend(invitation)
			},
			{
				label: this.format.text('invitationRevoke'),
				icon: 'action.end',
				destructive: true,
				run: () => this.revoke(invitation)
			}
		];
	}

	private async resend(invitation: Invitation): Promise<void> {
		const result = await this.changes.send(
			{ kind: 'resendInvitation', id: invitation.id, expectedRevision: invitation.revision },
			[invitation.email]
		);
		if (this._store.isDisposed) return;
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text('invitationResent', { email: invitation.email }));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result), {
				retry: () => void this.resend(invitation)
			});
		void this.list.refresh();
	}

	private revoke(invitation: Invitation): void {
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('invitationRevokeTitle', { email: invitation.email }),
				message: this.format.text('invitationRevokeBody'),
				confirmLabel: this.format.text('invitationRevokeConfirm'),
				confirmIcon: 'action.end',
				destructive: true,
				run: () =>
					this.changes.send(
						{
							kind: 'revokeInvitation',
							id: invitation.id,
							expectedRevision: invitation.revision
						},
						[invitation.email]
					),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('invitationRevoked', { email: invitation.email })
					);
					void this.list.refresh();
				}
			},
			() => this.list.focusRow(invitation.id)
		);
	}

	private setQuery(change: Partial<AdminListQuery<'invitations'>>): void {
		const next: Record<string, unknown> = { ...this.query, ...change };
		for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
		this.query = next as AdminListQuery<'invitations'>;
		this.list.setQuery(this.query);
	}

	setVisible(visible: boolean): void {
		this.list.setActive(visible);
	}
}
