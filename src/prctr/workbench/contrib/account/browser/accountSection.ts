/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import type { MenuEntry } from '../../../../base/browser/ui/menu/menuControl.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import type { StatusShape } from '../common/accountPresentation.js';
import { AccountFeedback } from './accountFeedback.js';
import type { AccountPageServices } from './accountPageServices.js';
import type { AccountReadState } from './accountRead.js';

let sectionSequence = 0;

export interface AccountRowAction {
	readonly label: string;
	readonly destructive?: boolean;
	readonly enabled?: boolean;
	readonly run: () => void;
}

export interface AccountRowModel {
	readonly id: string;
	readonly title: string;
	readonly detail: string;
	readonly shape: StatusShape;
	readonly tag?: string;
	readonly actions?: readonly AccountRowAction[];
}

/**
 * One titled part of an Account page: its heading and description, a list of
 * rows, and its own loading, empty, failed and stale states. Sections read and
 * fail independently, and a failed refresh keeps the rows already shown.
 */
export class AccountSection extends Disposable {
	readonly element: HTMLElement;
	/** Holds section content other than rows, such as a definition list. */
	readonly content: HTMLElement;
	readonly feedback: AccountFeedback;

	private readonly heading: HTMLHeadingElement;
	private readonly state: HTMLElement;
	private readonly stateText: HTMLElement;
	private readonly stateIcon;
	private readonly retry: ButtonControl;
	private readonly list: HTMLUListElement;
	private readonly rowStore = this._register(new DisposableStore());
	private retryHandler: (() => void) | undefined;

	constructor(
		host: HTMLElement,
		private readonly services: AccountPageServices,
		options: { readonly title: string; readonly description?: string }
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
		const header = $('div.prctr-account-section__header', {}, this.heading);
		if (options.description !== undefined)
			header.append(
				$('p.prctr-account-section__description', { textContent: options.description })
			);
		this.stateIcon = this._register(createSemanticIcon(document, { id: 'state.info' }));
		this.stateText = $('span.prctr-account-section__state-text');
		this.state = $(
			'div.prctr-account-section__state',
			{},
			this.stateIcon.element,
			this.stateText
		);
		this.retry = this._register(
			new ButtonControl(this.state, { variant: 'secondary', label: services.text('retry') })
		);
		this.list = $('ul.prctr-account-section__rows', { attrs: { 'aria-labelledby': id } });
		this.content = $('div.prctr-account-section__content');
		this.element = $(
			'section.prctr-account-section',
			{ attrs: { 'aria-labelledby': id } },
			header,
			this.content,
			this.list,
			this.state
		);
		this.feedback = this._register(new AccountFeedback(this.element));
		host.append(this.element);
		this._register(this.retry.onDidRequest(() => this.retryHandler?.()));
		this.setState({ kind: 'loading' }, false);
	}

	set hidden(hidden: boolean) {
		this.element.hidden = hidden;
	}

	focusHeading(): void {
		this.heading.focus();
	}

	/**
	 * Presents a read state. `empty` applies only when the read is ready; a failed or
	 * stale state offers a retry that calls `retry`.
	 */
	setState(state: AccountReadState, empty: string | false, retry?: () => void): void {
		this.retryHandler = retry;
		this.element.setAttribute('aria-busy', String(state.kind === 'loading'));
		this.element.dataset.state = state.kind;
		if (state.kind === 'loading') {
			this.showState('loading', this.services.text('loading'));
			return;
		}
		if (state.kind === 'failed') {
			this.clearRows();
			this.showState(
				'error',
				this.services.text('loadFailed', { reason: this.services.failure(state.reason) })
			);
			return;
		}
		if (state.kind === 'stale') {
			this.showState(
				'stale',
				this.services.text('staleData', { reason: this.services.failure(state.reason) })
			);
			return;
		}
		if (empty !== false) this.showState('empty', empty);
		else this.state.hidden = true;
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
		if (focused !== undefined && !this.focusRow(focused)) this.focusHeading();
	}

	/** Moves focus to a row's actions button after its menu or dialog closed. */
	focusRow(id: string): boolean {
		const button = this.list.querySelector<HTMLElement>(
			`[data-row-id="${CSS.escape(id)}"] .prctr-account-row__more`
		);
		button?.focus();
		return button !== null;
	}

	private clearRows(): void {
		this.rowStore.clear();
		this.list.replaceChildren();
		this.list.hidden = true;
	}

	private showState(kind: 'loading' | 'error' | 'stale' | 'empty', text: string): void {
		this.state.hidden = false;
		this.state.dataset.kind = kind;
		this.stateText.textContent = text;
		this.retry.element.hidden = kind !== 'error' && kind !== 'stale';
		this.stateIcon.setState(
			kind === 'loading'
				? { id: 'state.loading', modifier: 'spin' }
				: { id: kind === 'empty' ? 'state.info' : 'state.warning' }
		);
		this.stateIcon.element.hidden = kind === 'empty';
	}

	private createRow(
		$: ReturnType<typeof createElementFactory>,
		row: AccountRowModel
	): HTMLLIElement {
		const title = $('span.prctr-account-row__title', { textContent: row.title });
		const heading = $('span.prctr-account-row__heading', {}, title);
		if (row.tag !== undefined)
			heading.append($('span.prctr-account-row__tag', { textContent: row.tag }));
		const text = $(
			'span.prctr-account-row__text',
			{},
			heading,
			$('span.prctr-account-row__detail', { textContent: row.detail })
		);
		const item = $(
			'li.prctr-account-row',
			{ data: { rowId: row.id } },
			$('span.prctr-account-row__status', {
				data: { shape: row.shape },
				attrs: { 'aria-hidden': 'true' }
			}),
			text
		);
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
			attrs: { 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }
		});
		button.append(
			this.rowStore.add(
				createSemanticIcon(button.ownerDocument, { id: 'action.more', size: 16 })
			).element
		);
		const entries: MenuEntry[] = actions.map((action) => ({
			label: action.label,
			destructive: action.destructive === true,
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
