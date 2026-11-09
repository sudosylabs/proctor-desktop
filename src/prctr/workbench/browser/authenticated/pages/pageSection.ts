/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticatedHoverService } from '../authenticatedHover.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { PagerControl } from '../../../../base/browser/ui/pager/pagerControl.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import type { MenuEntry } from '../../../../base/browser/ui/menu/menuControl.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { IPageFormatService } from './pageFormat.js';
import { PageFeedback } from './pageFeedback.js';
import { IPagePaneContext } from './pagePaneContext.js';
import type { PageReadState } from './pageRead.js';
import './media/pageSection.css';

let sectionSequence = 0;

export interface PageRowAction {
	readonly label: string;
	readonly icon: ProctorIconId;
	/** Last in the menu, after a separator, in red; it always opens a confirmation. */
	readonly destructive?: boolean;
	readonly enabled?: boolean;
	readonly run: () => void;
}

/** Chips shown before the rest collapse into "+N". */
const VISIBLE_CHIPS = 3;
/** Rows on one page of a section; a longer list gets a pager at the foot of its card. */
export const PAGE_SECTION_SIZE = 10;

/** A status word at the end of a row, coloured only when it needs attention. */
export interface PageRowStatus {
	readonly text: string;
	readonly icon: ProctorIconId;
	readonly tone: 'quiet' | 'success' | 'warning' | 'failure';
}

export interface PageRowModel {
	readonly id: string;
	/** A small glyph saying what the row is, such as a laptop or a key. */
	readonly glyph: ProctorIconId;
	readonly title: string;
	/** Short labels under the title, such as a token's permissions; the first few show. */
	readonly chips?: readonly string[];
	readonly detail: string;
	readonly status?: PageRowStatus;
	/** The row's one obvious action, shown as a button; all others go in its "⋯" menu. */
	readonly button?: PageRowAction;
	readonly actions?: readonly PageRowAction[];
}

/** A text action for a whole section, such as ending every other session. */
export interface PageSectionAction {
	readonly label: string;
	readonly icon: ProctorIconId;
	readonly destructive?: boolean;
}

/** An empty section: an optional title, one sentence, and optionally the action that fills it. */
export interface PageEmpty {
	readonly title?: string;
	readonly text: string;
	readonly action?: { readonly label: string; readonly icon: ProctorIconId; run(): void };
}

const SKELETON_ROWS = 3;

/**
 * One titled part of a page: its heading and description, a grouped list of rows,
 * and its own loading, slow, empty, failed and stale states. Sections read and fail
 * independently, and a failed refresh keeps the rows already shown.
 */
export class PageSection extends Disposable {
	readonly element: HTMLElement;
	/** Holds section content other than rows, such as a definition list. */
	readonly content: HTMLElement;
	/** The foot of the card, for a pager its owner drives, such as one the server pages. */
	readonly footer: HTMLElement;
	readonly feedback: PageFeedback;

	private readonly heading: HTMLHeadingElement;
	private readonly description: HTMLElement;
	private readonly stateTitle: HTMLElement;
	private readonly emptyAction: ButtonControl;
	private emptyRun: (() => void) | undefined;
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
	private readonly pager: PagerControl;
	private allRows: readonly PageRowModel[] = [];
	private page = 1;
	private retryHandler: (() => void) | undefined;
	private readonly action: ButtonControl | undefined;
	private readonly actionEmitter = this._register(new Emitter<void>());
	/** The section's own action, beside its heading, was chosen. */
	readonly onDidRequestAction: Event<void> = this.actionEmitter.event;

	constructor(
		host: HTMLElement,
		options: {
			readonly title: string;
			readonly description?: string;
			readonly action?: PageSectionAction;
		},
		@IPageFormatService private readonly format: IPageFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IAuthenticatedHoverService private readonly hover: IAuthenticatedHoverService
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		const id = `prctr-page-section-${++sectionSequence}`;
		this.heading = $('h2.prctr-page-section__title', {
			id,
			tabIndex: -1,
			textContent: options.title
		});
		this.description = $('p.prctr-page-section__description', {
			hidden: !options.description,
			textContent: options.description ?? ''
		});
		const heading = $('div.prctr-page-section__heading', {}, this.heading, this.description);
		const header = $('div.prctr-page-section__header', {}, heading);
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
		this.noteText = $('span.prctr-page-section__note-text');
		this.note = $(
			'div.prctr-page-section__note',
			{ hidden: true, attrs: { role: 'status' } },
			this.noteIcon.element,
			this.noteText
		);
		this.noteRetry = this._register(
			new ButtonControl(this.note, {
				variant: 'secondary',
				size: 'small',
				label: this.format.text('retry'),
				icon: proctorIconFactory('action.retry', 14)
			})
		);

		this.skeleton = $('div.prctr-page-section__skeleton', {
			attrs: { 'aria-hidden': 'true' }
		});
		for (let index = 0; index < SKELETON_ROWS; index++)
			this.skeleton.append(
				$(
					'div.prctr-page-section__skeleton-row',
					{},
					$('span.prctr-page-section__skeleton-glyph'),
					$(
						'span.prctr-page-section__skeleton-text',
						{},
						$('span.prctr-page-section__skeleton-bar'),
						$('span.prctr-page-section__skeleton-bar')
					)
				)
			);
		this.stateIcon = this._register(
			createProctorIcon(document, { id: 'status.attention', size: 18 })
		);
		this.stateTitle = $('strong.prctr-page-section__state-title', { hidden: true });
		this.stateText = $('span.prctr-page-section__state-text');
		this.state = $(
			'div.prctr-page-section__state',
			{},
			this.stateIcon.element,
			$('span.prctr-page-section__state-body', {}, this.stateTitle, this.stateText)
		);
		this.retry = this._register(
			new ButtonControl(this.state, {
				variant: 'secondary',
				size: 'small',
				label: this.format.text('retry'),
				icon: proctorIconFactory('action.retry', 14)
			})
		);
		this.emptyAction = this._register(
			new ButtonControl(this.state, {
				variant: 'secondary',
				size: 'small',
				label: '',
				icon: proctorIconFactory('action.add', 14)
			})
		);
		this.emptyAction.element.hidden = true;
		this._register(this.emptyAction.onDidRequest(() => this.emptyRun?.()));
		this.list = $('ul.prctr-page-section__rows', { attrs: { 'aria-labelledby': id } });
		this.content = $('div.prctr-page-section__content');
		this.card = $(
			'div.prctr-page-section__card',
			{},
			this.content,
			this.list,
			this.skeleton,
			this.state
		);
		this.pager = this._register(
			new PagerControl(this.card, {
				labels: this.format.pagerLabels(options.title),
				previousIcon: proctorIconFactory('action.back', 14),
				nextIcon: proctorIconFactory('action.forward', 14)
			})
		);
		this.pager.element.hidden = true;
		this._register(this.pager.onDidRequestPage((page) => this.showPage(page)));
		this.footer = $('div.prctr-page-section__footer');
		this.card.append(this.footer);
		// A section without a title or action, such as a page's only table, shows no header.
		header.hidden = !options.title && options.action === undefined;
		this.element = $(
			'section.prctr-page-section',
			{ attrs: { 'aria-labelledby': id } },
			header,
			this.note,
			this.card
		);
		this.feedback = this._register(new PageFeedback(this.element));
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

	/** Renames the section, such as when an empty page folds two sections into one. */
	setHeading(title: string, description?: string): void {
		this.heading.textContent = title;
		this.description.textContent = description ?? '';
		this.description.hidden = !description;
	}

	focusHeading(): void {
		this.heading.focus();
	}

	/**
	 * Presents a read state. `empty` applies only when the read is ready; a failed, slow or
	 * stale state offers a retry that calls `retry`.
	 */
	setState(state: PageReadState, empty: string | PageEmpty | false, retry?: () => void): void {
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
					this.format.institutionText('stillWaiting', 'stillWaitingGeneric')
				);
			return;
		}
		if (state.kind === 'failed') {
			this.clearRows();
			this.showState('failure', {
				text: this.format.text('loadFailed', {
					reason: this.pane.describeFailure(state.reason)
				})
			});
			return;
		}
		if (state.kind === 'stale') {
			this.showNote(
				'status.offline',
				this.format.text('staleData', { reason: this.pane.describeFailure(state.reason) })
			);
			return;
		}
		if (empty !== false)
			this.showState('empty', typeof empty === 'string' ? { text: empty } : empty);
	}

	setRows(rows: readonly PageRowModel[]): void {
		this.allRows = rows;
		this.page = Math.min(this.page, Math.max(1, Math.ceil(rows.length / PAGE_SECTION_SIZE)));
		this.renderRows();
	}

	/** Shows another page, puts focus on its first row and says where the reader is. */
	private showPage(page: number): void {
		this.page = page;
		this.renderRows();
		const first = this.list.querySelector<HTMLElement>(
			'.prctr-page-row__chip-more, .prctr-button, .prctr-page-row__more'
		);
		if (first !== null) first.focus();
		else this.focusHeading();
		const start = (page - 1) * PAGE_SECTION_SIZE;
		this.pane.announce(
			this.format.text('pageShown', {
				page,
				count: Math.ceil(this.allRows.length / PAGE_SECTION_SIZE),
				first: start + 1,
				last: Math.min(start + PAGE_SECTION_SIZE, this.allRows.length)
			})
		);
	}

	private renderRows(): void {
		const all = this.allRows;
		const start = (this.page - 1) * PAGE_SECTION_SIZE;
		const rows = all.slice(start, start + PAGE_SECTION_SIZE);
		this.pager.element.hidden = all.length <= PAGE_SECTION_SIZE;
		if (all.length > PAGE_SECTION_SIZE)
			this.pager.setState({
				page: this.page,
				pageSize: PAGE_SECTION_SIZE,
				first: start + 1,
				last: start + rows.length,
				total: all.length,
				hasNext: start + PAGE_SECTION_SIZE < all.length
			});
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
			`[data-row-id="${CSS.escape(id)}"] .prctr-page-row__more, [data-row-id="${CSS.escape(id)}"] .prctr-button`
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

	private showState(kind: 'failure' | 'empty', content: PageEmpty): void {
		this.state.hidden = false;
		this.state.dataset.kind = kind;
		this.stateTitle.textContent = content.title ?? '';
		this.stateTitle.hidden = content.title === undefined;
		this.stateText.textContent = content.text;
		// A failure that trying again cannot fix, such as a refusal, offers no retry.
		this.retry.element.hidden = kind !== 'failure' || this.retryHandler === undefined;
		this.stateIcon.element.hidden = kind === 'empty';
		this.emptyRun = content.action?.run;
		this.emptyAction.element.hidden = content.action === undefined;
		if (content.action !== undefined)
			this.emptyAction.setState({
				label: content.action.label,
				icon: proctorIconFactory(content.action.icon, 14)
			});
	}

	private createRow(
		$: ReturnType<typeof createElementFactory>,
		row: PageRowModel
	): HTMLLIElement {
		const document = this.element.ownerDocument;
		const glyph = this.rowStore.add(createProctorIcon(document, { id: row.glyph, size: 18 }));
		glyph.element.classList.add('prctr-page-row__glyph');
		const text = $(
			'span.prctr-page-row__text',
			{},
			$('span.prctr-page-row__title', { textContent: row.title })
		);
		if (row.chips !== undefined && row.chips.length > 0)
			text.append(this.createChips($, row.chips));
		text.append($('span.prctr-page-row__detail', { textContent: row.detail }));
		const item = $('li.prctr-page-row', { data: { rowId: row.id } }, glyph.element, text);
		if (row.status !== undefined) {
			const icon = this.rowStore.add(
				createProctorIcon(document, { id: row.status.icon, size: 14 })
			);
			item.append(
				$(
					'span.prctr-page-row__status',
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

	/** The first chips, then "+N" whose tooltip and accessible name list the rest. */
	private createChips(
		$: ReturnType<typeof createElementFactory>,
		labels: readonly string[]
	): HTMLElement {
		const hidden = labels.slice(VISIBLE_CHIPS);
		const chips = $(
			'span.prctr-page-row__chips',
			{},
			...labels
				.slice(0, VISIBLE_CHIPS)
				.map((label) => $('span.prctr-page-row__chip', { textContent: label }))
		);
		if (hidden.length > 0) {
			const names = hidden.join(', ');
			const more = $('button.prctr-page-row__chip-more', {
				type: 'button',
				textContent: this.format.text('moreChips', { count: hidden.length }),
				attrs: {
					'aria-label': this.format.text('moreChipsLabel', {
						count: hidden.length,
						names
					})
				}
			});
			// The tooltip lists one per line; the accessible name above reads them as a sentence.
			const list = hidden.join('\n');
			this.rowStore.add(this.hover.setupHover(more, list));
			chips.append(more);
		}
		return chips;
	}

	private createMenuButton(
		$: ReturnType<typeof createElementFactory>,
		name: string,
		actions: readonly PageRowAction[]
	): HTMLButtonElement {
		const label = this.format.text('rowActions', { name });
		const button = $('button.prctr-page-row__more', {
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
			this.pane.menu.show(button, entries, label);
			if (!this.pane.menu.visible) return;
			button.setAttribute('aria-expanded', 'true');
			const store = this.rowStore.add(new DisposableStore());
			store.add(
				this.pane.menu.onDidChangeVisibility((visible) => {
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
