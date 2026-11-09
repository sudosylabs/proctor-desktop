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
import type { importModes } from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { PageSection } from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { AdminChanges } from '../widgets/adminChanges.js';
import { adminField } from '../widgets/adminForm.js';
import { readOnce, readPages, readUnitTree, unitLabel } from '../widgets/adminReads.js';
import './media/importsPage.css';

type Mode = (typeof importModes)[number];

export const IMPORT_MODE_TEXT: Readonly<Record<Mode | 'student_progression', AdministrationText>> =
	{
		student_class: 'importsModeStudents',
		teacher_academic_unit: 'importsModeTeachers',
		institution: 'importsModeInstitution',
		academic_administration: 'importsModeAdministration',
		student_progression: 'importsModeProgression'
	};

const NONE = '';
const MAXIMUM_BYTES = 10 * 1024 * 1024;

/**
 * Uploads a CSV file for one kind of onboarding. The server checks every row first; the
 * import's own page shows the result and imports only when the person chooses to.
 */
export class ImportsPage extends Disposable implements PageView {
	private readonly mode: SelectControl<Mode>;
	private readonly unit: SelectControl<string>;
	private readonly unitField: HTMLElement;
	private readonly klass: SelectControl<string>;
	private readonly classField: HTMLElement;
	private readonly role: SelectControl<string>;
	private readonly roleField: HTMLElement;
	private readonly fileInput: HTMLInputElement;
	private readonly fileName: HTMLElement;
	private readonly fileHint: HTMLElement;
	private readonly upload: ButtonControl;
	private readonly feedback: PageFeedback;
	private readonly changes: AdminChanges;
	private institutionId: string | undefined;
	private working = false;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		const section = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('importsUpload'),
				description: format.text('importsUploadDescription')
			})
		);
		section.setState({ kind: 'ready' }, false);
		const $ = createElementFactory(body.ownerDocument);
		const form = $('div.prctr-admin-import-form');
		section.content.append(form);

		const modeField = adminField(form, format.text('importsMode'));
		this.mode = this._register(
			new SelectControl<Mode>(modeField.element, {
				label: format.text('importsMode'),
				value: 'student_class',
				caret: proctorIconFactory('action.expand', 14),
				choices: (
					[
						'student_class',
						'teacher_academic_unit',
						'institution',
						'academic_administration'
					] as const
				).map((mode) => ({ value: mode, label: format.text(IMPORT_MODE_TEXT[mode]) }))
			})
		);
		this._register(this.mode.onDidChange(() => this.update()));

		const unitField = adminField(form, format.text('inviteUnit'));
		this.unitField = unitField.element;
		this.unit = this._register(this.picker(unitField.element, format.text('inviteUnit')));
		this._register(this.unit.onDidChange((unit) => void this.loadClasses(unit)));
		const classField = adminField(form, format.text('inviteClass'));
		this.classField = classField.element;
		this.klass = this._register(this.picker(classField.element, format.text('inviteClass')));
		this._register(this.klass.onDidChange(() => this.update()));
		const roleField = adminField(form, format.text('inviteRoleLabel'));
		this.roleField = roleField.element;
		this.role = this._register(this.picker(roleField.element, format.text('inviteRoleLabel')));
		this._register(this.role.onDidChange(() => this.update()));

		const fileField = adminField(
			form,
			format.text('importsFile'),
			format.text('importsFileHint')
		);
		this.fileInput = $('input.prctr-admin-import-form__file', {
			id: fileField.id,
			type: 'file',
			attrs: { accept: '.csv,text/csv', 'aria-describedby': fileField.hint.id }
		});
		this.fileName = $('span.prctr-admin-import-form__file-name', {
			textContent: format.text('importsNoFile')
		});
		const choose = this._register(
			new ButtonControl($('span.prctr-admin-import-form__file-row', {}), {
				variant: 'secondary',
				size: 'small',
				label: format.text('importsChooseFile'),
				icon: proctorIconFactory('object.file', 14)
			})
		);
		const fileRow = choose.element.parentElement!;
		fileRow.append(this.fileName);
		fileField.element.append(this.fileInput, fileRow, fileField.hint);
		this.fileHint = fileField.hint;
		this._register(choose.onDidRequest(() => this.fileInput.click()));
		this._register(
			addDisposableListener(this.fileInput, 'change', () => {
				const file = this.fileInput.files?.[0];
				this.fileName.textContent = file?.name ?? format.text('importsNoFile');
				this.update();
			})
		);

		this.feedback = this._register(new PageFeedback(form));
		const actions = $('div.prctr-admin-import-form__actions');
		form.append(actions);
		this.upload = this._register(
			new ButtonControl(actions, {
				variant: 'brand',
				label: format.text('importsUploadButton'),
				icon: proctorIconFactory('action.upload'),
				disabled: true
			})
		);
		this._register(this.upload.onDidRequest(() => void this.send()));
		this.update();
		void this.loadChoices();
	}

	setVisible(): void {}

	private picker(host: HTMLElement, label: string): SelectControl<string> {
		return new SelectControl<string>(host, {
			label,
			choices: [{ value: NONE, label: this.format.text('inviteLoading') }],
			value: NONE,
			caret: proctorIconFactory('action.expand', 14),
			disabled: true
		});
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

	private async loadChoices(): Promise<void> {
		const [units, roles, institution] = await Promise.all([
			readUnitTree(this.administration),
			readPages(this.administration, 'roles', {}),
			readOnce(this.administration, { kind: 'institution' })
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
						.filter((r) => r.archivedAt === undefined)
						.map((r) => ({ value: r.id, label: r.displayName }))
				: undefined,
			roles.kind === 'failure' ? roles.reason : undefined
		);
		this.fill(this.klass, []);
		this.update();
	}

	private async loadClasses(unitId: string): Promise<void> {
		this.update();
		if (unitId === NONE) return this.fill(this.klass, []);
		const classes = await readPages(this.administration, 'unitClasses', { unitId });
		if (this._store.isDisposed || this.unit.select.value !== unitId) return;
		this.fill(
			this.klass,
			classes.kind === 'data'
				? classes.value.items
						.filter((c) => c.archivedAt === undefined)
						.map((c) => ({ value: c.id, label: c.displayName }))
				: undefined,
			classes.kind === 'failure' ? classes.reason : undefined
		);
		this.update();
	}

	/** The scope the chosen mode imports into, when it is chosen. */
	private scope():
		| {
				readonly scopeType: 'institution' | 'academic_unit' | 'class';
				readonly scopeId: string;
		  }
		| undefined {
		const mode = this.mode.select.value as Mode;
		if (mode === 'student_class')
			return this.klass.select.value === NONE
				? undefined
				: { scopeType: 'class', scopeId: this.klass.select.value };
		if (mode === 'teacher_academic_unit')
			return this.unit.select.value === NONE
				? undefined
				: { scopeType: 'academic_unit', scopeId: this.unit.select.value };
		return this.institutionId === undefined
			? undefined
			: { scopeType: 'institution', scopeId: this.institutionId };
	}

	private update(): void {
		const mode = this.mode.select.value as Mode;
		this.unitField.hidden = mode !== 'student_class' && mode !== 'teacher_academic_unit';
		this.classField.hidden = mode !== 'student_class';
		this.roleField.hidden = mode !== 'teacher_academic_unit' && mode !== 'institution';
		const roleNeeded = mode === 'teacher_academic_unit';
		const ready =
			!this.working &&
			this.scope() !== undefined &&
			(!roleNeeded || this.role.select.value !== NONE) &&
			this.fileInput.files?.[0] !== undefined;
		this.upload.setState({
			label: this.format.text('importsUploadButton'),
			icon: proctorIconFactory('action.upload'),
			disabled: !ready,
			busy: this.working
		});
	}

	private setFileError(error: string | undefined): void {
		this.fileHint.textContent = error ?? this.format.text('importsFileHint');
		this.fileHint.dataset.error = String(error !== undefined);
	}

	private async send(): Promise<void> {
		const file = this.fileInput.files?.[0];
		const scope = this.scope();
		if (file === undefined || scope === undefined) {
			this.setFileError(
				file === undefined ? this.format.text('importsFileRequired') : undefined
			);
			return;
		}
		if (file.size > MAXIMUM_BYTES) {
			this.setFileError(this.format.text('importsFileTooLarge'));
			return;
		}
		this.setFileError(undefined);
		this.feedback.set();
		this.working = true;
		this.update();
		const csv = new Uint8Array(await file.arrayBuffer());
		if (this._store.isDisposed) return;
		const mode = this.mode.select.value as Mode;
		const roleId = this.role.select.value;
		const result = await this.changes.send(
			{
				kind: 'uploadImport',
				mode,
				...scope,
				...(roleId !== NONE && !this.roleField.hidden ? { roleId } : {}),
				csv
			},
			[file.name, this.format.text(IMPORT_MODE_TEXT[mode])]
		);
		if (this._store.isDisposed) return;
		this.working = false;
		this.update();
		if (result !== 'busy' && result.kind === 'created') {
			this.pane.toast(this.format.text('importsUploaded'));
			this.navigation.selectAdministrationPage('import', result.id);
			return;
		}
		if (result !== 'busy' && result.kind === 'error' && result.reason === 'cancelled') return;
		this.feedback.set(this.changes.describe(result) || this.format.failure('invalid'), 'error');
	}
}
