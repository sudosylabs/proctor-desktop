/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { ILocalizationService } from '../../../services/localization/common/localization.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { BannerControl } from '../../../../base/browser/ui/banner/bannerControl.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { parseSettingsDocument } from '../../../../platform/settings/common/settingsDocument.js';
import { SettingsDraft } from '../../../../platform/settings/common/settingsDraft.js';
import type { EffectiveSettingId } from '../../../../platform/settings/common/settingsManifest.js';
import { settingsRegistry } from '../../../../platform/settings/common/settingsRegistry.js';
import type { UserSettingsProjection } from '../../../../platform/settings/common/settingsRendererProtocol.js';
import { EffectiveSettings } from '../../../../platform/settings/common/settingsResolution.js';
import {
	createProctorIcon,
	proctorIconFactory,
	type ProctorIconControl
} from '../../../../platform/theme/browser/proctorIcon.js';
import { IUserSettingsService } from '../../../services/settings/common/settingsRendererClient.js';
import {
	choiceFor,
	isSearching,
	matchingRows,
	SETTINGS_SAVE_DELAY_MS,
	settingsLayout,
	settingsTabIcons,
	settingsTabs,
	type SettingChoice,
	type SettingRow,
	type SettingSearchText,
	type SettingsSaveStatus,
	type SettingsTab
} from './common/settingsPresentation.js';
import type { AccountMessage } from '../accountMessages.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import './media/settingsPage.css';
import { SettingRowView, type SettingRowChoice, type SettingValue } from './settingRow.js';
import { EditorPreview, editorThemeName, type EditorPreviewState } from './settingsPreview.js';

/** The scheme aliases are for the exam window's own choice; the page lists named themes. */
const SCHEME_ALIASES = new Set(['light', 'dark', 'hcLight', 'hcDark']);

const PANEL_ID = 'prctr-settings-panel';

/** One parse of the settings document, read by every row and the preview. */
interface SettingsSnapshot {
	readonly authenticated: EffectiveSettings;
	readonly candidate: EffectiveSettings;
	readonly explicit: ReadonlySet<string>;
}

interface TabView {
	readonly tab: SettingsTab;
	readonly button: HTMLButtonElement;
	/** The tab's groups, shown while it is selected and nothing is being found. */
	readonly groups: HTMLElement;
}

/** A row and the card it belongs in when it is not a search result. */
interface PlacedRow {
	readonly view: SettingRowView;
	readonly home: HTMLElement;
}

/**
 * Settings: Proctor's own page for the registered settings, in three tabs. Every change saves
 * itself a moment later to the account's settings, so they follow the person to any computer.
 * Nobody edits settings.json; a conflicting save from elsewhere is merged by applying this
 * page's pending changes again on top of the newer settings.
 *
 * Every row is built once. A change, a save or news from elsewhere parses the document once and
 * writes the result into the rows in place, so focus stays where the person left it.
 */
export class SettingsPage extends Disposable implements PageView {
	private readonly root: HTMLElement;
	private readonly toolbar: HTMLElement;
	private readonly status: HTMLElement;
	private readonly statusIcon: ProctorIconControl;
	private readonly statusText: HTMLElement;
	private readonly tabs: readonly TabView[];
	private readonly find: HTMLInputElement;
	private readonly unavailable: BannerControl;
	private readonly panel: HTMLElement;
	private readonly examNote: BannerControl;
	private readonly accessibilityNote: BannerControl;
	private readonly preview: EditorPreview;
	private readonly results: HTMLElement;
	private readonly resultsTitle: HTMLElement;
	private readonly resultsCard: HTMLElement;
	private readonly empty: HTMLElement;
	private readonly emptyTitle: HTMLElement;
	private readonly rows = new Map<EffectiveSettingId, PlacedRow>();
	/** The defaults, for Reset's label: what an empty document resolves to on this computer. */
	private readonly defaults: SettingsSnapshot = snapshotOf('{}');

	private tab: SettingsTab = 'appearance';
	private query = '';
	private announcedResults = '';
	private projection: UserSettingsProjection | undefined;
	private draft: SettingsDraft | undefined;
	/** Changes not yet acknowledged by the server, applied again after a conflict. */
	private readonly pending = new Map<EffectiveSettingId, SettingValue | undefined>();
	private saving = false;
	private saveStatus: SettingsSaveStatus = 'idle';
	/** “Saved” is said only once this visit has changed something. */
	private changedThisVisit = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private ambiguousRetried = false;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@ILocalizationService private readonly localization: ILocalizationService,
		@IUserSettingsService private readonly client: IUserSettingsService
	) {
		super();
		const document = body.ownerDocument;
		const $ = createElementFactory(document);
		this.root = $('div.prctr-settings-page');
		body.append(this.root);

		// The banner states a condition of the whole page, so it comes before the tabs.
		this.unavailable = this._register(new BannerControl(this.root));

		this.statusIcon = this._register(
			createProctorIcon(document, { id: 'status.saved', size: 16 })
		);
		this.statusText = $('span');
		// Present from the start, even when silent, so the first save is announced.
		this.status = $(
			'span.prctr-settings-page__status',
			{ data: { status: 'idle' }, attrs: { role: 'status' } },
			this.statusIcon.element,
			this.statusText
		);
		const tablist = $('div.prctr-settings-page__tabs', {
			attrs: { role: 'tablist', 'aria-label': this.format.text('settingsTitle') }
		});
		this.find = $('input.prctr-settings-page__find-input', {
			type: 'search',
			placeholder: this.format.text('findSetting'),
			attrs: { 'aria-label': this.format.text('findSetting') }
		});
		const find = $(
			'label.prctr-settings-page__find',
			{},
			this._register(createProctorIcon(document, { id: 'action.search', size: 14 })).element,
			this.find
		);
		this.toolbar = $(
			'div.prctr-settings-page__toolbar',
			{},
			tablist,
			$('div.prctr-settings-page__tools', {}, this.status, find)
		);
		this.root.append(this.toolbar);

		// The panel waits for the settings, so no control offers a value it has not read.
		this.panel = $('div.prctr-settings-page__panel', {
			id: PANEL_ID,
			hidden: true,
			attrs: { role: 'tabpanel' }
		});
		this.root.append(this.panel);
		this.examNote = this.createNote('settingsExamOverride');
		this.accessibilityNote = this.createNote('settingsAccessibilityNote');
		const openAppearance = this._register(
			new ButtonControl(this.accessibilityNote.actions, {
				variant: 'secondary',
				size: 'small',
				label: this.format.text('openAppearance')
			})
		);
		this._register(openAppearance.onDidRequest(() => this.openTab('appearance')));
		this.preview = this._register(
			new EditorPreview(this.panel, this.format.text('editorPreview'))
		);

		this.tabs = settingsTabs.map((tab) => this.createTab($, tablist, tab));

		this.resultsTitle = $('h2.prctr-settings-page__group-title');
		this.resultsCard = $('div.prctr-settings-page__card.prctr-settings-page__results-card');
		this.results = $(
			'section.prctr-settings-page__group',
			{ hidden: true },
			this.resultsTitle,
			this.resultsCard
		);
		this.emptyTitle = $('p.prctr-settings-page__empty-title');
		this.empty = $(
			'div.prctr-settings-page__card.prctr-settings-page__empty',
			{ hidden: true },
			this.emptyTitle,
			$('p.prctr-settings-page__empty-hint', {
				textContent: this.format.text('settingsNoMatchHint')
			})
		);
		const clear = this._register(
			new ButtonControl(this.empty, {
				variant: 'secondary',
				size: 'small',
				label: this.format.text('clearSearch')
			})
		);
		this._register(clear.onDidRequest(() => this.clearSearch()));
		this.panel.append(this.results, this.empty);

		this.registerListeners(tablist);
		this.observeStuck();
		void client.projection().then(
			(projection) => this.receive(projection),
			() => this.setStatus('failed')
		);
		this.showView();
	}

	setVisible(): void {}

	// #region Building

	private createNote(text: AccountMessage): BannerControl {
		const note = this._register(new BannerControl(this.panel));
		// A note is read with the tab, not announced each time the tab opens.
		note.element.removeAttribute('role');
		note.show({
			tone: 'info',
			icon: proctorIconFactory('status.info', 18),
			text: this.format.text(text)
		});
		return note;
	}

	private createTab(
		$: ReturnType<typeof createElementFactory>,
		tablist: HTMLElement,
		tab: SettingsTab
	): TabView {
		const button = $(
			'button.prctr-settings-page__tab',
			{
				id: `prctr-settings-tab-${tab}`,
				type: 'button',
				attrs: { role: 'tab', 'aria-controls': PANEL_ID }
			},
			this._register(
				createProctorIcon(tablist.ownerDocument, { id: settingsTabIcons[tab], size: 16 })
			).element,
			$('span.prctr-settings-page__tab-label', {
				textContent: this.format.text(tabMessages[tab])
			})
		);
		tablist.append(button);
		this._register(addDisposableListener(button, 'click', () => this.selectTab(tab)));
		const groups = $('div.prctr-settings-page__groups');
		for (const group of settingsLayout[tab]) {
			const title = this.format.text(group.title as AccountMessage);
			const card = $('div.prctr-settings-page__card');
			for (const row of group.rows) this.createRow(card, tab, title, row);
			groups.append(
				$(
					'section.prctr-settings-page__group',
					{},
					$('h2.prctr-settings-page__group-title', { textContent: title }),
					card
				)
			);
		}
		this.panel.append(groups);
		return { tab, button, groups };
	}

	private createRow(card: HTMLElement, tab: SettingsTab, group: string, row: SettingRow): void {
		const { title, description } = this.describe(row.id);
		const fallback = this.valueIn(this.defaults, row.id);
		const fallbackLabel = this.valueLabel(row, fallback);
		const view = this._register(
			new SettingRowView(
				card,
				row,
				{
					title,
					description,
					place: this.format.text('settingsResultPlace', {
						tab: this.format.text(tabMessages[tab]),
						group
					}),
					reset: this.format.text('resetSetting', { value: fallbackLabel }),
					resetAccessible: this.format.text('resetSettingNamed', {
						name: title,
						value: fallbackLabel
					}),
					notSaved: this.format.text('settingsNotSavedShort'),
					choices: this.choicesOf(row),
					smaller: this.format.text('smaller'),
					larger: this.format.text('larger'),
					pixels: (value) => this.format.text('pixels', { value })
				},
				fallback
			)
		);
		this._register(view.onDidChange((value) => void this.change(row.id, value)));
		this.rows.set(row.id, { view, home: card });
	}

	private registerListeners(tablist: HTMLElement): void {
		this._register(addDisposableListener(tablist, 'keydown', (event) => this.onTabKey(event)));
		this._register(
			addDisposableListener(this.find, 'input', () => {
				this.query = this.find.value;
				this.showView();
			})
		);
		const unsubscribe = this.client.onDidChange((projection) => this.receive(projection));
		this._register(toDisposable(unsubscribe));
		this._register(toDisposable(() => clearTimeout(this.timer)));
		this._register(toDisposable(() => this.draft?.dispose()));
	}

	/**
	 * The tab bar sticks to the top of the page and grows a soft edge once content scrolls under
	 * it. Stuck one pixel above the top, it is clipped by that pixel exactly while it sticks.
	 */
	private observeStuck(): void {
		const view = this.root.ownerDocument.defaultView;
		if (view === null || !('IntersectionObserver' in view)) return;
		const observer = new view.IntersectionObserver(
			(entries) => {
				for (const entry of entries)
					this.toolbar.toggleAttribute(
						'data-stuck',
						entry.intersectionRatio < 1 &&
							entry.intersectionRect.top > entry.boundingClientRect.top
					);
			},
			{ threshold: [1] }
		);
		observer.observe(this.toolbar);
		this._register(toDisposable(() => observer.disconnect()));
	}

	// #endregion

	// #region Reading

	/** A newer projection replaces the draft unless this page still has changes to save. */
	private receive(projection: UserSettingsProjection): void {
		if (this._store.isDisposed) return;
		if (this.saving || this.pending.size > 0) {
			this.projection = projection;
			return;
		}
		this.adopt(projection);
		this.panel.hidden = false;
		this.setStatus(this.writable() ? (this.changedThisVisit ? 'saved' : 'idle') : 'readonly');
		this.refresh();
	}

	private adopt(projection: UserSettingsProjection): void {
		this.projection = projection;
		this.draft?.dispose();
		this.draft = new SettingsDraft(projection.source, projection.revision);
	}

	private writable(): boolean {
		return (
			this.projection !== undefined &&
			this.projection.writable &&
			this.projection.availability === 'available'
		);
	}

	private valueIn(snapshot: SettingsSnapshot, id: EffectiveSettingId): SettingValue {
		const declaration = settingsRegistry.declaration(id)!;
		const effective = declaration.windows.includes('authenticated')
			? snapshot.authenticated
			: snapshot.candidate;
		return effective.get(id) as SettingValue;
	}

	// #endregion

	// #region Saving

	private async change(id: EffectiveSettingId, value: SettingValue | undefined): Promise<void> {
		const draft = this.draft;
		if (draft === undefined || !this.writable()) return;
		this.pending.set(id, value);
		try {
			await draft.set(id, value);
		} catch {
			this.pending.delete(id);
			this.pane.toast(this.format.text('settingNotSavedNamed', { name: this.titleOf(id) }), {
				body: this.format.text('settingsInvalid')
			});
			this.refresh();
			return;
		}
		if (this._store.isDisposed) return;
		this.changedThisVisit = true;
		this.previewDraft();
		this.setStatus('saving');
		this.refresh();
		// Reset has just hidden itself; its control takes the focus, showing the default.
		if (value === undefined) this.rows.get(id)?.view.focus();
		this.scheduleSave();
	}

	/**
	 * Applies the changed settings to every window at once; saving to the account follows.
	 * A failed save leaves the change applied on this computer, as the page says.
	 */
	private previewDraft(): void {
		const draft = this.draft;
		if (draft === undefined) return;
		void this.client.preview({ source: draft.source }).catch(() => undefined);
	}

	private scheduleSave(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.save(), SETTINGS_SAVE_DELAY_MS);
	}

	/** Saves the whole document against the acknowledged revision, one save at a time. */
	private async save(): Promise<void> {
		const draft = this.draft;
		if (this.saving || draft === undefined || this.pending.size === 0) return;
		this.saving = true;
		const saved = new Map(this.pending);
		const source = draft.source;
		const response = await this.client
			.commit({
				source,
				expectedRevision: draft.baseRevision,
				idempotencyKey: crypto.randomUUID()
			})
			.catch(() => ({ kind: 'unavailable' as const }));
		this.saving = false;
		if (this._store.isDisposed) return;
		if (response.kind === 'success') {
			this.ambiguousRetried = false;
			draft.acknowledge(response.projection.source, response.projection.revision);
			this.projection = response.projection;
			for (const [id, value] of saved)
				if (this.pending.get(id) === value) this.pending.delete(id);
			if (this.pending.size > 0) this.scheduleSave();
			else this.setStatus(this.writable() ? 'saved' : 'readonly');
			this.refresh();
			return;
		}
		if (response.kind === 'conflict') {
			// Someone saved meanwhile: start from their settings and apply this page's changes again.
			await this.reapply(response.projection);
			this.scheduleSave();
			return;
		}
		if (response.kind === 'ambiguous' && !this.ambiguousRetried) {
			this.ambiguousRetried = true;
			this.scheduleSave();
			return;
		}
		this.ambiguousRetried = false;
		this.setStatus('failed');
		this.refresh();
		this.toastFailure();
	}

	/** Names the setting that was not saved, wherever its tab is, and offers to try again. */
	private toastFailure(): void {
		const unsaved = [...this.pending.keys()];
		const one = unsaved.length === 1;
		const institution = this.format.institution;
		const body: AccountMessage = one
			? institution === undefined
				? 'settingsKeptHere'
				: 'settingsKeptHereNamed'
			: institution === undefined
				? 'settingsKeptHereMany'
				: 'settingsKeptHereManyNamed';
		const title = one
			? this.format.text('settingNotSavedNamed', { name: this.titleOf(unsaved[0]!) })
			: this.format.text('settingsNotSaved');
		this.pane.toast(title, {
			body: this.format.text(body, institution === undefined ? {} : { institution }),
			retry: () => this.retry()
		});
	}

	private retry(): void {
		this.setStatus('saving');
		this.refresh();
		void this.save();
	}

	private async reapply(projection: UserSettingsProjection): Promise<void> {
		this.adopt(projection);
		const draft = this.draft!;
		for (const [id, value] of this.pending) {
			try {
				await draft.set(id, value);
			} catch {
				this.pending.delete(id);
			}
		}
		this.previewDraft();
		this.refresh();
	}

	private setStatus(status: SettingsSaveStatus): void {
		this.saveStatus = status;
		const entry = statusPresentation[status];
		this.status.dataset.status = status;
		this.statusIcon.element.hidden = entry === undefined;
		if (entry !== undefined) this.statusIcon.setState({ id: entry.icon, size: 16 });
		this.statusText.textContent = entry === undefined ? '' : this.format.text(entry.text);
	}

	// #endregion

	// #region Presentation

	/** Writes one parse of the document into every row, the preview and the page's state. */
	private refresh(): void {
		const writable = this.writable();
		this.root.toggleAttribute('data-readonly', this.projection !== undefined && !writable);
		if (this.projection !== undefined && !writable)
			this.unavailable.show({
				tone: 'neutral',
				icon: proctorIconFactory('status.locked', 18),
				text: this.format.text('settingsUnavailable')
			});
		else this.unavailable.hide();
		const snapshot = snapshotOf(this.draft?.source ?? '{}');
		const failed = this.saveStatus === 'failed';
		for (const [id, { view }] of this.rows)
			view.update({
				value: this.valueIn(snapshot, id),
				changed: snapshot.explicit.has(id),
				disabled: !writable,
				failed: failed && this.pending.has(id)
			});
		this.preview.update(this.previewState(snapshot));
	}

	private openTab(tab: SettingsTab): void {
		this.selectTab(tab);
		this.tabs.find((entry) => entry.tab === tab)?.button.focus();
	}

	private selectTab(tab: SettingsTab): void {
		this.tab = tab;
		this.query = '';
		this.find.value = '';
		this.showView();
	}

	private clearSearch(): void {
		this.query = '';
		this.find.value = '';
		this.showView();
		this.find.focus();
	}

	private onTabKey(event: KeyboardEvent): void {
		const index = settingsTabs.indexOf(this.tab);
		const rtl =
			this.root.ownerDocument.defaultView?.getComputedStyle(this.root).direction === 'rtl';
		const count = settingsTabs.length;
		const targets: Readonly<Record<string, number>> = {
			ArrowRight: (index + (rtl ? -1 : 1) + count) % count,
			ArrowLeft: (index + (rtl ? 1 : -1) + count) % count,
			Home: 0,
			End: count - 1
		};
		const target = targets[event.key];
		if (target === undefined) return;
		event.preventDefault();
		this.openTab(settingsTabs[target]!);
	}

	/** Shows the selected tab, or the rows Find a setting matches across every tab. */
	private showView(): void {
		const searching = isSearching(this.query);
		for (const { tab, button, groups } of this.tabs) {
			button.setAttribute('aria-selected', String(!searching && tab === this.tab));
			// While finding, the selected tab keeps the tab bar's one tab stop.
			button.tabIndex = tab === this.tab ? 0 : -1;
			groups.hidden = searching || tab !== this.tab;
		}
		this.examNote.element.hidden = searching || this.tab !== 'editor';
		this.accessibilityNote.element.hidden = searching || this.tab !== 'accessibility';
		this.preview.element.hidden = searching || this.tab !== 'editor';
		this.returnRowsHome();
		if (searching) this.showMatches();
		else {
			this.results.hidden = true;
			this.empty.hidden = true;
			this.announcedResults = '';
			this.panel.removeAttribute('aria-label');
			this.panel.setAttribute('aria-labelledby', `prctr-settings-tab-${this.tab}`);
		}
	}

	private showMatches(): void {
		const matches = matchingRows(this.query, (row) => this.searchText(row));
		for (const match of matches) {
			const placed = this.rows.get(match.row.id);
			if (placed !== undefined) this.resultsCard.append(placed.view.element);
		}
		const heading = this.format.text('settingsSearchCount', {
			count: this.format.count(matches.length)
		});
		this.resultsTitle.textContent = heading;
		this.emptyTitle.textContent = this.format.text('settingsNoMatch', {
			query: this.query.trim()
		});
		this.results.hidden = matches.length === 0;
		this.empty.hidden = matches.length > 0;
		this.panel.removeAttribute('aria-labelledby');
		this.panel.setAttribute('aria-label', this.format.text('settingsSearchResults'));
		const announcement = matches.length === 0 ? this.emptyTitle.textContent : heading;
		if (announcement !== this.announcedResults) {
			this.announcedResults = announcement;
			this.pane.announce(announcement);
		}
	}

	/** Puts every row back in its own group's card, in the tab's order. */
	private returnRowsHome(): void {
		for (const { view, home } of this.rows.values()) home.append(view.element);
	}

	private previewState(snapshot: SettingsSnapshot): EditorPreviewState {
		const theme = editorThemeName(this.valueIn(snapshot, 'workbench.colorTheme'));
		const fontSize = Number(this.valueIn(snapshot, 'editor.fontSize'));
		return {
			theme,
			fontSize,
			lineHeight: Number(this.valueIn(snapshot, 'editor.lineHeight')),
			tabSize: Number(this.valueIn(snapshot, 'editor.tabSize')),
			lineNumbers: String(this.valueIn(snapshot, 'editor.lineNumbers')),
			label: this.format.text('editorPreviewLabel', { theme, size: fontSize })
		};
	}

	private describe(id: EffectiveSettingId): {
		readonly title: string;
		readonly description: string;
	} {
		const declaration = settingsRegistry.declaration(id)!;
		return {
			title: this.localization.format(declaration.title),
			description: this.localization.format(declaration.description)
		};
	}

	private titleOf(id: EffectiveSettingId): string {
		return this.describe(id).title;
	}

	private searchText(row: SettingRow): SettingSearchText {
		return {
			...this.describe(row.id),
			choices: this.choicesOf(row).map((choice) => choice.label),
			keywords:
				row.keywords === undefined ? '' : this.format.text(row.keywords as AccountMessage)
		};
	}

	/** The row's choices in the page's language; the editor theme lists the named themes. */
	private choicesOf(row: SettingRow): readonly SettingRowChoice[] {
		if (row.id === 'workbench.colorTheme')
			return (settingsRegistry.declaration(row.id)!.enum ?? [])
				.filter((name) => typeof name === 'string' && !SCHEME_ALIASES.has(name))
				.map((name) => ({ value: String(name), label: String(name) }));
		const control = row.control;
		if (control.kind !== 'segmented' && control.kind !== 'select') return [];
		return control.choices.map((choice) => ({
			value: choice.value,
			label: this.choiceLabel(choice)
		}));
	}

	/** How a value reads on its own, as Reset names the default: “14 px”, “On”, “System”. */
	private valueLabel(row: SettingRow, value: SettingValue): string {
		const control = row.control;
		if (control.kind === 'switch')
			return this.format.text(value === true ? 'choiceOn' : 'choiceOff');
		if (control.kind === 'stepper') return this.format.text('pixels', { value: Number(value) });
		if (row.id === 'workbench.colorTheme') return editorThemeName(value);
		const choice = choiceFor(row, value);
		return choice === undefined ? String(value) : this.choiceLabel(choice);
	}

	private choiceLabel(choice: SettingChoice): string {
		if (choice.label === 'motionFollowSystem')
			return this.format.text('motionFollowSystem', {
				system: isMacintosh ? 'macOS' : isWindows ? 'Windows' : 'Linux'
			});
		if (choice.label.startsWith('percent:'))
			return this.format.text('percentValue', { value: Number(choice.label.slice(8)) });
		if (choice.label.startsWith('number:')) return choice.label.slice(7);
		return this.format.text(choice.label as AccountMessage);
	}

	// #endregion
}

function snapshotOf(source: string): SettingsSnapshot {
	const document = parseSettingsDocument(source);
	return {
		authenticated: new EffectiveSettings(document, { window: 'authenticated' }),
		candidate: new EffectiveSettings(document, { window: 'candidate' }),
		explicit: new Set(document.values.keys())
	};
}

/** The tab bar's word for each save status; `idle` shows nothing. */
const statusPresentation: Readonly<
	Record<
		SettingsSaveStatus,
		| {
				readonly text: AccountMessage;
				readonly icon:
					'status.saved' | 'status.saving' | 'status.attention' | 'status.locked';
		  }
		| undefined
	>
> = Object.freeze({
	idle: undefined,
	saved: { text: 'settingsSaved', icon: 'status.saved' },
	saving: { text: 'settingsSaving', icon: 'status.saving' },
	failed: { text: 'settingsNotSavedShort', icon: 'status.attention' },
	readonly: { text: 'settingsReadOnly', icon: 'status.locked' }
});

const tabMessages: Readonly<Record<SettingsTab, AccountMessage>> = Object.freeze({
	appearance: 'settingsTabAppearance',
	editor: 'settingsTabEditor',
	accessibility: 'settingsTabAccessibility'
});
