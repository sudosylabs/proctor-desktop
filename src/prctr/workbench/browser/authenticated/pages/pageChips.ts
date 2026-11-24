/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { createProctorIcon } from '../../../../platform/theme/browser/proctorIcon.js';
import './media/pageChips.css';

export interface PageChip {
	readonly id: string;
	readonly label: string;
	/** Why the entry can't be used; the chip shows it in red with this as its title. */
	readonly problem?: string;
}

export interface PageChipsOptions {
	/** The field's accessible name. */
	readonly label: string;
	/** The accessible name of a chip's ×, as in "Remove k.tanaka@…". */
	removeLabel(chip: PageChip): string;
	/** Lets the person add entries by typing: Enter, a comma or a space ends one; a paste is split. */
	readonly input?: {
		readonly placeholder: string;
		/** Turns typed text into chips; repeats of existing chips are left out by the owner. */
		parse(text: string): readonly PageChip[];
	};
	/** The id of the hint under the field, read with it. */
	readonly describedBy?: string;
}

/**
 * Entries shown as chips in one box, each removed with its ×, the standard way to edit a list of
 * addresses or people. With an input the person adds entries by typing or pasting a list.
 */
export class PageChips extends Disposable {
	readonly element: HTMLElement;
	private readonly list: HTMLElement;
	private readonly input: HTMLInputElement | undefined;
	private readonly chipStore = this._register(new DisposableStore());
	private entries: PageChip[] = [];
	private readonly changeEmitter = this._register(new Emitter<readonly PageChip[]>());
	readonly onDidChange: Event<readonly PageChip[]> = this.changeEmitter.event;

	constructor(
		host: HTMLElement,
		private readonly options: PageChipsOptions
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.list = $('ul.prctr-page-chips__list', { attrs: { 'aria-label': options.label } });
		this.element = $('div.prctr-page-chips', {}, this.list);
		if (options.input !== undefined) {
			const input = $('input.prctr-page-chips__input', {
				type: 'text',
				placeholder: options.input.placeholder,
				attrs: {
					'aria-label': options.label,
					autocomplete: 'off',
					spellcheck: 'false',
					...(options.describedBy === undefined
						? {}
						: { 'aria-describedby': options.describedBy })
				}
			});
			this.input = input;
			this.element.append(input);
			this._register(
				addDisposableListener(this.element, 'click', (event) => {
					if (event.target === this.element || event.target === this.list) input.focus();
				})
			);
			this._register(
				addDisposableListener(input, 'keydown', (event) => {
					if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
						if (input.value.trim() === '') {
							if (event.key !== 'Enter') event.preventDefault();
							return;
						}
						event.preventDefault();
						this.commit();
					} else if (event.key === 'Backspace' && input.value === '') {
						const last = this.entries.at(-1);
						if (last !== undefined) {
							event.preventDefault();
							this.remove(last.id, false);
						}
					}
				})
			);
			this._register(
				addDisposableListener(input, 'paste', (event) => {
					const text = event.clipboardData?.getData('text') ?? '';
					if (!/[\s,;]/u.test(text)) return;
					event.preventDefault();
					this.add(options.input!.parse(text));
				})
			);
			this._register(addDisposableListener(input, 'blur', () => this.commit()));
		}
		host.append(this.element);
	}

	get chips(): readonly PageChip[] {
		return this.entries;
	}

	/** What the person has typed but not yet turned into a chip. */
	get pending(): string {
		return this.input?.value.trim() ?? '';
	}

	set(chips: readonly PageChip[]): void {
		this.entries = [...chips];
		this.render();
		this.changeEmitter.fire(this.entries);
	}

	/** Turns the typed text into chips. */
	commit(): void {
		if (this.input === undefined || this.input.value.trim() === '') return;
		const text = this.input.value;
		this.input.value = '';
		this.add(this.options.input!.parse(text));
	}

	focus(): void {
		if (this.input !== undefined) this.input.focus();
		else this.list.querySelector<HTMLElement>('.prctr-page-chips__remove')?.focus();
	}

	setInvalid(invalid: boolean): void {
		this.element.dataset.invalid = String(invalid);
		this.input?.setAttribute('aria-invalid', String(invalid));
	}

	private add(chips: readonly PageChip[]): void {
		const known = new Set(this.entries.map((chip) => chip.id));
		const added = chips.filter((chip) => !known.has(chip.id) && known.add(chip.id));
		if (added.length === 0) return;
		this.entries.push(...added);
		this.render();
		this.changeEmitter.fire(this.entries);
	}

	private remove(id: string, keepFocus: boolean): void {
		const index = this.entries.findIndex((chip) => chip.id === id);
		if (index < 0) return;
		this.entries.splice(index, 1);
		this.render();
		this.changeEmitter.fire(this.entries);
		if (!keepFocus) return;
		// Focus moves to the chip that took its place, or to the input.
		const removes = this.list.querySelectorAll<HTMLElement>('.prctr-page-chips__remove');
		const next = removes[Math.min(index, removes.length - 1)];
		if (next !== undefined) next.focus();
		else this.focus();
	}

	private render(): void {
		this.chipStore.clear();
		const document = this.element.ownerDocument;
		const $ = createElementFactory(document);
		this.list.replaceChildren(
			...this.entries.map((chip) => {
				const remove = $('button.prctr-page-chips__remove', {
					type: 'button',
					title: this.options.removeLabel(chip),
					attrs: { 'aria-label': this.options.removeLabel(chip) }
				});
				remove.append(
					this.chipStore.add(
						createProctorIcon(document, { id: 'action.close', size: 12 })
					).element
				);
				this.chipStore.add(
					addDisposableListener(remove, 'click', () => this.remove(chip.id, true))
				);
				return $(
					'li.prctr-page-chips__chip',
					{
						data: { invalid: String(chip.problem !== undefined) },
						...(chip.problem === undefined ? {} : { title: chip.problem })
					},
					$('span.prctr-page-chips__label', { textContent: chip.label }),
					...(chip.problem === undefined
						? []
						: [$('span.prctr-page-chips__problem', { textContent: chip.problem })]),
					remove
				);
			})
		);
		this.list.hidden = this.entries.length === 0;
	}
}
