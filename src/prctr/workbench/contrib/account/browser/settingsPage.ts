/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAccountFormatService } from './accountFormat.js';
import { IAccountPaneContext } from './accountPaneContext.js';
import { ILocalizationService } from '../../../services/localization/common/localization.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { BannerControl } from '../../../../base/browser/ui/banner/bannerControl.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { SegmentedControl } from '../../../../base/browser/ui/segmented/segmentedControl.js';
import { SelectControl } from '../../../../base/browser/ui/select/selectControl.js';
import { StepperControl } from '../../../../base/browser/ui/stepper/stepperControl.js';
import { SwitchControl } from '../../../../base/browser/ui/switch/switchControl.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
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
	matchingRows,
	SETTINGS_SAVE_DELAY_MS,
	settingsLayout,
	settingsTabIcons,
	settingsTabs,
	type SettingChoice,
	type SettingGroup,
	type SettingRow,
	type SettingsSaveStatus,
	type SettingsTab
} from '../common/settingsPresentation.js';
import type { AccountMessage } from './accountMessages.js';
import type { AccountPageView } from './accountPages.js';
import './settingsPage.css';
import { SCHEME_THEME_NAMES } from '../../../../platform/theme/common/bundledThemes.js';
import { getTheme } from '../../../../platform/theme/common/themes.js';
import type { ControlIconFactory } from '../../../../base/browser/ui/controlIcon.js';

/** The scheme aliases are for the exam window's own choice; the page lists named themes. */
const SCHEME_ALIASES = new Set(['light', 'dark', 'hcLight', 'hcDark']);

type Value = string | number | boolean;

/**
 * Settings: Proctor's own page for the registered settings, in four tabs. Every change saves
 * itself a moment later to the account's settings, so they follow the person to any computer.
 * Nobody edits settings.json; a conflicting save from elsewhere is merged by applying this
 * page's pending changes again on top of the newer settings.
 */
export class SettingsPage extends Disposable implements AccountPageView {
	private readonly status: HTMLElement;
	private readonly statusIcon: ProctorIconControl;
	private readonly statusText: HTMLElement;
	private readonly tabs: readonly {
		readonly tab: SettingsTab;
		readonly button: HTMLButtonElement;
	}[];
	private readonly find: HTMLInputElement;
	private readonly banner: BannerControl;
	private readonly preview: HTMLElement;
	private readonly groups: HTMLElement;
	private readonly rows = this._register(new DisposableStore());

	private tab: SettingsTab = 'appearance';
	private query = '';
	private projection: UserSettingsProjection | undefined;
	private draft: SettingsDraft | undefined;
	/** Changes not yet acknowledged by the server, applied again after a conflict. */
	private readonly pending = new Map<EffectiveSettingId, Value | undefined>();
	private saving = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private ambiguousRetried = false;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IAccountPaneContext private readonly pane: IAccountPaneContext,
		@ILocalizationService private readonly localization: ILocalizationService,
		@IUserSettingsService private readonly client: IUserSettingsService
	) {
		super();
		const document = body.ownerDocument;
		const $ = createElementFactory(document);
		this.statusIcon = this._register(
			createProctorIcon(document, { id: 'status.saved', size: 16 })
		);
		this.statusText = $('span');
		this.status = $(
			'span.prctr-settings-page__status',
			{ attrs: { role: 'status' } },
			this.statusIcon.element,
			this.statusText
		);
		headerActions.append(this.status);

		const tablist = $('div.prctr-settings-page__tabs', {
			attrs: { role: 'tablist', 'aria-label': this.format.text('settingsTitle') }
		});
		this.tabs = settingsTabs.map((tab) => {
			const button = $(
				'button.prctr-settings-page__tab',
				{ type: 'button', attrs: { role: 'tab', 'aria-controls': 'prctr-settings-panel' } },
				this._register(createProctorIcon(document, { id: settingsTabIcons[tab], size: 16 }))
					.element,
				this.format.text(tabMessages[tab])
			);
			tablist.append(button);
			this._register(addDisposableListener(button, 'click', () => this.selectTab(tab)));
			return { tab, button };
		});
		this._register(
			addDisposableListener(tablist, 'keydown', (event) => {
				const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
				if (step === 0) return;
				event.preventDefault();
				const index = settingsTabs.indexOf(this.tab);
				const next =
					settingsTabs[(index + step + settingsTabs.length) % settingsTabs.length]!;
				this.selectTab(next);
				this.tabs.find((entry) => entry.tab === next)?.button.focus();
			})
		);
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
		const toolbar = $('div.prctr-settings-page__toolbar', {}, tablist, find);
		const root = $('div.prctr-settings-page');
		body.append(root);
		// The banner states a condition of the whole page, so it comes before the tabs.
		this.banner = this._register(new BannerControl(root));
		root.append(toolbar);
		this.preview = $('div.prctr-settings-page__preview', { hidden: true });
		this.groups = $('div.prctr-settings-page__groups', {
			id: 'prctr-settings-panel',
			attrs: { role: 'tabpanel' }
		});
		root.append(this.preview, this.groups);
		this._register(
			addDisposableListener(this.find, 'input', () => {
				this.query = this.find.value;
				this.render();
			})
		);
		const unsubscribe = client.onDidChange((projection) => this.receive(projection));
		this._register(toDisposable(unsubscribe));
		this._register(toDisposable(() => clearTimeout(this.timer)));
		this._register(toDisposable(() => this.draft?.dispose()));
		void client.projection().then(
			(projection) => this.receive(projection),
			() => this.setStatus('failed')
		);
		this.render();
	}

	setVisible(): void {}

	// #region Reading

	/** A newer projection replaces the draft unless this page still has changes to save. */
	private receive(projection: UserSettingsProjection): void {
		if (this._store.isDisposed) return;
		if (this.saving || this.pending.size > 0) {
			this.projection = projection;
			return;
		}
		this.adopt(projection);
		this.setStatus(this.writable() ? 'saved' : 'readonly');
		this.render();
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

	private values(): {
		readonly authenticated: EffectiveSettings;
		readonly candidate: EffectiveSettings;
		readonly explicit: ReadonlySet<string>;
	} {
		const document = parseSettingsDocument(this.draft?.source ?? '{}');
		return {
			authenticated: new EffectiveSettings(document, { window: 'authenticated' }),
			candidate: new EffectiveSettings(document, { window: 'candidate' }),
			explicit: new Set(document.values.keys())
		};
	}

	private settingValue(id: EffectiveSettingId): Value {
		const values = this.values();
		const declaration = settingsRegistry.declaration(id)!;
		const effective = declaration.windows.includes('authenticated')
			? values.authenticated
			: values.candidate;
		return effective.get(id) as Value;
	}

	// #endregion

	// #region Saving

	private async change(id: EffectiveSettingId, value: Value | undefined): Promise<void> {
		const draft = this.draft;
		if (draft === undefined || !this.writable()) return;
		this.pending.set(id, value);
		try {
			await draft.set(id, value);
		} catch {
			this.pending.delete(id);
			this.pane.toast(this.format.text('settingsNotSaved'), {
				body: this.format.text('settingsInvalid')
			});
			this.render();
			return;
		}
		if (this._store.isDisposed) return;
		this.previewDraft();
		this.setStatus('saving');
		this.render();
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
			else this.setStatus('saved');
			this.render();
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
		this.pane.toast(this.format.text('settingsNotSaved'), {
			body: this.format.text('settingsKeptHere'),
			retry: () => {
				this.setStatus('saving');
				void this.save();
			}
		});
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
		this.render();
	}

	private setStatus(status: SettingsSaveStatus): void {
		const presentation: Readonly<
			Record<
				SettingsSaveStatus,
				{
					readonly text: AccountMessage;
					readonly icon:
						'status.saved' | 'status.saving' | 'status.attention' | 'status.locked';
				}
			>
		> = {
			saved: { text: 'settingsSaved', icon: 'status.saved' },
			saving: { text: 'settingsSaving', icon: 'status.saving' },
			failed: { text: 'settingsNotSavedShort', icon: 'status.attention' },
			readonly: { text: 'settingsReadOnly', icon: 'status.locked' }
		};
		const entry = presentation[status];
		this.status.dataset.status = status;
		this.statusIcon.setState({ id: entry.icon, size: 16 });
		this.statusText.textContent = this.format.text(entry.text);
	}

	// #endregion

	// #region Presentation

	private selectTab(tab: SettingsTab): void {
		this.tab = tab;
		this.query = '';
		this.find.value = '';
		this.render();
	}

	private render(): void {
		for (const { tab, button } of this.tabs) {
			const selected = tab === this.tab && this.query.trim() === '';
			button.setAttribute('aria-selected', String(selected));
			button.tabIndex = tab === this.tab ? 0 : -1;
		}
		this.rows.clear();
		this.groups.replaceChildren();
		if (this.projection === undefined) {
			this.banner.hide();
			this.preview.hidden = true;
			return;
		}
		if (!this.writable())
			this.banner.show({
				tone: 'neutral',
				icon: proctorIconFactory('status.locked', 18),
				text: this.format.text('settingsUnavailable')
			});
		else if (this.tab === 'editor' && this.query.trim() === '')
			this.banner.show({
				tone: 'info',
				icon: proctorIconFactory('status.info', 18),
				text: this.format.text('settingsExamOverride')
			});
		else this.banner.hide();
		const searching = this.query.trim() !== '';
		this.preview.hidden = searching || this.tab !== 'editor';
		if (!this.preview.hidden) this.renderPreview();
		const groups: readonly SettingGroup[] = searching
			? [
					{
						title: 'settingsSearchResults',
						rows: matchingRows(this.query, (id) => this.describe(id))
					}
				]
			: settingsLayout[this.tab];
		const $ = createElementFactory(this.groups.ownerDocument);
		for (const group of groups) {
			const card = $('div.prctr-settings-page__card');
			for (const row of group.rows) card.append(this.renderRow($, row));
			if (group.rows.length === 0)
				card.append(
					$('p.prctr-settings-page__empty', {
						textContent: this.format.text('settingsNoMatch')
					})
				);
			this.groups.append(
				$(
					'section.prctr-settings-page__group',
					{},
					$('h2.prctr-settings-page__group-title', {
						textContent: this.format.text(group.title as AccountMessage)
					}),
					card
				)
			);
		}
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

	private choiceLabel(choice: SettingChoice): string {
		if (choice.label.startsWith('percent:'))
			return this.format.text('percentValue', { value: Number(choice.label.slice(8)) });
		if (choice.label.startsWith('number:')) return choice.label.slice(7);
		return this.format.text(choice.label as AccountMessage);
	}

	private renderRow($: ReturnType<typeof createElementFactory>, row: SettingRow): HTMLElement {
		const { title, description } = this.describe(row.id);
		const value = this.settingValue(row.id);
		const changed = this.values().explicit.has(row.id);
		const disabled = !this.writable();
		const element = $(
			'div.prctr-settings-page__row',
			{ data: { setting: row.id } },
			$(
				'div.prctr-settings-page__text',
				{},
				$('span.prctr-settings-page__title', { textContent: title }),
				$('span.prctr-settings-page__description', { textContent: description })
			)
		);
		if (changed) {
			const reset = this.rows.add(
				new ButtonControl(element, {
					variant: 'ghost',
					size: 'small',
					label: this.format.text('resetSetting'),
					accessibleLabel: this.format.text('resetSettingNamed', { name: title }),
					icon: proctorIconFactory('action.reset', 14),
					disabled
				})
			);
			this.rows.add(reset.onDidRequest(() => void this.change(row.id, undefined)));
		}
		const control = row.control;
		if (control.kind === 'switch') {
			const toggle = this.rows.add(
				new SwitchControl(element, { label: title, on: value === true, disabled })
			);
			this.rows.add(toggle.onDidChange((on) => void this.change(row.id, on)));
		} else if (control.kind === 'stepper') {
			const stepper = this.rows.add(
				new StepperControl(element, {
					label: title,
					value: Number(value),
					minimum: control.minimum,
					maximum: control.maximum,
					format: (current) => this.format.text('pixels', { value: current }),
					decreaseLabel: this.format.text('smaller'),
					increaseLabel: this.format.text('larger'),
					decreaseIcon: proctorIconFactory('action.decrease', 12),
					increaseIcon: proctorIconFactory('action.increase', 12),
					disabled
				})
			);
			this.rows.add(stepper.onDidChange((next) => void this.change(row.id, next)));
		} else if (control.kind === 'segmented') {
			// Word wrap's other enum values are a kind of On.
			const selected = row.id === 'editor.wordWrap' && value !== 'off' ? 'on' : String(value);
			const segmented = this.rows.add(
				new SegmentedControl(element, {
					label: title,
					value: selected,
					disabled,
					options: control.choices.map((choice) => ({
						value: String(choice.value),
						label: this.choiceLabel(choice),
						...(choice.icon === undefined
							? {}
							: { icon: proctorIconFactory(choice.icon, 14) })
					}))
				})
			);
			this.rows.add(
				segmented.onDidChange((next) => {
					const choice = control.choices.find((entry) => String(entry.value) === next);
					if (choice !== undefined) void this.change(row.id, choice.value);
				})
			);
		} else {
			const choices =
				row.id === 'workbench.colorTheme'
					? (settingsRegistry.declaration(row.id)!.enum ?? [])
							.filter((name) => typeof name === 'string' && !SCHEME_ALIASES.has(name))
							.map((name) => ({ value: String(name), label: String(name) }))
					: control.choices.map((choice) => ({
							value: String(choice.value),
							label: this.choiceLabel(choice)
						}));
			const current =
				row.id === 'workbench.colorTheme' ? editorThemeName(value) : String(value);
			if (!choices.some((choice) => choice.value === current))
				choices.unshift({ value: current, label: current });
			const select = this.rows.add(
				new SelectControl(element, {
					label: title,
					value: current,
					choices,
					caret: proctorIconFactory('action.expand', 14),
					...(row.id === 'workbench.colorTheme' ? { icon: themeSwatch(current) } : {}),
					disabled
				})
			);
			this.rows.add(
				select.onDidChange((next) => {
					const choice = control.choices.find((entry) => String(entry.value) === next);
					void this.change(row.id, choice?.value ?? next);
				})
			);
		}
		return element;
	}

	/** A few lines of code drawn with the editor settings as chosen. */
	private renderPreview(): void {
		const $ = createElementFactory(this.preview.ownerDocument);
		const size = Number(this.settingValue('editor.fontSize'));
		const height = Number(this.settingValue('editor.lineHeight'));
		const lineNumbers = this.settingValue('editor.lineNumbers');
		const numbers = lineNumbers !== 'off';
		const tab = Number(this.settingValue('editor.tabSize'));
		const theme = editorThemeName(this.settingValue('workbench.colorTheme'));
		const indent = ' '.repeat(tab);
		const lines: readonly (readonly [string, string][])[] = [
			[
				['keyword', 'def'],
				['', ' '],
				['function', 'mean'],
				['', '(values):']
			],
			[
				['', indent],
				['keyword', 'if not'],
				['', ' values:']
			],
			[
				['', indent + indent],
				['keyword', 'return'],
				['', ' '],
				['number', '0']
			],
			[
				['', `${indent}total = `],
				['function', 'sum'],
				['', '(values)']
			],
			[
				['', indent],
				['keyword', 'return'],
				['', ' total / '],
				['function', 'len'],
				['', '(values)']
			]
		];
		const code = $('div.prctr-settings-page__code', {
			attrs: { 'aria-label': this.format.text('editorPreview') }
		});
		code.style.fontSize = `${size}px`;
		code.style.lineHeight = `${height}px`;
		// The preview is drawn in the chosen editor theme, whatever the window theme is.
		const palette = editorPalette(theme);
		setColor(code, '--prctr-preview-background', palette.background);
		setColor(code, '--prctr-preview-foreground', palette.foreground);
		setColor(code, '--prctr-preview-border', palette.border);
		setColor(code, '--prctr-preview-line-number', palette.lineNumber);
		setColor(code, '--prctr-preview-line-number-active', palette.activeLineNumber);
		setColor(code, '--prctr-preview-keyword', palette.keyword);
		setColor(code, '--prctr-preview-function', palette.function);
		setColor(code, '--prctr-preview-number', palette.number);
		lines.forEach((tokens, index) => {
			const line = $('div.prctr-settings-page__line');
			if (numbers)
				line.append(
					$('span.prctr-settings-page__number', {
						// Relative numbers count from the line holding the cursor, which keeps its own.
						textContent: String(
							lineNumbers === 'relative' && index !== PREVIEW_CURSOR_LINE
								? Math.abs(index - PREVIEW_CURSOR_LINE)
								: index + 1
						),
						data: { current: String(index === PREVIEW_CURSOR_LINE) },
						attrs: { 'aria-hidden': 'true' }
					})
				);
			for (const [kind, text] of tokens)
				line.append(
					$('span', { textContent: text, ...(kind ? { data: { token: kind } } : {}) })
				);
			code.append(line);
		});
		this.preview.replaceChildren(
			$('span.prctr-settings-page__preview-label', {
				textContent: this.format.text('editorPreviewLabel', { theme, size })
			}),
			code
		);
	}

	// #endregion
}

/** A scheme alias such as `dark` is shown as the theme it stands for. */
function editorThemeName(value: unknown): string {
	const name = String(value);
	return name in SCHEME_THEME_NAMES
		? SCHEME_THEME_NAMES[name as keyof typeof SCHEME_THEME_NAMES]
		: name;
}

/** A chip of the theme's editor background, edged with its function colour. */
/** The preview line that holds the cursor, from 0; relative line numbers count from it. */
const PREVIEW_CURSOR_LINE = 2;

/** The colours of an editor theme that the preview and the theme chip need. */
interface EditorPalette {
	readonly background?: string;
	readonly foreground?: string;
	readonly border?: string;
	readonly lineNumber?: string;
	readonly activeLineNumber?: string;
	readonly keyword?: string;
	readonly function?: string;
	readonly number?: string;
}

/** Reads a bundled editor theme's colours; an unknown theme gives none, and defaults apply. */
function editorPalette(name: string): EditorPalette {
	try {
		const theme = getTheme(name);
		const token = (wanted: string): string | undefined =>
			theme.colorTheme.tokenColors.find((entry) =>
				(Array.isArray(entry.scope) ? entry.scope : [entry.scope]).some(
					(scope) => typeof scope === 'string' && scope.split(/[,\s]+/).includes(wanted)
				)
			)?.settings.foreground;
		return {
			background: theme.colors['editor.background'],
			foreground: theme.colors['editor.foreground'],
			border: theme.colors['editorGroup.border'] ?? theme.colors['panel.border'],
			lineNumber: theme.colors['editorLineNumber.foreground'],
			activeLineNumber: theme.colors['editorLineNumber.activeForeground'],
			keyword: token('keyword'),
			function: token('entity.name.function'),
			number: token('constant.numeric') ?? token('constant')
		};
	} catch {
		return {};
	}
}

function setColor(element: HTMLElement, property: string, value: string | undefined): void {
	if (value === undefined) element.style.removeProperty(property);
	else element.style.setProperty(property, value);
}

/** A chip of the theme's editor background, edged with its function colour. */
function themeSwatch(name: string): ControlIconFactory {
	return (document) => {
		const element = createElementFactory(document)('span.prctr-settings-page__swatch', {
			attrs: { 'aria-hidden': 'true' }
		});
		const palette = editorPalette(name);
		setColor(element, '--prctr-swatch-background', palette.background);
		setColor(element, '--prctr-swatch-border', palette.border);
		setColor(element, '--prctr-swatch-accent', palette.function);
		return { element, dispose: () => element.remove() };
	};
}

const tabMessages: Readonly<Record<SettingsTab, AccountMessage>> = Object.freeze({
	appearance: 'settingsTabAppearance',
	editor: 'settingsTabEditor',
	accessibility: 'settingsTabAccessibility',
	browser: 'settingsTabBrowser'
});
