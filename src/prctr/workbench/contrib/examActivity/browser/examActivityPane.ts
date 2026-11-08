import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import type { CancellationToken } from '../../../../base/common/cancellation.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import {
	validateExamActivityResponse,
	type ExamActivity,
	type ExamActivityResponse
} from '../../../../platform/examActivity/common/examActivityProtocol.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import type { WorkbenchPane } from '../../../browser/workbenchPane.js';
import type { ResolvedWorkbenchItem } from '../../../common/workbenchItem.js';
import { ILocalizationService } from '../../../services/localization/common/localization.js';
import {
	IAuthenticatedNavigationService,
	type ActivityView
} from '../../authenticated/browser/authenticatedNavigation.js';
import { authenticatedMessages } from '../../authenticated/browser/authenticatedMessages.js';
import { ProductAccess } from './productAccess.js';
import { examActivityMessages as m } from './examActivityMessages.js';
import './examActivity.css';

type Page = 'activity' | 'management' | 'administration';
/** Presentation and selection only; identity's bound read capability owns all server requests. */
export class ExamActivityPane extends Disposable implements WorkbenchPane {
	readonly element: HTMLElement;
	private readonly page: HTMLElement;
	private readonly heading: HTMLElement;
	private readonly body: HTMLElement;
	private readonly status: HTMLElement;
	private readonly rows: HTMLElement;
	private readonly footer: HTMLElement;
	private readonly refresh: ButtonControl;
	private readonly scroll: DomScrollableElement;
	private readonly queries = this._register(new DisposableStore());
	private readonly pages = new Map<string, Extract<ExamActivityResponse, { kind: 'activity' }>>();
	private readonly watched = new Set<string>();
	private readonly pageSubscriptions = new Map<string, { dispose(): void }>();
	private readonly content = this._register(new DisposableStore());
	private readonly details = this._register(new DisposableStore());
	/** The page's own detail panel beside the list; choosing a row opens it. */
	private readonly detailPanel: HTMLElement;
	private readonly detailContent: HTMLElement;
	private readonly detailScroll: DomScrollableElement;
	private destination: Page | undefined;
	private view: ActivityView = 'overview';
	private epoch = 0;
	private detailEpoch = 0;
	private items: ExamActivity[] = [];
	private cursor: string | undefined;
	private loading = false;
	private visible = true;
	private failure: string | undefined;
	private selected: ExamActivity | undefined;
	private detailHost: HTMLElement | undefined;
	private focusedRow: HTMLButtonElement | undefined;
	constructor(
		private readonly document: Document,
		private readonly access: ProductAccess,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@ILocalizationService private readonly localization: ILocalizationService,
		@IHoverService private readonly hoverService: IHoverService
	) {
		super();
		this.view = this.navigation.activityView ?? 'overview';
		if (this.navigation.onDidChangeActivityView)
			this._register(
				this.navigation.onDidChangeActivityView((view) => {
					this.view = view;
					if (this.destination !== 'activity') return;
					this.selected = undefined;
					this.detailEpoch++;
					this.hideDetails(false);
					this.updateHeading();
					this.renderRows();
					this.updateStatus();
					this.page.scrollTop = 0;
					this.heading.focus();
				})
			);
		this.element = document.createElement('section');
		this.element.className = 'prctr-exam-activity';
		this.page = document.createElement('div');
		this.page.className = 'prctr-exam-activity__viewport';
		const content = document.createElement('div');
		content.className = 'prctr-exam-activity__content';
		const header = document.createElement('header');
		this.heading = document.createElement('h1');
		this.heading.tabIndex = -1;
		header.append(this.heading);
		this.refresh = this._register(
			new ButtonControl(header, {
				variant: 'secondary',
				size: 'large',
				label: this.text('retry'),
				icon: (doc) => createSemanticIcon(doc, { id: 'action.refresh' })
			})
		);
		this._register(
			this.hoverService.setupDelayedHover(this.refresh.element, () => ({
				content: this.text('retry'),
				position: { hoverPosition: HoverPosition.BELOW }
			}))
		);
		this._register(
			this.refresh.onDidRequest(() => {
				this.reset();
				this.updateAccess();
				void access.refresh();
			})
		);
		this.refresh.element.hidden = true;
		this.status = document.createElement('p');
		this.status.role = 'status';
		this.status.className = 'prctr-exam-activity__status';
		this.body = document.createElement('div');
		this.rows = document.createElement('div');
		this.rows.className = 'prctr-exam-activity__rows';
		this.footer = document.createElement('div');
		this.footer.className = 'prctr-exam-activity__footer';
		content.append(header, this.body, this.rows, this.status, this.footer);
		this.page.append(content);
		this.scroll = this._register(
			new DomScrollableElement(this.page, {
				className: 'prctr-exam-activity__scroll',
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Auto,
				verticalScrollbarSize: 8,
				useShadows: false
			})
		);
		this.element.append(this.scroll.getDomNode());
		this.detailContent = document.createElement('div');
		this.detailContent.className = 'prctr-exam-activity__content';
		const detailViewport = document.createElement('div');
		detailViewport.className = 'prctr-exam-activity__viewport';
		detailViewport.append(this.detailContent);
		this.detailScroll = this._register(
			new DomScrollableElement(detailViewport, {
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Auto,
				verticalScrollbarSize: 8,
				useShadows: false
			})
		);
		this.detailPanel = document.createElement('aside');
		this.detailPanel.className = 'prctr-exam-activity__details';
		this.detailPanel.hidden = true;
		this.detailPanel.append(this.detailScroll.getDomNode());
		this.element.append(this.detailPanel);
		const observer = new ResizeObserver(() => {
			this.scroll.scanDomNode();
			this.detailScroll.scanDomNode();
		});
		observer.observe(this.page);
		observer.observe(content);
		observer.observe(this.detailContent);
		this._register({ dispose: () => observer.disconnect() });
		this._register(access.onDidChange(() => this.updateAccess()));
	}
	private text(key: keyof typeof m): string {
		return this.localization.format(m[key]);
	}
	private paragraph(host: HTMLElement, value: string): HTMLElement {
		const p = this.document.createElement('p');
		p.textContent = value;
		host.append(p);
		return p;
	}
	private date(value: string): string {
		return new Intl.DateTimeFormat(
			this.localization.locale === 'pseudo' ? 'en' : this.localization.locale,
			{ dateStyle: 'medium', timeStyle: 'short' }
		).format(new Date(value));
	}
	setItem(model: ResolvedWorkbenchItem, token: CancellationToken): void {
		if (token.isCancellationRequested) return;
		const destination = model.item.logicalIdentity;
		if (
			destination !== 'activity' &&
			destination !== 'management' &&
			destination !== 'administration'
		)
			throw new Error('Unknown product page');
		this.destination = destination;
		this.view = this.navigation.activityView ?? 'overview';
		this.updateHeading();
		this.hideDetails(false);
		this.detailHost = destination === 'activity' ? this.detailContent : undefined;
		this.updateAccess();
	}
	private reset(): void {
		this.queries.clear();
		this.pageSubscriptions.clear();
		this.pages.clear();
		this.watched.clear();
		this.epoch++;
		this.detailEpoch++;
		this.loading = false;
		this.items = [];
		this.cursor = undefined;
		this.selected = undefined;
		this.focusedRow = undefined;
		this.content.clear();
		this.details.clear();
		this.rows.replaceChildren();
		this.body.replaceChildren();
		this.footer.replaceChildren();
		this.status.textContent = '';
		this.failure = undefined;
		this.renderDetails();
	}
	private updateAccess(): void {
		if (!this.destination) return;
		const focused = this.document.activeElement;
		if (this.rows.contains(focused) || this.detailHost?.contains(focused)) this.heading.focus();
		this.reset();
		const state = this.access.state;
		this.refresh.element.disabled = !state;
		this.refresh.element.hidden = state?.kind !== 'error';
		if (!state) {
			this.status.textContent = this.text('loading');
			return;
		}
		if (state.kind !== 'context') {
			this.status.textContent = this.failure = this.text(
				state.kind === 'error' ? state.reason : 'unavailable'
			);
			return;
		}
		const area =
			this.destination === 'activity'
				? 'student_activity'
				: this.destination === 'management'
					? 'exam_management'
					: 'administration';
		if (!state.context.areas.includes(area)) {
			this.status.textContent = this.failure = this.text('restricted');
			return;
		}
		if (this.destination === 'activity') {
			this.paragraph(this.body, this.description());
			const timezone = this.paragraph(
				this.body,
				this.localization.format(m.timezone, {
					zone: new Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ')
				})
			);
			timezone.className = 'prctr-exam-activity__timezone';
			void this.load();
		} else {
			this.paragraph(this.body, this.text('future'));
			if (state.context.scopes.length) {
				const heading = this.document.createElement('h2');
				heading.textContent = this.text('scopes');
				this.body.append(heading);
				const list = this.document.createElement('ul');
				for (const scope of state.context.scopes) {
					const item = this.document.createElement('li');
					item.textContent = scope.name;
					list.append(item);
				}
				this.body.append(list);
			}
			if (state.context.moreScopes) this.paragraph(this.body, this.text('moreScopes'));
		}
	}
	private async request(
		intent: Parameters<ProductAccess['client']['request']>[0]
	): Promise<ExamActivityResponse> {
		try {
			return validateExamActivityResponse(await this.access.client.request(intent));
		} catch {
			return { kind: 'error', reason: 'unavailable' };
		}
	}
	private async load(): Promise<void> {
		if (!this.visible || this.loading || this.destination !== 'activity') return;
		this.loading = true;
		this.failure = undefined;
		const epoch = this.epoch,
			cursor = this.cursor;
		this.status.textContent = this.text('loading');
		this.footer.querySelector('button')?.setAttribute('disabled', '');
		if (this.access.client.observe) {
			const key = cursor ?? '';
			if (!this.watched.has(key)) {
				this.watched.add(key);
				const observation = this.access.client.observe(
					{ kind: 'activity', ...(cursor ? { cursor } : {}) },
					(result) => {
						if (epoch !== this.epoch || !this.destination || !this.watched.has(key))
							return;
						this.loading = false;
						if (result.kind !== 'activity') {
							this.failure = this.text(
								result.kind === 'error' ? result.reason : 'unavailable'
							);
							if (
								result.kind === 'error' &&
								['restricted', 'sessionEnded'].includes(result.reason)
							) {
								this.items = [];
								this.pages.clear();
								this.renderRows();
							}
							this.refresh.element.hidden = false;
							this.updateStatus();
							return;
						}
						this.failure = undefined;
						this.refresh.element.hidden = true;
						if (JSON.stringify(this.pages.get(key)) === JSON.stringify(result)) {
							this.updateStatus();
							return;
						}
						// A changed cursor boundary invalidates all subsequently loaded pages.
						const previous = this.pages.get(key);
						if (
							previous &&
							(previous.nextCursor !== result.nextCursor ||
								previous.items.map((item) => item.sittingId).join(',') !==
									result.items.map((item) => item.sittingId).join(','))
						) {
							const keys = [...this.pages.keys()];
							for (const following of keys.slice(keys.indexOf(key) + 1)) {
								this.pages.delete(following);
								this.watched.delete(following);
								const subscription = this.pageSubscriptions.get(following);
								if (subscription) this.queries.delete(subscription);
								this.pageSubscriptions.delete(following);
							}
						}
						this.pages.set(key, result);
						this.items = [
							...new Map(
								[...this.pages.values()]
									.flatMap((page) => page.items)
									.map((item) => [item.sittingId, item])
							).values()
						];
						const last = [...this.pages.values()].at(-1);
						this.cursor = last?.nextCursor;
						this.renderRows();
						this.updateStatus();
					}
				);
				this.pageSubscriptions.set(key, observation);
				this.queries.add(observation);
			}
			return;
		}
		const result = await this.request({ kind: 'activity', ...(cursor ? { cursor } : {}) });
		if (epoch !== this.epoch || !this.destination) return;
		this.loading = false;
		if (result.kind === 'error' && result.reason === 'invalidCursor') {
			await this.access.refresh();
			return;
		}
		if (result.kind !== 'activity') {
			if (
				result.kind === 'error' &&
				(result.reason === 'restricted' || result.reason === 'sessionEnded')
			) {
				this.reset();
				this.status.textContent = this.failure = this.text(result.reason);
				return;
			}
			this.status.textContent = this.failure = this.text(
				result.kind === 'error' ? result.reason : 'unavailable'
			);
			this.footer.querySelector('button')?.removeAttribute('disabled');
			return;
		}
		const known = new Set(this.items.map((item) => item.sittingId));
		for (const item of result.items) {
			if (!known.has(item.sittingId)) {
				known.add(item.sittingId);
				this.items.push(item);
			}
		}
		this.cursor =
			result.nextCursor && result.nextCursor !== cursor ? result.nextCursor : undefined;
		this.renderRows();
		this.updateStatus();
	}
	private description(): string {
		return this.text(this.view === 'overview' ? 'subtitle' : `${this.view}Description`);
	}
	private updateHeading(): void {
		if (this.destination === 'activity' && this.body.firstElementChild)
			this.body.firstElementChild.textContent = this.description();
		this.heading.textContent =
			this.destination === 'activity' && this.view !== 'overview'
				? this.localization.format(authenticatedMessages[this.view])
				: this.text(this.destination ?? 'activity');
	}
	private visibleItems(): readonly ExamActivity[] {
		return this.view === 'overview'
			? this.items
			: this.items.filter((item) => item.activity === this.view);
	}
	private updateStatus(): void {
		if (this.loading) {
			this.status.textContent = this.text('loading');
			return;
		}
		if (this.failure) {
			this.status.textContent = this.failure;
			return;
		}
		this.status.textContent = this.cursor
			? this.text('partial')
			: this.items.length
				? ''
				: this.text('empty');
	}
	private renderRows(): void {
		const document = this.document;
		const active = document.activeElement;
		const restore = this.rows.contains(active) || this.footer.contains(active);
		this.content.clear();
		this.rows.replaceChildren();
		this.footer.replaceChildren();
		this.rows.removeAttribute('role');
		this.rows.removeAttribute('aria-label');
		const buttons: HTMLButtonElement[] = [];
		const groups =
			this.view === 'overview'
				? [
						{
							label: this.text('progressSection'),
							items: this.items.filter((item) => item.activity === 'in_progress'),
							featured: true
						},
						{
							label: this.text('actionSection'),
							items: this.items.filter((item) => item.activity === 'available'),
							featured: true
						},
						{
							label: this.text('upcomingSection'),
							items: this.items.filter((item) => item.activity === 'upcoming'),
							featured: false
						},
						{
							label: this.text('recentSection'),
							items: this.items.filter(
								(item) =>
									item.activity === 'submitted' ||
									item.activity === 'results_available'
							),
							featured: false
						},
						{
							label: this.text('historySection'),
							items: this.items.filter((item) => item.activity === 'past'),
							featured: false
						}
					]
				: [
						{
							label: '',
							items: this.visibleItems(),
							featured: this.view === 'available' || this.view === 'in_progress'
						}
					];
		for (const group of groups) {
			if (!group.items.length) continue;
			const section = document.createElement('section');
			section.className = 'prctr-exam-activity__section';
			if (group.label) {
				const heading = document.createElement('h2');
				heading.textContent = group.label;
				section.append(heading);
			}
			const list = document.createElement('div');
			list.role = 'list';
			list.ariaLabel = group.label || this.heading.textContent || this.text('activity');
			list.className = 'prctr-exam-activity__list';
			section.append(list);
			this.rows.append(section);
			for (const item of group.items) {
				const row = document.createElement('div');
				row.role = 'listitem';
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'prctr-exam-activity__row';
				button.dataset.sittingId = item.sittingId;
				button.dataset.featured = String(group.featured);
				button.setAttribute(
					'aria-current',
					String(this.selected?.sittingId === item.sittingId)
				);
				const date = document.createElement('span');
				date.className = 'prctr-exam-activity__date';
				date.ariaHidden = 'true';
				const locale =
					this.localization.locale === 'pseudo' ? 'en' : this.localization.locale;
				const month = document.createElement('span');
				month.textContent = new Intl.DateTimeFormat(locale, { month: 'short' }).format(
					new Date(item.startsAt)
				);
				const day = document.createElement('strong');
				day.textContent = new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(
					new Date(item.startsAt)
				);
				date.append(month, day);
				const info = document.createElement('span');
				info.className = 'prctr-exam-activity__identity';
				const title = document.createElement('strong');
				title.textContent = item.title;
				const sub = document.createElement('span');
				sub.textContent = item.className;
				const schedule = document.createElement('span');
				schedule.className = 'prctr-exam-activity__schedule';
				schedule.textContent = this.date(item.startsAt);
				info.append(title, sub, schedule);
				if (group.featured && item.access !== 'joinable') {
					const description = document.createElement('span');
					description.className = 'prctr-exam-activity__access';
					description.textContent = this.text(item.access);
					info.append(description);
				}
				const aside = document.createElement('span');
				aside.className = 'prctr-exam-activity__aside';
				const status = document.createElement('span');
				status.className = 'prctr-exam-activity__state';
				status.dataset.state = item.activity;
				status.textContent = this.text(item.activity);
				const action = document.createElement('span');
				action.className = 'prctr-exam-activity__open';
				action.textContent = this.text('openExam');
				action.append(
					this.content.add(
						createSemanticIcon(document, { id: 'action.forward', size: 16 })
					).element
				);
				aside.append(status, action);
				button.append(date, info, aside);
				row.append(button);
				list.append(row);
				buttons.push(button);
				this.content.add(
					addDisposableListener(button, 'click', () => {
						this.selected = item;
						this.focusedRow = button;
						for (const b of buttons)
							b.setAttribute('aria-current', String(b === button));
						this.detailPanel.hidden = false;
						this.renderDetails();
						this.detailHost?.querySelector<HTMLElement>('h2')?.focus();
					})
				);
			}
		}
		if (!this.visibleItems().length && this.items.length) {
			const empty = document.createElement('div');
			empty.className = 'prctr-exam-activity__empty';
			empty.append(
				this.content.add(createSemanticIcon(document, { id: 'product.calendar', size: 24 }))
					.element
			);
			this.paragraph(empty, this.text(this.cursor ? 'partialEmpty' : 'filteredEmpty'));
			this.rows.append(empty);
		}
		if (this.cursor) {
			const more = this.content.add(
				new ButtonControl(this.footer, { label: this.text('more'), variant: 'secondary' })
			);
			this.content.add(more.onDidRequest(() => void this.load()));
		}
		this.focusedRow = buttons.find(
			(button) => button.dataset.sittingId === this.selected?.sittingId
		);
		if (restore) (this.focusedRow ?? buttons.at(-1) ?? this.heading).focus();
		this.scroll.scanDomNode();
	}
	private renderDetails(): void {
		this.detailEpoch++;
		this.details.clear();
		const host = this.detailHost;
		if (!host) return;
		host.replaceChildren();
		const item = this.selected;
		if (!item) {
			this.paragraph(host, this.text('emptyDetail'));
			return;
		}
		const document = this.document;
		const title = document.createElement('h2');
		title.textContent = item.title;
		title.tabIndex = -1;
		const header = document.createElement('header');
		const close = document.createElement('button');
		close.type = 'button';
		close.className = 'prctr-exam-activity__close';
		close.ariaLabel = this.text('closeDetails');
		close.append(
			this.details.add(createSemanticIcon(document, { id: 'action.close' })).element
		);
		this.details.add(
			this.hoverService.setupDelayedHover(close, () => ({
				content: this.text('closeDetails'),
				position: { hoverPosition: HoverPosition.BELOW }
			}))
		);
		this.details.add(
			addDisposableListener(close, 'click', () => {
				this.hideDetails(true);
			})
		);
		header.append(title, close);
		host.append(header);
		this.paragraph(host, this.text(item.access));
		const fields = document.createElement('dl');
		for (const [label, value] of [
			['className', item.className],
			['unit', item.academicUnit],
			['schedule', this.date(item.startsAt) + ' – ' + this.date(item.endsAt)],
			...(item.submittedAt ? [['submission', this.date(item.submittedAt)]] : [])
		]) {
			const dt = document.createElement('dt');
			dt.textContent = this.text(label as keyof typeof m);
			const dd = document.createElement('dd');
			dd.textContent = value!;
			fields.append(dt, dd);
		}
		host.append(fields);
		this.details.add(
			addDisposableListener(host, 'keydown', (event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					this.hideDetails(true);
				}
			})
		);
		const actions = document.createElement('div');
		actions.className = 'prctr-exam-activity__actions';
		host.append(actions);
		for (const action of item.actions) {
			const button = this.details.add(
				new ButtonControl(actions, {
					label: this.text(action),
					variant: 'primary',
					size: 'large',
					disabled: action !== 'view_result'
				})
			);
			if (action !== 'view_result') this.paragraph(host, this.text('admissionUnavailable'));
			else {
				const output = document.createElement('section');
				output.className = 'prctr-exam-activity__result';
				host.append(output);
				const resultStatus = document.createElement('p');
				resultStatus.role = 'status';
				output.append(resultStatus);
				this.details.add(
					button.onDidRequest(() => {
						const epoch = ++this.detailEpoch;
						output.replaceChildren(resultStatus);
						resultStatus.textContent = this.text('loading');
						button.setState({ label: this.text('view_result'), busy: true });
						void this.request({ kind: 'result', attemptId: item.attemptId! }).then(
							(result) => {
								if (epoch !== this.detailEpoch) return;
								button.setState({ label: this.text('view_result') });
								if (
									result.kind !== 'result' ||
									result.attemptId !== item.attemptId
								) {
									resultStatus.textContent = this.text(
										result.kind === 'error' ? result.reason : 'unavailable'
									);
									return;
								}
								const heading = document.createElement('h3');
								heading.textContent = this.text('resultTitle');
								output.append(heading);
								resultStatus.textContent = this.localization.format(m.released, {
									date: this.date(result.releasedAt)
								});
								if (!result.remarks.trim())
									this.paragraph(output, this.text('noRemarks'));
								else {
									const rendered = this.details.add(
										renderMarkdown(new MarkdownString(result.remarks), {
											sanitizerConfig: {
												allowedTags: {
													override: [
														'p',
														'br',
														'strong',
														'em',
														'del',
														'ul',
														'ol',
														'li',
														'blockquote',
														'pre',
														'code',
														'h1',
														'h2',
														'h3',
														'h4',
														'hr',
														'table',
														'thead',
														'tbody',
														'tr',
														'th',
														'td'
													]
												},
												remoteImageIsAllowed: () => false
											}
										})
									);
									output.append(rendered.element);
								}
							}
						);
					})
				);
			}
		}
	}
	/** Close the detail panel, returning focus to the chosen row when asked. */
	private hideDetails(restoreFocus: boolean): void {
		this.detailPanel.hidden = true;
		if (restoreFocus) this.focusedRow?.focus();
	}
	clear(): void {
		this.destination = undefined;
		this.reset();
		this.hideDetails(false);
		this.detailEpoch++;
		this.details.clear();
		this.detailContent.replaceChildren();
		this.detailHost = undefined;
	}
	setVisible(visible: boolean): void {
		this.element.hidden = !visible;
		if (this.visible === visible) return;
		this.visible = visible;
		if (!visible) {
			this.queries.clear();
			this.pageSubscriptions.clear();
			this.watched.clear();
			this.epoch++;
			this.loading = false;
		} else this.updateAccess();
	}
	layout(_width: number, _height: number): void {
		this.scroll.scanDomNode();
		this.detailScroll.scanDomNode();
	}
	focus(): void {
		this.heading.focus();
	}
	getViewState(): undefined {
		return undefined;
	}
	override dispose(): void {
		this.clear();
		super.dispose();
		this.element.remove();
	}
}
