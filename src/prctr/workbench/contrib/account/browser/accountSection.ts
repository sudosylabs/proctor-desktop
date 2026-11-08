/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import type { MenuEntry } from '../../../../base/browser/ui/menu/menuControl.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { AccountFeedback } from './accountFeedback.js';
import type { AccountPageServices } from './accountPageServices.js';
import type { AccountReadState } from './accountRead.js';

let sectionSequence = 0;

export interface AccountRowAction {
	readonly label: string;
	readonly icon: ProctorIconId;
	/** Last in the menu, after a separator, in red; it always opens a confirmation. */
	readonly destructive?: boolean;
	readonly enabled?: boolean;
	readonly run: () => void;
}

/** A status word at the end of a row, coloured only when it needs attention. */
export interface AccountRowStatus {
	readonly text: string;
	readonly icon: ProctorIconId;
	readonly tone: 'quiet' | 'success' | 'warning' | 'failure';
}

export interface AccountRowModel {
	readonly id: string;
	/** A small glyph saying what the row is, such as a laptop or a key. */
	readonly glyph: ProctorIconId;
	readonly title: string;
	readonly detail: string;
	readonly status?: AccountRowStatus;
	/** The row's one obvious action, shown as a button; all others go in its "⋯" menu. */
	readonly button?: AccountRowAction;
	readonly actions?: readonly AccountRowAction[];
}

/** A text action for a whole section, such as ending every other session. */
export interface AccountSectionAction {
	readonly label: string;
	readonly icon: ProctorIconId;
	readonly destructive?: boolean;
}

const SKELETON_ROWS = 3;

/**
 * One titled part of an Account page: its heading and description, a grouped list of rows,
 * and its own loading, slow, empty, failed and stale states. Sections read and fail
 * independently, and a failed refresh keeps the rows already shown.
 */
export class AccountSection extends Disposable {
	readonly element: HTMLElement;
	/** Holds section content other than rows, such as a definition list. */
	readonly content: HTMLElement;
	readonly feedback: AccountFeedback;

	private readonly heading: HTMLHeadingElement;
	private readonly card: HTMLElement;
	private readonly list: HTMLUListElement;
	private readonly skeleton: HTMLElement;
	private readonly state: HTMLElement;
	private readonly stateText: HTMLElement;
	private readonly stateIcon;
	private readonly note: HTMLElement;
	private readonly noteText: HTMLElement;
	private readonly noteIcon;
	private readonly retry: ButtonControl;
	private readonly noteRetry: ButtonControl;
	private readonly rowStore = this._register(new DisposableStore());
	private retryHandler: (() => void) | undefined;
	private readonly action: ButtonControl | undefined;
	private readonly actionEmitter = this._register(new Emitter<void>());
	/** The section's own action, beside its heading, was chosen. */
	readonly onDidRequestAction: Event<void> = this.actionEmitter.event;

	constructor(
		host: HTMLElement,
		private readonly services: AccountPageServices,
		options: {
			readonly title: string;
			readonly description?: string;
			readonly action?: AccountSectionAction;
		}
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		const id = `prctr-account-section-${++sectionSequence}`;
		this.heading = $('h2.prctr-account-section__title', {
			id,
			tabIndex: -1,
			textContent: options.title
		});
		const heading = $('div.prctr-account-section__heading', {}, this.heading);
		if (options.description)
			heading.append(
				$('p.prctr-account-section__description', { textContent: options.description })
			);
		const header = $('div.prctr-account-section__header', {}, heading);
		if (options.action !== undefined) {
			this.action = this._register(
				new ButtonControl(header, {
					variant: options.action.destructive ? 'dangerGhost' : 'ghost',
					size: 'small',
					label: options.action.label,
					icon: proctorIconFactory(options.action.icon, 16)
				})
			);
			this.action.element.hidden = true;
			this._register(this.action.onDidRequest(() => this.actionEmitter.fire()));
		}

		this.noteIcon = this._register(
			createProctorIcon(document, { id: 'status.time', size: 16 })
		);
		this.noteText = $('span.prctr-account-section__note-text');
		this.note = $(
			'div.prctr-account-section__note',
			{ hidden: true, attrs: { role: 'status' } },
			this.noteIcon.element,
			this.noteText
		);
		this.noteRetry = this._register(
			new ButtonControl(this.note, {
				variant: 'secondary',
				size: 'small',
				label: services.text('retry'),
				icon: proctorIconFactory('action.retry', 14)
			})
		);

		this.skeleton = $('div.prctr-account-section__skeleton', {
			attrs: { 'aria-hidden': 'true' }
		});
		for (let index = 0; index < SKELETON_ROWS; index++)
			this.skeleton.append(
				$(
					'div.prctr-account-section__skeleton-row',
					{},
					$('span.prctr-account-section__skeleton-glyph'),
					$(
						'span.prctr-account-section__skeleton-text',
						{},
						$('span.prctr-account-section__skeleton-bar'),
						$('span.prctr-account-section__skeleton-bar')
					)
				)
			);
		this.stateIcon = this._register(
			createProctorIcon(document, { id: 'status.attention', size: 18 })
		);
		this.stateText = $('span.prctr-account-section__state-text');
		this.state = $(
			'div.prctr-account-section__state',
			{},
			this.stateIcon.element,
			this.stateText
		);
		this.retry = this._register(
			new ButtonControl(this.state, {
				variant: 'secondary',
				size: 'small',
				label: services.text('retry'),
				icon: proctorIconFactory('action.retry', 14)
			})
		);
		this.list = $('ul.prctr-account-section__rows', { attrs: { 'aria-labelledby': id } });
		this.content = $('div.prctr-account-section__content');
		this.card = $(
			'div.prctr-account-section__card',
			{},
			this.content,
			this.list,
			this.skeleton,
			this.state
		);
		this.element = $(
			'section.prctr-account-section',
			{ attrs: { 'aria-labelledby': id } },
			header,
			this.note,
			this.card
		);
		this.feedback = this._register(new AccountFeedback(this.element));
		host.append(this.element);
		this._register(this.retry.onDidRequest(() => this.retryHandler?.()));
		this._register(this.noteRetry.onDidRequest(() => this.retryHandler?.()));
		this.setState({ kind: 'loading' }, false);
	}

	set hidden(hidden: boolean) {
		this.element.hidden = hidden;
	}

	/** Shows the section action only when it applies, and disables it while it cannot run. */
	setAction(visible: boolean, enabled = true): void {
		if (this.action === undefined) return;
		this.action.element.hidden = !visible;
		this.action.element.disabled = !enabled;
	}

	focusAction(): boolean {
		if (this.action === undefined || this.action.element.hidden) return false;
		this.action.focus();
		return true;
	}

	focusHeading(): void {
		this.heading.focus();
	}

	/**
	 * Presents a read state. `empty` applies only when the read is ready; a failed, slow or
	 * stale state offers a retry that calls `retry`.
	 */
	setState(state: AccountReadState, empty: string | false, retry?: () => void): void {
		this.retryHandler = retry;
		this.element.setAttribute('aria-busy', String(state.kind === 'loading'));
		this.element.dataset.state = state.kind;
		this.note.hidden = true;
		this.state.hidden = true;
		this.skeleton.hidden = state.kind !== 'loading';
		if (state.kind === 'loading') {
			this.clearRows();
			if (state.slow === true)
				this.showNote(
					'status.time',
					this.services.institutionText('stillWaiting', 'stillWaitingGeneric')
				);
			return;
		}
		if (state.kind === 'failed') {
			this.clearRows();
			this.showState(
				'failure',
				this.services.text('loadFailed', { reason: this.services.failure(state.reason) })
			);
			return;
		}
		if (state.kind === 'stale') {
			this.showNote(
				'status.offline',
				this.services.text('staleData', { reason: this.services.failure(state.reason) })
			);
			return;
		}
		if (empty !== false) this.showState('empty', empty);
	}

	setRows(rows: readonly AccountRowModel[]): void {
		const document = this.element.ownerDocument;
		// A row whose actions button had focus keeps it when the list is redrawn.
		const focused =
			document.activeElement instanceof HTMLElement &&
			this.list.contains(document.activeElement)
				? document.activeElement.closest<HTMLElement>('[data-row-id]')?.dataset.rowId
				: undefined;
		this.clearRows();
		const $ = createElementFactory(document);
		for (const row of rows) this.list.append(this.createRow($, row));
		this.list.hidden = rows.length === 0;
		this.card.toggleAttribute('data-rows', rows.length > 0);
		if (focused !== undefined && !this.focusRow(focused)) this.focusHeading();
	}

	/** Moves focus to a row's actions button after its menu or dialog closed. */
	focusRow(id: string): boolean {
		const button = this.list.querySelector<HTMLElement>(
			`[data-row-id="${CSS.escape(id)}"] .prctr-account-row__more, [data-row-id="${CSS.escape(id)}"] .prctr-button`
		);
		button?.focus();
		return button !== null;
	}

	private clearRows(): void {
		this.rowStore.clear();
		this.list.replaceChildren();
		this.list.hidden = true;
		this.card.removeAttribute('data-rows');
	}

	private showNote(icon: ProctorIconId, text: string): void {
		this.note.hidden = false;
		this.noteIcon.setState({ id: icon, size: 16 });
		this.noteText.textContent = text;
	}

	private showState(kind: 'failure' | 'empty', text: string): void {
		this.state.hidden = false;
		this.state.dataset.kind = kind;
		this.stateText.textContent = text;
		this.retry.element.hidden = kind !== 'failure';
		this.stateIcon.element.hidden = kind === 'empty';
	}

	private createRow(
		$: ReturnType<typeof createElementFactory>,
		row: AccountRowModel
	): HTMLLIElement {
		const document = this.element.ownerDocument;
		const glyph = this.rowStore.add(createProctorIcon(document, { id: row.glyph, size: 18 }));
		glyph.element.classList.add('prctr-account-row__glyph');
		const text = $(
			'span.prctr-account-row__text',
			{},
			$('span.prctr-account-row__title', { textContent: row.title }),
			$('span.prctr-account-row__detail', { textContent: row.detail })
		);
		const item = $('li.prctr-account-row', { data: { rowId: row.id } }, glyph.element, text);
		if (row.status !== undefined) {
			const icon = this.rowStore.add(
				createProctorIcon(document, { id: row.status.icon, size: 14 })
			);
			item.append(
				$(
					'span.prctr-account-row__status',
					{ data: { tone: row.status.tone } },
					icon.element,
					row.status.text
				)
			);
		}
		if (row.button !== undefined) {
			const action = row.button;
			const button = this.rowStore.add(
				new ButtonControl(item, {
					variant: 'secondary',
					size: 'small',
					label: action.label,
					icon: proctorIconFactory(action.icon, 14),
					disabled: action.enabled === false
				})
			);
			this.rowStore.add(button.onDidRequest(() => action.run()));
		}
		const actions = row.actions ?? [];
		if (actions.length > 0) item.append(this.createMenuButton($, row.title, actions));
		return item;
	}

	private createMenuButton(
		$: ReturnType<typeof createElementFactory>,
		name: string,
		actions: readonly AccountRowAction[]
	): HTMLButtonElement {
		const label = this.services.text('rowActions', { name });
		const button = $('button.prctr-account-row__more', {
			type: 'button',
			title: label,
			attrs: { 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }
		});
		button.append(
			this.rowStore.add(
				createProctorIcon(button.ownerDocument, { id: 'action.more', size: 18 })
			).element
		);
		// Destructive entries come last, after a separator.
		const ordered = [
			...actions.filter((action) => action.destructive !== true),
			...actions.filter((action) => action.destructive === true)
		];
		const firstDestructive = ordered.findIndex((action) => action.destructive === true);
		const entries: MenuEntry[] = ordered.map((action, index) => ({
			label: action.label,
			icon: proctorIconFactory(action.icon, 16),
			destructive: action.destructive === true,
			separatorBefore: index > 0 && index === firstDestructive,
			enabled: action.enabled !== false,
			run: action.run
		}));
		const open = (): void => {
			this.services.menu.show(button, entries, label);
			if (!this.services.menu.visible) return;
			button.setAttribute('aria-expanded', 'true');
			const store = this.rowStore.add(new DisposableStore());
			store.add(
				this.services.menu.onDidChangeVisibility((visible) => {
					if (visible) return;
					button.setAttribute('aria-expanded', 'false');
					this.rowStore.delete(store);
				})
			);
		};
		this.rowStore.add(addDisposableListener(button, 'click', open));
		this.rowStore.add(
			addDisposableListener(button, 'keydown', (event) => {
				if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
				event.preventDefault();
				open();
			})
		);
		return button;
	}
}
