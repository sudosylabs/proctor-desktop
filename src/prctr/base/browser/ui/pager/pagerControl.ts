/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../documentElements.js';
import { addDisposableListener } from '../../dom.js';
import { Emitter, type Event } from '../../../common/event.js';
import { Disposable, DisposableStore } from '../../../common/lifecycle.js';
import type { ControlIconFactory } from '../controlIcon.js';
import './pagerControl.css';

/** Text the owner localizes; the pager composes nothing itself. */
export interface PagerLabels {
	/** The landmark's accessible name, such as "Audits pages". */
	readonly name: string;
	readonly previous: string;
	readonly next: string;
	/** The accessible name of one numbered page button. */
	page(page: number): string;
	/** "11–20 of 248", "11–20 of 10,000+" when the count stopped at a ceiling, or "11–20" when unknown. */
	range(first: number, last: number, total: number | undefined, atLeast: boolean): string;
	/** "Page 12 of 25", or "Page 12" when the count is unknown: the narrow form. */
	compact(page: number, pageCount: number | undefined): string;
}

export interface PagerState {
	/** The page shown, from 1. */
	readonly page: number;
	/** Items on a full page. */
	readonly pageSize: number;
	/** The first and last item numbers on it, from 1. */
	readonly first: number;
	readonly last: number;
	/** Known only when the source reports its size. */
	readonly total?: number;
	/** The source stopped counting at {@link total}; there may be more, so there is no last page. */
	readonly totalIsLowerBound?: boolean;
	/** Whether another page follows; without a total this is all that is known. */
	readonly hasNext: boolean;
	/** Pages reached so far, when the total is unknown; they are the numbers offered. */
	readonly knownPages?: number;
	/** A page is loading: the buttons wait, the pager stays where it is. */
	readonly busy?: boolean;
}

export interface PagerOptions {
	readonly labels: PagerLabels;
	readonly previousIcon: ControlIconFactory;
	readonly nextIcon: ControlIconFactory;
}

/**
 * Previous, numbered pages and Next at the foot of a list. With a known total it offers the
 * first and last page, the current one and its neighbours, with gaps between; without one it
 * numbers the pages reached so far. Narrow hosts show "Page 3 of 25" instead of numbers.
 */
export class PagerControl extends Disposable {
	readonly element: HTMLElement;
	private readonly changeEmitter = this._register(new Emitter<number>());
	/** The person asked for another page; the owner loads it and sets the new state. */
	readonly onDidRequestPage: Event<number> = this.changeEmitter.event;
	private readonly range: HTMLElement;
	private readonly compact: HTMLElement;
	private readonly pages: HTMLElement;
	private readonly previous: HTMLButtonElement;
	private readonly next: HTMLButtonElement;
	private readonly icons = this._register(new DisposableStore());
	private state: PagerState = { page: 1, pageSize: 10, first: 0, last: 0, hasNext: false };

	constructor(
		host: HTMLElement,
		private readonly options: PagerOptions
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.range = $('span.prctr-pager__range');
		this.compact = $('span.prctr-pager__compact');
		this.pages = $('span.prctr-pager__pages');
		this.previous = $('button.prctr-pager__step', {
			type: 'button',
			attrs: { 'aria-label': options.labels.previous }
		});
		this.previous.append(
			this.icons.add(options.previousIcon(document)).element,
			$('span', { textContent: options.labels.previous })
		);
		this.next = $('button.prctr-pager__step', {
			type: 'button',
			attrs: { 'aria-label': options.labels.next }
		});
		this.next.append(
			$('span', { textContent: options.labels.next }),
			this.icons.add(options.nextIcon(document)).element
		);
		this.element = $(
			'nav.prctr-pager',
			{ attrs: { 'aria-label': options.labels.name } },
			this.range,
			$('span.prctr-pager__space'),
			this.previous,
			this.pages,
			this.compact,
			this.next
		);
		host.append(this.element);
		this._register(
			addDisposableListener(this.previous, 'click', () => this.request(this.state.page - 1))
		);
		this._register(
			addDisposableListener(this.next, 'click', () => this.request(this.state.page + 1))
		);
		this._register(
			addDisposableListener(this.pages, 'click', (event) => {
				const target = event.target instanceof Element ? event.target : null;
				const page = Number(target?.closest<HTMLElement>('[data-page]')?.dataset.page);
				if (Number.isInteger(page)) this.request(page);
			})
		);
	}

	setState(state: PagerState): void {
		this.state = state;
		const { labels } = this.options;
		const pageCount =
			state.total === undefined || state.totalIsLowerBound === true
				? undefined
				: Math.max(1, Math.ceil(state.total / Math.max(1, state.pageSize)));
		this.range.textContent = labels.range(
			state.first,
			state.last,
			state.total,
			state.totalIsLowerBound === true
		);
		this.compact.textContent = labels.compact(state.page, pageCount);
		this.previous.disabled = state.page <= 1 || state.busy === true;
		this.next.disabled = !state.hasNext || state.busy === true;
		this.element.setAttribute('aria-busy', String(state.busy === true));
		const $ = createElementFactory(this.element.ownerDocument);
		this.pages.replaceChildren(
			...pageNumbers(state, pageCount).map((page) =>
				page === 'gap'
					? $('span.prctr-pager__gap', {
							textContent: '…',
							attrs: { 'aria-hidden': 'true' }
						})
					: $('button.prctr-pager__page', {
							type: 'button',
							textContent: String(page),
							disabled: state.busy === true,
							data: { page: String(page) },
							attrs: {
								'aria-label': labels.page(page),
								...(page === state.page ? { 'aria-current': 'page' } : {})
							}
						})
			)
		);
	}

	private request(page: number): void {
		if (page < 1 || page === this.state.page || this.state.busy === true) return;
		if (page > this.state.page && !this.state.hasNext && page > (this.state.knownPages ?? 0))
			return;
		this.changeEmitter.fire(page);
	}
}

/** First, last, current and its neighbours, with gaps; without a total, "last" is the furthest page reached. */
function pageNumbers(state: PagerState, pageCount: number | undefined): (number | 'gap')[] {
	const last = pageCount ?? Math.max(state.knownPages ?? state.page, state.page);
	const wanted = [1, last, state.page - 1, state.page, state.page + 1];
	const shown = [...new Set(wanted.filter((page) => page >= 1 && page <= last))].sort(
		(a, b) => a - b
	);
	const result: (number | 'gap')[] = [];
	for (const [index, page] of shown.entries()) {
		const previous = shown[index - 1];
		if (previous !== undefined && page - previous > 1) result.push('gap');
		result.push(page);
	}
	return result;
}
