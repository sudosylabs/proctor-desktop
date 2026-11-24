/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { TextFieldControl } from '../../../../base/browser/ui/field/textField.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	toDisposable
} from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { readOnce } from './adminReads.js';
import './media/adminPersonFilter.css';

/** Typing settles for this long before people are searched. */
const SETTLE_MS = 300;
/** People listed for one search; a longer list asks for more of the name. */
const RESULTS = 10;

export interface AdminPerson {
	readonly id: string;
	readonly name: string;
}

export interface AdminPersonFilterOptions {
	/** What the filter is, as in "About" or "By". */
	readonly label: string;
	/** The filter's value while nobody is chosen, as in "Anyone". */
	readonly anyone: string;
	readonly icon: ProctorIconId;
	onChange(person: AdminPerson | undefined): void;
}

/**
 * A filter by one person, such as everything that happened to them: a button in the filter bar
 * that names the chosen person, and a dialog to find them by name, email or username.
 */
export class AdminPersonFilter extends Disposable {
	private readonly button: HTMLButtonElement;
	private readonly value: HTMLElement;
	private readonly dialog = this._register(new MutableDisposable<PersonPickerDialog>());
	private chosen: AdminPerson | undefined;

	constructor(
		host: HTMLElement,
		private readonly options: AdminPersonFilterOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		// A filter pill like the others in the bar: icon, the filter's name, its value, a caret.
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		const icon = this._register(proctorIconFactory(options.icon, 16)(document));
		const caret = this._register(proctorIconFactory('action.expand', 12)(document));
		this.value = $('span.prctr-admin-person-filter__value');
		this.button = $(
			'button.prctr-admin-person-filter',
			{ type: 'button', data: { part: 'pill' }, attrs: { 'aria-haspopup': 'dialog' } },
			icon.element,
			$('span.prctr-admin-person-filter__prefix', { textContent: options.label }),
			this.value,
			caret.element
		);
		host.append(this.button);
		this._register(addDisposableListener(this.button, 'click', () => this.open()));
		this.render();
	}

	private render(): void {
		this.value.textContent = this.chosen?.name ?? this.options.anyone;
		this.button.dataset.set = String(this.chosen !== undefined);
	}

	get person(): AdminPerson | undefined {
		return this.chosen;
	}

	/** Sets the person without reporting it, as a page showing a saved choice does. */
	setValue(person: AdminPerson | undefined): void {
		this.chosen = person;
		this.render();
	}

	private open(): void {
		this.dialog.value = this.instantiationService.createInstance(
			PersonPickerDialog,
			this.options,
			this.chosen !== undefined,
			(person) => {
				this.setValue(person);
				this.options.onChange(person);
				this.button.focus();
			}
		);
	}
}

class PersonPickerDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly results: HTMLElement;
	private readonly resultStore = this._register(new DisposableStore());
	private serial = 0;

	constructor(
		options: AdminPersonFilterOptions,
		chosen: boolean,
		private readonly choose: (person: AdminPerson | undefined) => void,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super();
		this.dialog = this._register(
			new PageDialog(pane, {
				title: format.text('personPickerTitle', { filter: options.label }),
				description: format.text('personPickerBody'),
				size: 'small'
			})
		);
		const $ = createElementFactory(this.dialog.element.ownerDocument);
		const field = this._register(
			new TextFieldControl(this.dialog.body, {
				label: format.text('personPickerFind'),
				value: ''
			})
		);
		this.results = $('ul.prctr-admin-person-filter__results', {
			attrs: { 'aria-label': format.text('personPickerResults'), 'aria-live': 'polite' }
		});
		this.dialog.body.append($('div.prctr-admin-person-filter', {}, this.results));
		const cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: format.text('cancel')
			})
		);
		if (chosen) {
			const anyone = this._register(
				new ButtonControl(this.dialog.actions, {
					variant: 'secondary',
					label: format.text('personPickerClear', { anyone: options.anyone }),
					icon: proctorIconFactory('action.reset')
				})
			);
			this._register(anyone.onDidRequest(() => this.pick(undefined)));
		}
		this._register(cancel.onDidRequest(() => this.dispose()));
		this._register(this.dialog.onDidRequestCancel(() => this.dispose()));
		let timer: ReturnType<typeof setTimeout> | undefined;
		this._register(toDisposable(() => clearTimeout(timer)));
		this._register(
			addDisposableListener(field.input, 'input', () => {
				clearTimeout(timer);
				timer = setTimeout(() => void this.search(field.input.value.trim()), SETTLE_MS);
			})
		);
		this.note(format.text('personPickerStart'));
		this.dialog.show(field.input);
	}

	private note(text: string): void {
		this.resultStore.clear();
		const $ = createElementFactory(this.results.ownerDocument);
		this.results.replaceChildren(
			$('li.prctr-admin-person-filter__note', { textContent: text })
		);
	}

	private async search(text: string): Promise<void> {
		const serial = ++this.serial;
		if (text.length < 2) {
			this.note(this.format.text('personPickerStart'));
			return;
		}
		const found = await readOnce(this.administration, {
			kind: 'users',
			q: text,
			includeDisabled: true,
			limit: RESULTS
		});
		if (this._store.isDisposed || serial !== this.serial) return;
		if (found.kind === 'failure') {
			this.note(this.format.failure(found.reason));
			return;
		}
		if (found.value.items.length === 0) {
			this.note(this.format.text('personPickerNone'));
			return;
		}
		this.resultStore.clear();
		const $ = createElementFactory(this.results.ownerDocument);
		this.results.replaceChildren(
			...found.value.items.map((user) => {
				const button = $(
					'button.prctr-admin-person-filter__person',
					{ type: 'button' },
					$('span.prctr-admin-person-filter__name', { textContent: user.displayName }),
					$('span.prctr-admin-person-filter__detail', {
						textContent: user.email ?? user.username
					})
				);
				this.resultStore.add(
					addDisposableListener(button, 'click', () =>
						this.pick({ id: user.id, name: user.displayName })
					)
				);
				return $('li', {}, button);
			}),
			...(found.value.cursor === undefined
				? []
				: [
						$('li.prctr-admin-person-filter__note', {
							textContent: this.format.text('personPickerMore')
						})
					])
		);
	}

	private pick(person: AdminPerson | undefined): void {
		this.dispose();
		this.choose(person);
	}
}
