/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	SelectControl,
	type SelectChoice
} from '../../../../base/browser/ui/select/selectControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { AdminChanges } from '../widgets/adminChanges.js';
import { adminField } from '../widgets/adminForm.js';
import { readPages, readUnitTree, unitLabel } from '../widgets/adminReads.js';

const NONE = '';

interface ClassChoice {
	readonly id: string;
	readonly name: string;
	readonly periodId: string;
}

/**
 * Starts a progression: the class students are in now, the class they move on to and the day
 * they move. The server checks who moves first; the review page opens with what it found.
 */
export class NewProgressionDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly unit: SelectControl<string>;
	private readonly from: SelectControl<string>;
	private readonly to: SelectControl<string>;
	private readonly toHint: HTMLElement;
	private readonly when: HTMLInputElement;
	private readonly feedback: PageFeedback;
	private readonly check: ButtonControl;
	private readonly cancel: ButtonControl;
	private readonly changes: AdminChanges;
	private classes: readonly ClassChoice[] = [];
	private working = false;

	constructor(
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		this.dialog = this._register(
			new PageDialog(pane, {
				title: format.text('newTitle'),
				description: format.text('newBody'),
				size: 'medium'
			})
		);
		const body = this.dialog.body;
		this.unit = this.select(adminField(body, format.text('newUnit')), format.text('newUnit'));
		this._register(this.unit.onDidChange((unit) => void this.loadClasses(unit)));
		this.from = this.select(adminField(body, format.text('newFrom')), format.text('newFrom'));
		const toField = adminField(body, format.text('newTo'), format.text('newToHint'));
		this.to = this.select(toField, format.text('newTo'));
		toField.element.append(toField.hint);
		this.toHint = toField.hint;
		this._register(this.from.onDidChange(() => this.update()));
		this._register(this.to.onDidChange(() => this.update()));
		const whenField = adminField(body, format.text('newWhen'), format.text('newWhenHint'));
		const $ = createElementFactory(body.ownerDocument);
		this.when = $('input.prctr-admin-form__date', {
			id: whenField.id,
			type: 'date',
			attrs: { 'aria-describedby': whenField.hint.id }
		});
		this.when.value = toDateValue(format.now());
		whenField.element.append(this.when, whenField.hint);
		this._register(addDisposableListener(this.when, 'input', () => this.update()));
		this.feedback = this._register(new PageFeedback(body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: format.text('cancel'),
				icon: proctorIconFactory('action.close')
			})
		);
		this.check = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: format.text('newCheck'),
				icon: proctorIconFactory('action.search'),
				disabled: true
			})
		);
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.check.onDidRequest(() => void this.submit()));
		this.dialog.show(this.unit.select);
		void this.loadUnits();
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
		failure?: string
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

	private async loadUnits(): Promise<void> {
		const units = await readUnitTree(this.administration);
		if (this._store.isDisposed) return;
		this.fill(
			this.unit,
			units.kind === 'data'
				? units.value.map((unit) => ({ value: unit.id, label: unitLabel(unit) }))
				: undefined,
			units.kind === 'failure' ? units.reason : undefined
		);
		this.fill(this.from, []);
		this.fill(this.to, []);
	}

	private async loadClasses(unitId: string): Promise<void> {
		this.classes = [];
		this.update();
		if (unitId === NONE) {
			this.fill(this.from, []);
			this.fill(this.to, []);
			return;
		}
		for (const select of [this.from, this.to]) {
			select.setChoices([{ value: NONE, label: this.format.text('inviteLoading') }], NONE);
			select.setDisabled(true);
		}
		const classes = await readPages(this.administration, 'unitClasses', { unitId });
		if (this._store.isDisposed || this.unit.select.value !== unitId) return;
		if (classes.kind === 'failure') {
			this.fill(this.from, undefined, classes.reason);
			this.fill(this.to, undefined, classes.reason);
			return;
		}
		this.classes = classes.value.items
			.filter((klass) => klass.archivedAt === undefined)
			.map((klass) => ({
				id: klass.id,
				name: klass.displayName,
				periodId: klass.academicPeriodId
			}));
		const choices = this.classes.map((klass) => ({ value: klass.id, label: klass.name }));
		this.fill(this.from, choices);
		this.fill(this.to, choices);
		this.update();
	}

	private update(): boolean {
		const from = this.from.select.value;
		const to = this.to.select.value;
		const same = from !== NONE && from === to;
		this.toHint.textContent = same
			? this.format.text('newSame')
			: this.format.text('newToHint');
		this.toHint.dataset.error = String(same);
		this.to.select.setAttribute('aria-invalid', String(same));
		const ready =
			!this.working &&
			from !== NONE &&
			to !== NONE &&
			!same &&
			fromDateValue(this.when.value) !== undefined;
		this.check.setState({
			label: this.format.text('newCheck'),
			icon: proctorIconFactory('action.search'),
			disabled: !ready,
			busy: this.working
		});
		return ready;
	}

	private async submit(): Promise<void> {
		if (!this.update()) return;
		const source = this.classes.find((klass) => klass.id === this.from.select.value);
		const destination = this.classes.find((klass) => klass.id === this.to.select.value);
		const effectiveAt = fromDateValue(this.when.value);
		if (source === undefined || destination === undefined || effectiveAt === undefined) return;
		this.working = true;
		this.feedback.set();
		this.cancel.setState({
			label: this.format.text('cancel'),
			icon: proctorIconFactory('action.close'),
			disabled: true
		});
		this.update();
		const result = await this.changes.send(
			{
				kind: 'checkProgression',
				sourceClassId: source.id,
				sourcePeriodId: source.periodId,
				destinationClassId: destination.id,
				destinationPeriodId: destination.periodId,
				effectiveAt
			},
			[
				this.format.text('progressionPair', {
					source: source.name,
					destination: destination.name
				})
			]
		);
		if (this._store.isDisposed) return;
		this.working = false;
		this.cancel.setState({
			label: this.format.text('cancel'),
			icon: proctorIconFactory('action.close')
		});
		this.update();
		if (result !== 'busy' && result.kind === 'created') {
			this.pane.toast(this.format.text('newChecking'));
			this.dispose();
			this.navigation.selectAdministrationPage('progressionReview', result.id);
			return;
		}
		if (result !== 'busy' && result.kind === 'error' && result.reason === 'cancelled') return;
		this.feedback.set(this.changes.describe(result), 'error');
	}

	private close(): void {
		if (this.working) return;
		this.dispose();
	}
}

function toDateValue(time: number): string {
	const date = new Date(time);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateValue(value: string): number | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
	if (match === null) return undefined;
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}
