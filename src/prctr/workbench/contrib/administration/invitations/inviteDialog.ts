/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { SegmentedControl } from '../../../../base/browser/ui/segmented/segmentedControl.js';
import {
	SelectControl,
	type SelectChoice
} from '../../../../base/browser/ui/select/selectControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	AdministrationChangeIntent,
	AdministrationIntentOf
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { parseEmails } from '../common/administrationPresentation.js';
import { AdminChanges } from '../widgets/adminChanges.js';
import { adminField, adminTextArea } from '../widgets/adminForm.js';
import { readOnce, readPages, readUnitTree, unitLabel } from '../widgets/adminReads.js';

type InviteKind = 'students' | 'teachers' | 'role';

const NONE = '';
const MAXIMUM_ADDRESSES = 200;

/**
 * Invites up to 200 people at once: students to a class, teachers to an academic unit with
 * a role, or people to an institution-wide role. Each address becomes one invitation in one
 * batch; addresses the server refuses stay listed in the dialog.
 */
export class InviteDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly emails: HTMLTextAreaElement;
	private readonly emailHint: HTMLElement;
	private readonly unit: SelectControl<string>;
	private readonly unitField: HTMLElement;
	private readonly klass: SelectControl<string>;
	private readonly classField: HTMLElement;
	private readonly classHint: HTMLElement;
	private readonly role: SelectControl<string>;
	private readonly roleField: HTMLElement;
	private readonly feedback: PageFeedback;
	private readonly send: ButtonControl;
	private readonly cancel: ButtonControl;
	private readonly changes: AdminChanges;
	private kind: InviteKind = 'students';
	private institutionId: string | undefined;
	private working = false;

	constructor(
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		this.dialog = this._register(
			new PageDialog(pane, {
				title: format.text('inviteTitle'),
				description: format.text('inviteBody'),
				size: 'medium'
			})
		);
		const body = this.dialog.body;
		const kindField = adminField(body, format.text('inviteKind'));
		const kinds = this._register(
			new SegmentedControl<InviteKind>(kindField.element, {
				label: format.text('inviteKind'),
				value: 'students',
				options: [
					{ value: 'students', label: format.text('inviteStudents') },
					{ value: 'teachers', label: format.text('inviteTeachers') },
					{ value: 'role', label: format.text('inviteRole') }
				]
			})
		);
		this._register(kinds.onDidChange((kind) => this.setKind(kind)));

		const emailField = adminField(
			body,
			format.text('inviteEmails'),
			format.text('inviteEmailsHint')
		);
		this.emails = adminTextArea(emailField, 4);
		this.emailHint = emailField.hint;
		this._register(addDisposableListener(this.emails, 'input', () => this.update()));

		const unitField = adminField(body, format.text('inviteUnit'));
		this.unitField = unitField.element;
		this.unit = this._register(this.select(unitField, format.text('inviteUnit')));
		this._register(this.unit.onDidChange((unit) => void this.loadClasses(unit)));

		const classField = adminField(body, format.text('inviteClass'));
		this.classField = classField.element;
		this.klass = this._register(this.select(classField, format.text('inviteClass')));
		classField.element.append(classField.hint);
		this.classHint = classField.hint;
		this._register(this.klass.onDidChange(() => this.update()));

		const roleField = adminField(body, format.text('inviteRoleLabel'));
		this.roleField = roleField.element;
		this.role = this._register(this.select(roleField, format.text('inviteRoleLabel')));
		this._register(this.role.onDidChange(() => this.update()));

		this.feedback = this._register(new PageFeedback(body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: format.text('cancel'),
				icon: proctorIconFactory('action.close')
			})
		);
		this.send = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: format.text('inviteSendNone'),
				icon: proctorIconFactory('admin.mail'),
				disabled: true
			})
		);
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.send.onDidRequest(() => void this.submit()));
		this.setKind('students');
		this.dialog.show(this.emails);
		void this.loadChoices();
	}

	private select(field: ReturnType<typeof adminField>, label: string): SelectControl<string> {
		return new SelectControl<string>(field.element, {
			label,
			choices: [{ value: NONE, label: this.format.text('inviteLoading') }],
			value: NONE,
			caret: proctorIconFactory('action.expand', 14),
			disabled: true
		});
	}

	private setKind(kind: InviteKind): void {
		this.kind = kind;
		this.unitField.hidden = kind === 'role';
		this.classField.hidden = kind !== 'students';
		this.roleField.hidden = kind === 'students';
		this.update();
	}

	private async loadChoices(): Promise<void> {
		const [units, roles, institution] = await Promise.all([
			readUnitTree(this.administration),
			readPages(this.administration, 'roles', {}),
			readOnce(this.administration, {
				kind: 'institution'
			} as AdministrationIntentOf<'institution'>)
		]);
		if (this._store.isDisposed) return;
		if (institution.kind === 'data') this.institutionId = institution.value.id;
		this.fill(
			this.unit,
			units.kind === 'data'
				? units.value.map((unit) => ({ value: unit.id, label: unitLabel(unit) }))
				: undefined,
			units.kind === 'failure' ? units.reason : undefined
		);
		this.fill(
			this.role,
			roles.kind === 'data'
				? roles.value.items
						.filter((role) => role.archivedAt === undefined)
						.map((role) => ({ value: role.id, label: role.displayName }))
				: undefined,
			roles.kind === 'failure' ? roles.reason : undefined
		);
		this.fill(this.klass, [], undefined);
		this.update();
	}

	private async loadClasses(unitId: string): Promise<void> {
		this.update();
		if (unitId === NONE) {
			this.fill(this.klass, [], undefined);
			return;
		}
		this.klass.setChoices([{ value: NONE, label: this.format.text('inviteLoading') }], NONE);
		this.klass.setDisabled(true);
		const classes = await readPages(this.administration, 'unitClasses', { unitId });
		if (this._store.isDisposed || this.unit.select.value !== unitId) return;
		const choices =
			classes.kind === 'data'
				? classes.value.items
						.filter((klass) => klass.archivedAt === undefined)
						.map((klass) => ({ value: klass.id, label: klass.displayName }))
				: undefined;
		this.fill(this.klass, choices, classes.kind === 'failure' ? classes.reason : undefined);
		this.classHint.textContent =
			choices !== undefined && choices.length === 0
				? this.format.text('inviteNoClasses')
				: '';
		this.classHint.hidden = this.classHint.textContent === '';
		this.update();
	}

	private fill(
		select: SelectControl<string>,
		choices: readonly SelectChoice<string>[] | undefined,
		failure: string | undefined
	): void {
		if (choices === undefined) {
			select.setChoices(
				[{ value: NONE, label: this.format.failure(failure ?? 'unavailable') }],
				NONE
			);
			select.setDisabled(true);
			return;
		}
		select.setChoices(
			[{ value: NONE, label: this.format.text('inviteChoose') }, ...choices],
			NONE
		);
		select.setDisabled(choices.length === 0);
	}

	/** The addresses entered and whether they and the chosen target can be sent. */
	private update(): { readonly addresses: readonly string[]; readonly ready: boolean } {
		const parsed = parseEmails(this.emails.value);
		let error: string | undefined;
		if (parsed.invalid.length > 0)
			error = this.format.text('inviteEmailsInvalid', {
				addresses: parsed.invalid.slice(0, 5).join(', ')
			});
		else if (parsed.valid.length > MAXIMUM_ADDRESSES)
			error = this.format.text('inviteEmailsTooMany', { count: parsed.valid.length });
		this.emailHint.textContent = error ?? this.format.text('inviteEmailsHint');
		this.emailHint.dataset.error = String(error !== undefined);
		this.emails.setAttribute('aria-invalid', String(error !== undefined));
		const target =
			this.kind === 'students'
				? this.klass.select.value
				: this.kind === 'teachers'
					? this.unit.select.value !== NONE && this.role.select.value !== NONE
						? this.role.select.value
						: NONE
					: this.institutionId === undefined
						? NONE
						: this.role.select.value;
		const ready =
			error === undefined && parsed.valid.length > 0 && target !== NONE && !this.working;
		const count = parsed.valid.length;
		this.send.setState({
			label:
				count === 0 || error !== undefined
					? this.format.text('inviteSendNone')
					: count === 1
						? this.format.text('inviteSendOne')
						: this.format.text('inviteSendMany', { count }),
			icon: proctorIconFactory('admin.mail'),
			disabled: !ready,
			busy: this.working
		});
		return { addresses: parsed.valid, ready };
	}

	private intent(addresses: readonly string[]): AdministrationChangeIntent {
		const items = addresses.map((email, index) => ({ key: `invite-${index + 1}`, email }));
		if (this.kind === 'students')
			return {
				kind: 'runInvitationBatch',
				operation: 'student_class.create',
				scopeType: 'class',
				scopeId: this.klass.select.value,
				items
			};
		const roleId = this.role.select.value;
		if (this.kind === 'teachers')
			return {
				kind: 'runInvitationBatch',
				operation: 'teacher_academic_unit.create',
				scopeType: 'academic_unit',
				scopeId: this.unit.select.value,
				items: items.map((item) => ({ ...item, roleId }))
			};
		return {
			kind: 'runInvitationBatch',
			operation: 'institution_role.create',
			scopeType: 'institution',
			scopeId: this.institutionId!,
			items: items.map((item) => ({ ...item, roleId }))
		};
	}

	private async submit(): Promise<void> {
		const { addresses, ready } = this.update();
		if (!ready) {
			if (addresses.length === 0) {
				this.emailHint.textContent = this.format.text('inviteEmailsRequired');
				this.emailHint.dataset.error = 'true';
				this.emails.focus();
			}
			return;
		}
		this.working = true;
		this.feedback.set();
		this.cancel.setState({
			label: this.format.text('cancel'),
			icon: proctorIconFactory('action.close'),
			disabled: true
		});
		this.update();
		const target =
			this.kind === 'students'
				? this.klass.select.selectedOptions[0]?.textContent
				: this.role.select.selectedOptions[0]?.textContent;
		const result = await this.changes.send(this.intent(addresses), [
			this.send.element.textContent ?? '',
			target ?? ''
		]);
		if (this._store.isDisposed) return;
		this.working = false;
		this.cancel.setState({
			label: this.format.text('cancel'),
			icon: proctorIconFactory('action.close')
		});
		if (result === 'busy' || result.kind === 'error') {
			this.update();
			if (result === 'busy' || result.reason !== 'cancelled')
				this.feedback.set(this.changes.describe(result), 'error');
			return;
		}
		const failed =
			result.kind === 'batchResult'
				? result.result.items
						.filter((item) => item.status === 'failed')
						.map((item) => addresses[item.index] ?? '')
				: [];
		const sent = addresses.length - failed.length;
		if (failed.length === 0) {
			this.pane.toast(
				sent === 1
					? this.format.text('inviteSentOne')
					: this.format.text('inviteSentMany', { count: sent })
			);
			this.dispose();
			return;
		}
		// Keep only the addresses that still need sending.
		this.emails.value = failed.join('\n');
		this.update();
		this.feedback.set(
			this.format.text('invitePartly', { sent, addresses: failed.join(', ') }),
			'error'
		);
	}

	private close(): void {
		if (this.working) return;
		this.dispose();
	}
}
