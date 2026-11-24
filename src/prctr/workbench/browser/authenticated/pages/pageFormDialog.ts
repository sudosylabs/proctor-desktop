/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { TextFieldControl } from '../../../../base/browser/ui/field/textField.js';
import {
	SelectControl,
	type SelectChoice
} from '../../../../base/browser/ui/select/selectControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import type { PageChanges } from './pageChanges.js';
import { changeFailureNeedsRead } from './pageConfirmation.js';
import { PageDialog } from './pageDialog.js';
import { PageFeedback } from './pageFeedback.js';
import { pageField, pageTextArea } from './pageForm.js';
import { IPageFormatService } from './pageFormat.js';
import { IPagePaneContext } from './pagePaneContext.js';

/** One field of a page form. */
export type PageFormField =
	| {
			readonly kind: 'text';
			readonly id: string;
			readonly label: string;
			readonly value?: string;
			readonly hint?: string;
			readonly required?: boolean;
			readonly inputMode?: HTMLInputElement['inputMode'];
	  }
	| {
			readonly kind: 'longText';
			readonly id: string;
			readonly label: string;
			readonly value?: string;
			readonly hint?: string;
			readonly required?: boolean;
	  }
	| {
			readonly kind: 'select';
			readonly id: string;
			readonly label: string;
			readonly choices: readonly SelectChoice<string>[];
			readonly value: string;
			readonly hint?: string;
	  }
	/** A calendar day, read as local midnight. */
	| {
			readonly kind: 'date';
			readonly id: string;
			readonly label: string;
			readonly value?: number;
			readonly hint?: string;
			readonly required?: boolean;
	  }
	| {
			readonly kind: 'check';
			readonly id: string;
			readonly label: string;
			readonly value?: boolean;
	  }
	/** Several choices at once, such as a role's permissions, grouped under headings. */
	| {
			readonly kind: 'checklist';
			readonly id: string;
			readonly label: string;
			readonly groups: readonly {
				readonly label: string;
				readonly choices: readonly SelectChoice<string>[];
			}[];
			readonly value: readonly string[];
			readonly hint?: string;
	  };

export type PageFormValues = Readonly<
	Record<string, string | number | boolean | readonly string[] | undefined>
>;

export interface PageFormOptions<I extends { readonly kind: string }, R> {
	readonly title: string;
	readonly description?: string;
	readonly fields: readonly PageFormField[];
	readonly confirmLabel: string;
	readonly confirmIcon: ProctorIconId;
	readonly destructive?: boolean;
	/** 560 pixels wide unless the form is short. */
	readonly size?: 'small' | 'medium' | 'large';
	/**
	 * Builds the change from the values, or names the field that needs fixing and why. Text
	 * values arrive trimmed; an empty optional field is undefined.
	 */
	submit(
		values: PageFormValues
	):
		| I
		| { readonly field: string; readonly error: string }
		| Promise<I | { readonly field: string; readonly error: string }>;
	/** What the change does, if the person must confirm it is them. */
	summary(values: PageFormValues): readonly string[];
	/** Called once the change succeeded, or failed in a way that needs a fresh read. */
	onDidComplete(result: R): void;
	/**
	 * Previews instead of changing: the dialog closes with the change it built, and the page
	 * shows its effect until the person applies or discards it.
	 */
	readonly preview?: (intent: I) => void;
}

interface FieldView {
	readonly spec: PageFormField;
	value(): string | number | boolean | readonly string[] | undefined;
	setError(error: string | undefined): void;
	focus(): void;
}

/**
 * A dialog that edits or creates one record from a few fields, then sends one change through
 * the page's change runner. A refused field shows its reason under it and the dialog stays open; a change that
 * needs a recent sign-in first asks the person to confirm it is them.
 */
export class PageFormDialog<
	I extends { readonly kind: string },
	R extends { readonly kind: string }
> extends Disposable {
	private readonly dialog: PageDialog;
	private readonly fields: FieldView[] = [];
	private readonly feedback: PageFeedback;
	private readonly cancel: ButtonControl;
	private readonly confirm: ButtonControl;
	private working = false;

	constructor(
		private readonly options: PageFormOptions<I, R>,
		private readonly changes: PageChanges<I, R>,
		@IPageFormatService private readonly format: IPageFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super();
		this._register(changes);
		this.dialog = this._register(
			new PageDialog(pane, {
				title: options.title,
				...(options.description === undefined ? {} : { description: options.description }),
				size: options.size ?? 'medium'
			})
		);
		for (const spec of options.fields) this.fields.push(this.createField(spec));
		this.feedback = this._register(new PageFeedback(this.dialog.body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: format.text('cancel')
			})
		);
		this.confirm = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: options.destructive === true ? 'danger' : 'brand',
				label: options.confirmLabel,
				icon: proctorIconFactory(options.confirmIcon)
			})
		);
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.confirm.onDidRequest(() => void this.submit()));
		const first = this.fields[0];
		this.dialog.show(this.confirm.element);
		first?.focus();
	}

	private createField(spec: PageFormField): FieldView {
		const host = this.dialog.body;
		const $ = createElementFactory(host.ownerDocument);
		switch (spec.kind) {
			case 'text': {
				const control = this._register(
					new TextFieldControl(host, {
						label: spec.label,
						value: spec.value ?? '',
						required: spec.required === true,
						...(spec.hint === undefined ? {} : { description: spec.hint }),
						...(spec.inputMode === undefined ? {} : { inputMode: spec.inputMode })
					})
				);
				let error: string | undefined;
				return {
					spec,
					value: () => control.input.value.trim() || undefined,
					setError: (next) => {
						error = next;
						control.setState({
							value: control.input.value,
							required: spec.required === true,
							...(error === undefined ? {} : { error })
						});
					},
					focus: () => control.input.focus()
				};
			}
			case 'longText': {
				const field = pageField(host, spec.label, spec.hint);
				const area = pageTextArea(field, 3);
				area.value = spec.value ?? '';
				area.required = spec.required === true;
				return {
					spec,
					value: () => area.value.trim() || undefined,
					setError: (error) => this.setHint(field.hint, area, spec.hint, error),
					focus: () => area.focus()
				};
			}
			case 'select': {
				const field = pageField(host, spec.label, spec.hint);
				const select = this._register(
					new SelectControl<string>(field.element, {
						label: spec.label,
						choices: spec.choices,
						value: spec.value,
						caret: proctorIconFactory('action.expand', 14)
					})
				);
				field.element.append(field.hint);
				return {
					spec,
					value: () => select.select.value || undefined,
					setError: (error) => this.setHint(field.hint, select.select, spec.hint, error),
					focus: () => select.focus()
				};
			}
			case 'date': {
				const field = pageField(host, spec.label, spec.hint);
				const input = $('input.prctr-page-form__date', {
					id: field.id,
					type: 'date',
					attrs: { 'aria-describedby': field.hint.id }
				});
				if (spec.value !== undefined) input.value = toDateValue(spec.value);
				input.required = spec.required === true;
				field.element.append(input, field.hint);
				return {
					spec,
					value: () => fromDateValue(input.value),
					setError: (error) => this.setHint(field.hint, input, spec.hint, error),
					focus: () => input.focus()
				};
			}
			case 'checklist': {
				const field = pageField(host, spec.label, spec.hint);
				const boxes: HTMLInputElement[] = [];
				const list = $('div.prctr-page-form__checklist', {
					attrs: { role: 'group', 'aria-labelledby': `${field.id}-label` }
				});
				field.element.querySelector('label')?.setAttribute('id', `${field.id}-label`);
				for (const group of spec.groups) {
					const items = group.choices.map((choice) => {
						const box = $('input.prctr-page-form__checkbox', {
							type: 'checkbox',
							value: choice.value
						});
						box.checked = spec.value.includes(choice.value);
						boxes.push(box);
						return $(
							'label.prctr-page-form__check',
							{},
							box,
							$('span', { textContent: choice.label })
						);
					});
					list.append(
						$(
							'fieldset.prctr-page-form__group',
							{},
							$('legend.prctr-page-form__group-title', { textContent: group.label }),
							...items
						)
					);
				}
				field.element.append(list, field.hint);
				return {
					spec,
					value: () => boxes.filter((box) => box.checked).map((box) => box.value),
					setError: (error) => this.setHint(field.hint, list, spec.hint, error),
					focus: () => boxes[0]?.focus()
				};
			}
			case 'check': {
				const input = $('input.prctr-page-form__checkbox', { type: 'checkbox' });
				input.checked = spec.value === true;
				const label = $(
					'label.prctr-page-form__check',
					{},
					input,
					$('span', { textContent: spec.label })
				);
				const holder = $('div.prctr-page-form', {}, label);
				host.append(holder);
				return {
					spec,
					value: () => input.checked,
					setError: (error) => {
						input.setAttribute('aria-invalid', String(error !== undefined));
						if (error !== undefined) this.feedback.set(error, 'error');
					},
					focus: () => input.focus()
				};
			}
		}
	}

	private setHint(
		hint: HTMLElement,
		control: HTMLElement,
		text: string | undefined,
		error: string | undefined
	): void {
		hint.textContent = error ?? text ?? '';
		hint.hidden = hint.textContent === '';
		hint.dataset.error = String(error !== undefined);
		control.setAttribute('aria-invalid', String(error !== undefined));
	}

	private values(): PageFormValues {
		const values: Record<string, string | number | boolean | readonly string[] | undefined> =
			{};
		for (const field of this.fields) values[field.spec.id] = field.value();
		return values;
	}

	private async submit(): Promise<void> {
		if (this.working) return;
		for (const field of this.fields) field.setError(undefined);
		this.feedback.set();
		const values = this.values();
		const missing = this.fields.find(
			(field) =>
				'required' in field.spec &&
				field.spec.required === true &&
				values[field.spec.id] === undefined
		);
		if (missing !== undefined) {
			missing.setError(this.format.text('fieldRequired'));
			missing.focus();
			return;
		}
		this.setWorking(true);
		const intent = await this.options.submit(values);
		if (this._store.isDisposed) return;
		if ('field' in intent) {
			this.setWorking(false);
			const field = this.fields.find((candidate) => candidate.spec.id === intent.field);
			field?.setError(intent.error);
			field?.focus();
			return;
		}
		if (this.options.preview !== undefined) {
			const preview = this.options.preview;
			this.dispose();
			preview(intent);
			return;
		}
		const result = await this.changes.send(intent, this.options.summary(values));
		if (this._store.isDisposed) return;
		this.setWorking(false);
		if (result === 'busy') {
			this.feedback.set(this.changes.describe(result), 'error');
			this.confirm.focus();
			return;
		}
		const failure = failureOf(result);
		if (failure === undefined || changeFailureNeedsRead(failure.reason)) {
			this.dispose();
			this.options.onDidComplete(result);
			return;
		}
		if (failure.reason === 'cancelled') return;
		if (failure.reason === 'invalid' && failure.fields !== undefined) {
			const fields = failure.fields;
			const named = this.fields.find((field) =>
				fields.some((name) => sameField(name, field.spec.id))
			);
			if (named !== undefined) {
				named.setError(this.format.text('fieldRefused'));
				named.focus();
				return;
			}
		}
		this.feedback.set(this.changes.describe(result), 'error');
		this.confirm.focus();
	}

	private setWorking(working: boolean): void {
		this.working = working;
		this.dialog.setClosable(!working);
		this.cancel.setState({
			label: this.format.text('cancel'),
			disabled: working
		});
		this.confirm.setState({
			label: this.options.confirmLabel,
			icon: proctorIconFactory(this.options.confirmIcon),
			busy: working
		});
	}

	private close(): void {
		if (this.working) return;
		this.dispose();
	}
}

/** A reply's failure reason and the request fields it names, or nothing for a success. */
function failureOf(result: {
	readonly kind: string;
}): { readonly reason: string; readonly fields?: readonly string[] } | undefined {
	if (result.kind !== 'error' || !('reason' in result) || typeof result.reason !== 'string')
		return undefined;
	const fields =
		'fields' in result && Array.isArray(result.fields)
			? (result.fields as readonly string[])
			: undefined;
	return fields === undefined ? { reason: result.reason } : { reason: result.reason, fields };
}

/** Whether a field the server named, such as `display_name`, is the form field `id`. */
function sameField(serverName: string, id: string): boolean {
	return serverName.replaceAll('_', '').toLowerCase() === id.toLowerCase();
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
