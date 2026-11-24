/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { PagerControl } from '../../../../base/browser/ui/pager/pagerControl.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import type { StatusBadgeTone } from '../../../../base/browser/ui/badge/statusBadge.js';
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
import { createRowMenuButton } from './rowMenuButton.js';
import './media/pageSection.css';

let sectionSequence = 0;

export interface PageRowAction {
	readonly label: string;
	readonly icon: ProctorIconId;
	/** Last in the menu, after a separator, in red; it always opens a confirmation. */
	readonly destructive?: boolean;
	readonly enabled?: boolean;
	/**
	 * The action needs something the account lacks, such as two-step verification: a lock after
	 * its label, and this accessible name. It stays enabled and explains when chosen.
	 */
	readonly locked?: string;
	readonly run: () => void;
}

/** Chips shown before the rest collapse into "+N". */
const VISIBLE_CHIPS = 3;
/** Rows on one page of a section; a longer list gets a pager at the foot of its card. */
export const PAGE_SECTION_SIZE = 10;

/** A status word, shown as a badge; its tone says what it means and the badge picks the colour. */
export interface PageRowStatus {
	readonly text: string;
	readonly tone: StatusBadgeTone;
}

/** A row status as the boards draw it: one word in its tone, no pill. */
export function createRowBadge(document: Document, status: PageRowStatus): HTMLElement {
	return createElementFactory(document)('span.prctr-page-row__word', {
		textContent: status.text,
		data: { tone: status.tone }
	});
}

export interface PageRowModel {
	readonly id: string;
	/** A small glyph saying what the row is, such as a laptop or a key; a plain record has none. */
	readonly glyph?: ProctorIconId;
	/** A glyph for something that waits on you is amber; for something that went wrong, red. */
	readonly glyphTone?: 'attention' | 'failure';
	readonly title: string;
	/** Short labels under the title, such as a token's permissions; the first few show. */
	readonly chips?: readonly string[];
	readonly detail?: string;
	/** Quiet text at the end of the row, such as when a change was made. */
	readonly trailing?: string;
	/** A badge at the end of the row, as for a setting's state. */
	readonly status?: PageRowStatus;
	/** A badge right after the title, as for whether an affiliation is current. */
	readonly titleBadge?: PageRowStatus;
	/** Marks the row you are using, such as this session, with a pin; the text is its tooltip. */
	readonly here?: string;
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
	/** Drawn in a circle above the words when the section stands alone on a plain page. */
	readonly icon?: ProctorIconId;
	readonly title?: string;
	readonly text: string;
	readonly action?: { readonly label: string; readonly icon: ProctorIconId; run(): void };
	/** A quieter second way on, such as showing the list without its filter. */
	readonly secondary?: { readonly label: string; readonly icon: ProctorIconId; run(): void };
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
	private readonly emptySecondary: ButtonControl;
	private emptySecondaryRun: (() => void) | undefined;
	private emptyRun: (() => void) | undefined;
	private readonly card: HTMLElement;
	private readonly list: HTMLUListElement;
	private readonly skeleton: HTMLElement;
	private readonly state: HTMLElement;
	private readonly stateText: HTMLElement;
	private readonly stateIcon;
	private readonly stateGlyph: HTMLElement;
	private readonly plain: boolean;
	private readonly failure: ((reason: string) => PageEmpty | undefined) | undefined;
	private readonly stateActions: HTMLElement;
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
			/** Content that draws its own edges, such as a table of hairline rows, needs no card. */
			readonly plain?: boolean;
			/**
			 * The shape the section takes while it loads: rows with a glyph, or label and value
			 * pairs, as many as the details it will show.
			 */
			readonly skeleton?: { readonly kind: 'rows' | 'details'; readonly count: number };
			/**
			 * The section's own words for a failed read, such as "Couldn’t load your sessions";
			 * a reason it leaves to the page reads "This couldn’t be loaded" with the reason.
			 */
			readonly failure?: (reason: string) => PageEmpty | undefined;
		},
		@IPageFormatService private readonly format: IPageFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.plain = options.plain === true;
		this.failure = options.failure;
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
		this.heading.hidden = !options.title;
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
		const skeleton = options.skeleton ?? { kind: 'rows', count: SKELETON_ROWS };
		this.skeleton.dataset.kind = skeleton.kind;
		for (let index = 0; index < skeleton.count; index++)
			this.skeleton.append(
				skeleton.kind === 'details'
					? $(
							'div.prctr-page-section__skeleton-row',
							{},
							$(
								'span.prctr-page-section__skeleton-bar.prctr-page-section__skeleton-label'
							),
							$('span.prctr-page-section__skeleton-bar', {
								data: { width: String(index % 7) }
							})
						)
					: $(
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
			createProctorIcon(document, { id: 'status.attention', size: this.plain ? 22 : 18 })
		);
		this.stateGlyph = $('span.prctr-page-section__state-glyph', {}, this.stateIcon.element);
		this.stateActions = $('span.prctr-page-section__state-actions');
		this.stateTitle = $('strong.prctr-page-section__state-title', { hidden: true });
		this.stateText = $('span.prctr-page-section__state-text');
		this.state = $(
			'div.prctr-page-section__state',
			{},
			this.stateGlyph,
			$('span.prctr-page-section__state-body', {}, this.stateTitle, this.stateText),
			this.stateActions
		);
		this.retry = this._register(
			new ButtonControl(this.stateActions, {
				variant: 'secondary',
				size: 'small',
				label: this.format.text('retry'),
				icon: proctorIconFactory('action.retry', 14)
			})
		);
		this.emptyAction = this._register(
			new ButtonControl(this.stateActions, {
				variant: options.plain === true ? 'brand' : 'secondary',
				size: 'small',
				label: '',
				icon: proctorIconFactory('action.add', 14)
			})
		);
		this.emptyAction.element.hidden = true;
		this._register(this.emptyAction.onDidRequest(() => this.emptyRun?.()));
		this.emptySecondary = this._register(
			new ButtonControl(this.stateActions, {
				variant: 'secondary',
				size: 'small',
				label: '',
				icon: proctorIconFactory('action.filter', 14)
			})
		);
		this.emptySecondary.element.hidden = true;
		this._register(this.emptySecondary.onDidRequest(() => this.emptySecondaryRun?.()));
		this.list = $('ul.prctr-page-section__rows', { attrs: { 'aria-labelledby': id } });
		this.content = $('div.prctr-page-section__content');
		this.card = $(
			'div.prctr-page-section__card',
			{ data: { plain: String(options.plain === true) } },
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
		// A section without a title, description or action, such as a page's only table, shows no header.
		header.hidden = !options.title && !options.description && options.action === undefined;
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

	override dispose(): void {
		super.dispose();
		this.element.remove();
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
		this.heading.hidden = !title;
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
		const wasFailed = this.element.dataset.state === 'failed';
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
			const content = this.failure?.(state.reason) ?? {
				text: this.format.text('loadFailed', {
					reason: this.pane.describeFailure(state.reason)
				})
			};
			this.showState(state.reason === 'denied' ? 'denied' : 'failure', content);
			// A section that has just failed says so once, for those who can't see it.
			if (!wasFailed) this.pane.announce(content.title ?? content.text);
			return;
		}
		if (state.kind === 'stale') {
			// A server that didn't answer leaves what was last read, and says when that was.
			const unreachable =
				state.reason === 'unavailable' ||
				state.reason === 'offline' ||
				state.reason === 'timeout';
			this.showNote(
				'status.offline',
				unreachable && state.since !== undefined
					? this.format.text(
							this.format.institution === undefined
								? 'staleSince'
								: 'staleSinceNamed',
							{
								when: this.format.relative(state.since),
								institution: this.format.institution ?? ''
							}
						)
					: this.format.text('staleData', {
							reason: this.pane.describeFailure(state.reason)
						})
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

	private showState(kind: 'failure' | 'denied' | 'empty', content: PageEmpty): void {
		this.state.hidden = false;
		this.state.dataset.kind = kind;
		this.stateTitle.textContent = content.title ?? '';
		this.stateTitle.hidden = content.title === undefined;
		this.stateText.textContent = content.text;
		// A failure that trying again cannot fix, such as a refusal, offers no retry.
		this.retry.element.hidden = kind !== 'failure' || this.retryHandler === undefined;
		const icon =
			kind === 'failure'
				? 'status.attention'
				: kind === 'denied'
					? 'status.locked'
					: content.icon;
		this.stateGlyph.hidden = icon === undefined;
		if (icon !== undefined) this.stateIcon.setState({ id: icon, size: this.plain ? 22 : 18 });
		this.emptyRun = content.action?.run;
		this.emptyAction.element.hidden = content.action === undefined;
		if (content.action !== undefined)
			this.emptyAction.setState({
				label: content.action.label,
				icon: proctorIconFactory(content.action.icon, 14)
			});
		this.emptySecondaryRun = content.secondary?.run;
		this.emptySecondary.element.hidden = content.secondary === undefined;
		if (content.secondary !== undefined)
			this.emptySecondary.setState({
				label: content.secondary.label,
				icon: proctorIconFactory(content.secondary.icon, 14)
			});
	}

	private createRow(
		$: ReturnType<typeof createElementFactory>,
		row: PageRowModel
	): HTMLLIElement {
		const document = this.element.ownerDocument;
		const leading: HTMLElement[] = [];
		if (row.glyph !== undefined) {
			const glyph = this.rowStore.add(
				createProctorIcon(document, { id: row.glyph, size: 18 })
			);
			glyph.element.classList.add('prctr-page-row__glyph');
			if (row.glyphTone !== undefined) glyph.element.dataset.tone = row.glyphTone;
			leading.push(glyph.element);
		}
		const title = $(
			'span.prctr-page-row__heading',
			{},
			$('span.prctr-page-row__title', { textContent: row.title })
		);
		if (row.titleBadge !== undefined) title.append(createRowBadge(document, row.titleBadge));
		if (row.here !== undefined)
			title.append(createRowBadge(document, { text: row.here, tone: 'neutral' }));
		const text = $('span.prctr-page-row__text', {}, title);
		if (row.chips !== undefined && row.chips.length > 0)
			text.append(this.createChips($, row.chips));
		if (row.detail !== undefined && row.detail !== '')
			text.append($('span.prctr-page-row__detail', { textContent: row.detail }));
		const item = $('li.prctr-page-row', { data: { rowId: row.id } }, ...leading, text);
		if (row.trailing !== undefined)
			item.append($('span.prctr-page-row__trailing', { textContent: row.trailing }));
		if (row.status !== undefined) item.append(createRowBadge(document, row.status));
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

	/**
	 * The first chips, then an "N more" button that opens the rest in place, in the row, and
	 * "Show fewer" that folds them again. Nothing covers the detail line under them.
	 */
	private createChips(
		$: ReturnType<typeof createElementFactory>,
		labels: readonly string[]
	): HTMLElement {
		const hidden = labels.length - VISIBLE_CHIPS;
		const chips = $('span.prctr-page-row__chips');
		const chip = (label: string): HTMLElement =>
			$('span.prctr-page-row__chip', { textContent: label });
		if (hidden <= 0) {
			chips.append(...labels.map(chip));
			return chips;
		}
		const extra = labels.slice(VISIBLE_CHIPS).map(chip);
		const more = $('button.prctr-page-row__chip-more', {
			type: 'button',
			attrs: { 'aria-expanded': 'false' }
		});
		const show = (expanded: boolean): void => {
			for (const element of extra) element.hidden = !expanded;
			more.setAttribute('aria-expanded', String(expanded));
			// The visible words are the accessible name; aria-expanded says whether it is open.
			more.textContent = expanded
				? this.format.text('fewerChips')
				: this.format.text('moreChips', { count: hidden });
		};
		show(false);
		this.rowStore.add(
			addDisposableListener(more, 'click', () =>
				show(more.getAttribute('aria-expanded') !== 'true')
			)
		);
		chips.append(...labels.slice(0, VISIBLE_CHIPS).map(chip), ...extra, more);
		return chips;
	}

	private createMenuButton(
		_$: ReturnType<typeof createElementFactory>,
		name: string,
		actions: readonly PageRowAction[]
	): HTMLButtonElement {
		return createRowMenuButton(this.rowStore, this.pane.menu, this.element.ownerDocument, {
			label: this.format.text('rowActions', { name }),
			actions,
			className: 'prctr-page-row__more'
		});
	}
}
