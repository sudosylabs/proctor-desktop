/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	SelectControl,
	type SelectChoice
} from '../../../../base/browser/ui/select/selectControl.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import type {
	AdministrationBatchResult,
	AdministrationIntentOf,
	AdministrationResponse,
	AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import {
	AdminChanges,
	AdminConfirmation,
	type AdminChangeResult
} from '../widgets/adminChanges.js';
import { AdminChips } from '../widgets/adminChips.js';
import { adminField } from '../widgets/adminForm.js';
import { readOnce, readPages, readUnitTree, unitLabel } from '../widgets/adminReads.js';
import { FilterPreviewDialog } from './filterPreviewDialog.js';
import './media/bulkUserChanges.css';

type User = AdministrationValue<'user'>;
type Batch = AdministrationIntentOf<'runAcademicBatch'>;

const NONE = '';

/** Everyone a filter matches, in place of chosen people: the dialog picks only the place. */
interface EveryoneChoice {
	readonly count: number;
	choose(
		place: Pick<
			AdministrationIntentOf<'createAcademicPreview'>,
			'operation' | 'scopeType' | 'scopeId' | 'roleId'
		>,
		where: string
	): void;
}
const INSTITUTION = 'institution';

/**
 * Changes for several chosen people at once: enrolling them in a class, granting a role,
 * signing them out, disabling or enabling their accounts. Each is one academic administration
 * batch, so one person who can't be changed doesn't stop the others; when some fail, a result
 * dialog lists who and why.
 */
export class BulkUserChanges extends Disposable {
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly changes: AdminChanges;

	constructor(
		/** Called once a change ran, so the owner reads the list again. */
		private readonly onDidChange: () => void,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
	}

	enrol(users: readonly User[]): void {
		this.dialog.value = this.instantiationService.createInstance(
			BulkPlaceDialog,
			'enrol',
			users,
			(batch, people) => this.run(batch, people),
			undefined
		);
	}

	grant(users: readonly User[]): void {
		this.dialog.value = this.instantiationService.createInstance(
			BulkPlaceDialog,
			'grant',
			users,
			(batch, people) => this.run(batch, people),
			undefined
		);
	}

	signOut(users: readonly User[]): void {
		this.confirm(users, 'user_sessions.revoke', {
			title: this.many(users.length, 'bulkSignOutTitle'),
			message: this.format.text('bulkSignOutBody'),
			confirmLabel: this.format.text('usersBulkSignOut'),
			confirmIcon: 'action.signOut',
			destructive: true
		});
	}

	/** Disabling is listed person by person, so one can still be taken out before it runs. */
	disable(users: readonly User[]): void {
		this.confirm(
			users,
			'user.disable',
			{
				title: this.many(users.length, 'bulkDisableTitle'),
				message: this.format.text('bulkDisableBody'),
				confirmLabel: this.many(users.length, 'bulkDisableConfirm'),
				confirmIcon: 'action.end',
				destructive: true
			},
			true
		);
	}

	enable(users: readonly User[]): void {
		this.confirm(users, 'user.enable', {
			title: this.many(users.length, 'bulkEnableTitle'),
			message: this.format.text('bulkEnableBody'),
			confirmLabel: this.many(users.length, 'bulkEnableConfirm'),
			confirmIcon: 'action.enable',
			destructive: false
		});
	}

	/**
	 * A change for everyone the filters match, not only the people on the page. The server
	 * checks each person first; the dialog says what would happen before anything changes.
	 */
	everyone(
		kind: 'enrol' | 'grant' | 'signOut' | 'disable' | 'enable',
		filter: AdministrationIntentOf<'createAcademicPreview'>['filter'],
		count: number,
		filters: string
	): void {
		const preview = (
			place: Pick<
				AdministrationIntentOf<'createAcademicPreview'>,
				'operation' | 'scopeType' | 'scopeId' | 'roleId'
			>,
			title: string,
			change: string,
			confirm: AdministrationText,
			icon:
				'action.invite' | 'admin.roles' | 'action.signOut' | 'action.end' | 'action.enable',
			destructive: boolean
		): void => {
			this.dialog.value = this.instantiationService.createInstance(FilterPreviewDialog, {
				create: { kind: 'createAcademicPreview', ...place, filter },
				matching: count,
				title,
				change,
				filters,
				confirmLabel: (people) => this.many(people, confirm),
				confirmIcon: icon,
				destructive,
				onDidCommit: () => this.onDidChange()
			});
		};
		if (kind === 'enrol' || kind === 'grant') {
			this.dialog.value = this.instantiationService.createInstance(
				BulkPlaceDialog,
				kind,
				[],
				() => Promise.resolve({ kind: 'error', reason: 'invalid' } as const),
				{
					count,
					choose: (place, where) =>
						kind === 'enrol'
							? preview(
									place,
									this.format.text('bulkEnrolEveryoneIn', { where }),
									this.format.text('bulkEnrolIn', { where }),
									'bulkEnrolConfirm',
									'action.invite',
									false
								)
							: preview(
									place,
									this.format.text('bulkGrantEveryone', { where }),
									this.format.text('bulkGrantRole', { where }),
									'bulkGrantConfirm',
									'admin.roles',
									false
								)
				}
			);
			return;
		}
		void readOnce(this.administration, {
			kind: 'institution'
		} as AdministrationIntentOf<'institution'>).then((institution) => {
			if (this._store.isDisposed) return;
			if (institution.kind === 'failure') {
				this.pane.toast(this.format.failure(institution.reason));
				return;
			}
			const place = {
				scopeType: 'institution' as const,
				scopeId: institution.value.id
			};
			if (kind === 'signOut')
				preview(
					{ ...place, operation: 'user_sessions.revoke' },
					this.format.text('bulkSignOutEveryone'),
					this.format.text('usersBulkSignOut'),
					'bulkSignOutConfirm',
					'action.signOut',
					true
				);
			else if (kind === 'disable')
				preview(
					{ ...place, operation: 'user.disable' },
					this.format.text('bulkDisableEveryone'),
					this.format.text('usersBulkDisable'),
					'bulkDisableConfirm',
					'action.end',
					true
				);
			else
				preview(
					{ ...place, operation: 'user.enable' },
					this.format.text('bulkEnableEveryone'),
					this.format.text('usersBulkEnable'),
					'bulkEnableConfirm',
					'action.enable',
					false
				);
		});
	}

	/** A message with a one-person form, `<key>One`. */
	private many(count: number, key: AdministrationText): string {
		return count === 1
			? this.format.text(`${key}One` as AdministrationText)
			: this.format.text(key, { count: this.format.count(count) });
	}

	private confirm(
		users: readonly User[],
		operation: 'user_sessions.revoke' | 'user.disable' | 'user.enable',
		text: {
			readonly title: string;
			readonly message: string;
			readonly confirmLabel: string;
			readonly confirmIcon: 'action.signOut' | 'action.end' | 'action.enable';
			readonly destructive: boolean;
		},
		listed = false
	): void {
		let outcome: AdminChangeResult | undefined;
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				...text,
				...(listed
					? {
							people: {
								label: this.format.text('bulkPeople'),
								chips: users.map((user) => ({
									id: user.id,
									label: user.displayName
								})),
								removeLabel: (chip: { readonly label: string }) =>
									this.format.text('bulkRemovePerson', { name: chip.label }),
								confirmLabel: (count: number) =>
									this.many(count, 'bulkDisableConfirm')
							}
						}
					: {}),
				run: async (ids) => {
					const chosen = listed ? users.filter((user) => ids.includes(user.id)) : users;
					const institution = await readOnce(this.administration, {
						kind: 'institution'
					} as AdministrationIntentOf<'institution'>);
					if (institution.kind === 'failure')
						return { kind: 'error', reason: institution.reason };
					outcome = await this.send(
						{
							kind: 'runAcademicBatch',
							operation,
							scopeType: 'institution',
							scopeId: institution.value.id,
							items: chosen.map((user, index) => ({
								key: `person-${index + 1}`,
								userId: user.id
							}))
						},
						[text.confirmLabel]
					);
					return outcome;
				},
				onDidComplete: (result) => this.report(result, users)
			},
			() => this.pane.focusPage()
		);
	}

	/** Sends one batch from a dialog and reports it once the dialog has closed. */
	private async run(batch: Batch, users: readonly User[]): Promise<AdminChangeResult> {
		const result = await this.send(batch, [this.many(users.length, 'bulkPeopleCount')]);
		if (result !== 'busy' && result.kind !== 'error')
			queueMicrotask(() => this.report(result, users));
		return result;
	}

	private send(batch: Batch, summary: readonly string[]): Promise<AdminChangeResult> {
		return this.changes.send(batch, summary);
	}

	private report(result: AdministrationResponse, users: readonly User[]): void {
		if (this._store.isDisposed) return;
		this.onDidChange();
		if (result.kind === 'error') {
			this.pane.toast(this.format.failure(result.reason));
			return;
		}
		if (result.kind !== 'batchResult' || result.result.failed === 0) {
			this.pane.toast(this.many(users.length, 'bulkResultAll'));
			return;
		}
		this.dialog.value = this.instantiationService.createInstance(
			BulkResultDialog,
			result.result,
			users
		);
	}
}

/**
 * Enrols the chosen people in one class, or grants them one role at the institution or in a
 * unit. The people are chips the administrator can remove before confirming.
 */
class BulkPlaceDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly people: AdminChips;
	private readonly unit: SelectControl<string>;
	private readonly target: SelectControl<string>;
	private readonly feedback: PageFeedback;
	private readonly cancel: ButtonControl;
	private readonly confirm: ButtonControl;
	private institutionId: string | undefined;
	private working = false;

	constructor(
		private readonly kind: 'enrol' | 'grant',
		private users: readonly User[],
		private readonly run: (batch: Batch, users: readonly User[]) => Promise<AdminChangeResult>,
		private readonly everyone: EveryoneChoice | undefined,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super();
		const enrol = kind === 'enrol';
		this.dialog = this._register(
			new PageDialog(pane, {
				title: this.titleText(),
				description: format.text(enrol ? 'bulkEnrolBody' : 'bulkGrantBody'),
				size: 'medium'
			})
		);
		const body = this.dialog.body;
		const peopleField = adminField(body, format.text('bulkPeople'));
		this.people = this._register(
			new AdminChips(peopleField.element, {
				label: format.text('bulkPeople'),
				removeLabel: (chip) => format.text('inviteRemove', { address: chip.label })
			})
		);
		this.people.set(users.map((user) => ({ id: user.id, label: user.displayName })));
		// For everyone matching, the server checks the people; this dialog only picks the place.
		peopleField.element.hidden = this.everyone !== undefined;
		this._register(
			this.people.onDidChange((chips) => {
				const kept = new Set(chips.map((chip) => chip.id));
				this.users = this.users.filter((user) => kept.has(user.id));
				this.update();
			})
		);
		const unitLabelText = format.text(enrol ? 'bulkUnit' : 'bulkWhere');
		this.unit = this.select(adminField(body, unitLabelText), unitLabelText);
		const targetLabel = format.text(enrol ? 'bulkClass' : 'bulkRole');
		this.target = this.select(adminField(body, targetLabel), targetLabel);
		if (enrol) this._register(this.unit.onDidChange((unit) => void this.loadClasses(unit)));
		else this._register(this.unit.onDidChange(() => this.update()));
		this._register(this.target.onDidChange(() => this.update()));
		this.feedback = this._register(new PageFeedback(body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: format.text('cancel')
			})
		);
		this.confirm = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: this.confirmText(),
				icon: proctorIconFactory(enrol ? 'action.invite' : 'admin.roles'),
				disabled: true
			})
		);
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.confirm.onDidRequest(() => void this.submit()));
		this.update();
		this.dialog.show(this.unit.select);
		void this.load();
	}

	private titleText(): string {
		if (this.everyone !== undefined)
			return this.format.text(
				this.kind === 'enrol' ? 'bulkEnrolEveryoneTitle' : 'bulkGrantEveryoneTitle'
			);
		const count = this.users.length;
		const key = this.kind === 'enrol' ? 'bulkEnrolTitle' : 'bulkGrantTitle';
		return count === 1
			? this.format.text(`${key}One`)
			: this.format.text(key, { count: this.format.count(count) });
	}

	private confirmText(): string {
		if (this.everyone !== undefined) return this.format.text('bulkCheckWho');
		const count = this.users.length;
		const key = this.kind === 'enrol' ? 'bulkEnrolConfirm' : 'bulkGrantConfirm';
		return count === 1
			? this.format.text(`${key}One`)
			: this.format.text(key, { count: this.format.count(count) });
	}

	private select(field: ReturnType<typeof adminField>, label: string): SelectControl<string> {
		return this._register(
			new SelectControl<string>(field.element, {
				label,
				choices: [{ value: NONE, label: this.format.text('inviteLoading') }],
				value: NONE,
				caret: proctorIconFactory('action.expand', 14),
				disabled: true
			})
		);
	}

	private fill(
		select: SelectControl<string>,
		choices: readonly SelectChoice<string>[] | undefined,
		failure?: string,
		value = NONE
	): void {
		if (choices === undefined) {
			select.setChoices(
				[{ value: NONE, label: this.format.failure(failure ?? 'unavailable') }],
				NONE
			);
			select.setDisabled(true);
			return;
		}
		const options =
			value === NONE
				? [{ value: NONE, label: this.format.text('inviteChoose') }, ...choices]
				: choices;
		select.setChoices(options, value);
		select.setDisabled(choices.length === 0);
	}

	private async load(): Promise<void> {
		const [units, roles, institution] = await Promise.all([
			readUnitTree(this.administration),
			this.kind === 'grant' ? readPages(this.administration, 'roles', {}) : undefined,
			readOnce(this.administration, {
				kind: 'institution'
			} as AdministrationIntentOf<'institution'>)
		]);
		if (this._store.isDisposed) return;
		if (institution.kind === 'data') this.institutionId = institution.value.id;
		const unitChoices =
			units.kind === 'data'
				? units.value.map((unit) => ({ value: unit.id, label: unitLabel(unit) }))
				: undefined;
		if (this.kind === 'enrol') {
			this.fill(this.unit, unitChoices, units.kind === 'failure' ? units.reason : undefined);
			this.fill(this.target, []);
		} else {
			this.fill(
				this.unit,
				[
					{ value: INSTITUTION, label: this.format.text('bulkWhereInstitution') },
					...(unitChoices ?? [])
				],
				undefined,
				INSTITUTION
			);
			this.fill(
				this.target,
				roles?.kind === 'data'
					? roles.value.items
							.filter((role) => role.archivedAt === undefined)
							.map((role) => ({ value: role.id, label: role.displayName }))
					: undefined,
				roles?.kind === 'failure' ? roles.reason : undefined
			);
		}
		this.update();
	}

	private async loadClasses(unitId: string): Promise<void> {
		this.update();
		if (unitId === NONE) {
			this.fill(this.target, []);
			return;
		}
		this.target.setChoices([{ value: NONE, label: this.format.text('inviteLoading') }], NONE);
		this.target.setDisabled(true);
		const classes = await readPages(this.administration, 'unitClasses', { unitId });
		if (this._store.isDisposed || this.unit.select.value !== unitId) return;
		this.fill(
			this.target,
			classes.kind === 'data'
				? classes.value.items
						.filter((klass) => klass.archivedAt === undefined)
						.map((klass) => ({ value: klass.id, label: klass.displayName }))
				: undefined,
			classes.kind === 'failure' ? classes.reason : undefined
		);
		this.update();
	}

	private batch(): Batch | undefined {
		const target = this.target.select.value;
		const where = this.unit.select.value;
		if ((this.users.length === 0 && this.everyone === undefined) || target === NONE)
			return undefined;
		const items = this.users.map((user, index) => ({
			key: `person-${index + 1}`,
			userId: user.id
		}));
		if (this.kind === 'enrol')
			return {
				kind: 'runAcademicBatch',
				operation: 'class.enroll',
				scopeType: 'class',
				scopeId: target,
				items
			};
		if (where === NONE || (where === INSTITUTION && this.institutionId === undefined))
			return undefined;
		return {
			kind: 'runAcademicBatch',
			operation: 'role_binding.create',
			scopeType: where === INSTITUTION ? 'institution' : 'academic_unit',
			scopeId: where === INSTITUTION ? this.institutionId! : where,
			items: items.map((item) => ({ ...item, roleId: target }))
		};
	}

	private update(): void {
		this.dialog.setFootnote(
			this.everyone !== undefined
				? this.format.text('previewBody', { count: this.format.count(this.everyone.count) })
				: this.users.length === 1
					? this.format.text('bulkPeopleCountOne')
					: this.format.text('bulkPeopleCount', {
							count: this.format.count(this.users.length)
						})
		);
		this.confirm.setState({
			label: this.confirmText(),
			icon: proctorIconFactory(this.kind === 'enrol' ? 'action.invite' : 'admin.roles'),
			disabled: this.working || this.batch() === undefined,
			busy: this.working
		});
	}

	private async submit(): Promise<void> {
		const batch = this.batch();
		if (batch === undefined || this.working) return;
		if (this.everyone !== undefined) {
			const target = this.target.select;
			const where = target.options[target.selectedIndex]?.textContent ?? '';
			const everyone = this.everyone;
			const roleId =
				batch.items[0]?.roleId ?? (this.kind === 'grant' ? target.value : undefined);
			this.dispose();
			everyone.choose(
				{
					operation:
						batch.operation as AdministrationIntentOf<'createAcademicPreview'>['operation'],
					scopeType: batch.scopeType,
					scopeId: batch.scopeId,
					...(roleId === undefined ? {} : { roleId })
				},
				where
			);
			return;
		}
		this.working = true;
		this.dialog.setClosable(false);
		this.feedback.set();
		this.cancel.setState({
			label: this.format.text('cancel'),
			disabled: true
		});
		this.update();
		const result = await this.run(batch, this.users);
		if (this._store.isDisposed) return;
		this.working = false;
		this.dialog.setClosable(true);
		this.cancel.setState({
			label: this.format.text('cancel')
		});
		this.update();
		if (result !== 'busy' && result.kind !== 'error') {
			this.dispose();
			return;
		}
		if (result !== 'busy' && result.reason === 'cancelled') return;
		this.feedback.set(
			result === 'busy' ? this.format.text('busy') : this.format.failure(result.reason),
			'error'
		);
	}

	private close(): void {
		if (this.working) return;
		this.dispose();
	}
}

/** Who a change for several people applied to, and why it didn't apply to the others. */
class BulkResultDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly icons = this._register(new DisposableStore());

	constructor(
		result: AdministrationBatchResult,
		users: readonly User[],
		@IAdministrationFormatService format: IAdministrationFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super();
		const done = result.succeeded + result.noOp;
		this.dialog = this._register(
			new PageDialog(pane, {
				title: format.text('bulkResultTitle', {
					done: format.count(done),
					count: format.count(users.length)
				}),
				description: format.text('bulkResultBody'),
				size: 'medium'
			})
		);
		const document = this.dialog.element.ownerDocument;
		const $ = createElementFactory(document);
		const byIndex = new Map(result.items.map((item) => [item.index, item]));
		// Those it didn't apply to come first.
		const ordered = users
			.map((user, index) => ({ user, item: byIndex.get(index) }))
			.sort(
				(a, b) => Number(a.item?.status !== 'failed') - Number(b.item?.status !== 'failed')
			);
		this.dialog.body.append(
			$(
				'ul.prctr-admin-bulk-results',
				{},
				...ordered.map(({ user, item }) => {
					const failed = item?.status === 'failed';
					const icon = this.icons.add(
						createProctorIcon(document, {
							id: failed ? 'status.attention' : 'status.success',
							size: 18,
							...(failed ? { filled: true } : {})
						})
					);
					const detail = failed
						? item?.errorCode === undefined
							? format.failure('unavailable')
							: format.code('problem', item.errorCode)
						: format.text(
								item?.status === 'no_op' ? 'bulkResultSame' : 'bulkResultDone'
							);
					return $(
						'li.prctr-admin-bulk-results__row',
						{ data: { failed: String(failed) } },
						$(
							'span.prctr-admin-bulk-results__glyph',
							{ attrs: { 'aria-hidden': 'true' } },
							icon.element
						),
						$(
							'span.prctr-admin-bulk-results__text',
							{},
							$('span.prctr-admin-bulk-results__name', {
								textContent: user.displayName
							}),
							$('span.prctr-admin-bulk-results__detail', { textContent: detail })
						)
					);
				})
			)
		);
		const close = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: format.text('bulkResultClose'),
				icon: proctorIconFactory('action.confirm')
			})
		);
		this._register(close.onDidRequest(() => this.dispose()));
		this._register(this.dialog.onDidRequestCancel(() => this.dispose()));
		this.dialog.show(close.element);
	}
}
