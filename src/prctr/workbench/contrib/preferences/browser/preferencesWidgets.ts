/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-presentation

import * as DOM from '../../../../base/browser/dom.js';

import { ActionBar, ActionsOrientation } from '../../../../base/browser/ui/actionbar/actionbar.js';
import type { HistoryInputBox, IHistoryInputOptions } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { Widget } from '../../../../base/browser/ui/widget.js';
import { Action } from '../../../../base/common/actions.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { type ICodeEditor, type IEditorMouseEvent, MouseTargetType } from '../../../../editor/browser/editorBrowser.js';
import type { IEditorDecorationsCollection } from '../../../../editor/common/editorCommon.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { type IModelDeltaDecoration, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { type IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { ContextScopedHistoryInputBox } from '../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { showHistoryKeybindingHint } from '../../../../platform/history/browser/historyWidgetKeybindingHint.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { asCssVariable, badgeBackground, badgeForeground, contrastBorder } from '../../../../platform/theme/common/colorRegistry.js';
import { settingsEditIcon } from './preferencesIcons.js';

export type SettingsTarget = ConfigurationTarget.APPLICATION | ConfigurationTarget.USER_LOCAL | ConfigurationTarget.USER_REMOTE | ConfigurationTarget.WORKSPACE | URI;

export class SettingsTargetsWidget extends Widget {

	private settingsSwitcherBar!: ActionBar;
	private userLocalSettings!: Action;
	private _settingsTarget: SettingsTarget | null = null;

	private readonly _onDidTargetChange = this._register(new Emitter<SettingsTarget>());
	readonly onDidTargetChange: Event<SettingsTarget> = this._onDidTargetChange.event;

	constructor(
		parent: HTMLElement,
		@ILanguageService private readonly languageService: ILanguageService
	) {
		super();
		this.create(parent);
	}

	private resetLabels() {
		this.userLocalSettings.label = localize('userSettings', "User");
	}

	private create(parent: HTMLElement): void {
		const settingsTabsWidget = DOM.append(parent, DOM.$('.settings-tabs-widget'));
		this.settingsSwitcherBar = this._register(new ActionBar(settingsTabsWidget, {
			orientation: ActionsOrientation.HORIZONTAL,
			focusOnlyEnabledItems: true,
			ariaLabel: localize('settingsSwitcherBarAriaLabel', "Settings Switcher"),
			ariaRole: 'tablist'
		}));

		this.userLocalSettings = this._register(new Action('userSettings', '', '.settings-tab', true, () => this.updateTarget(ConfigurationTarget.USER_LOCAL)));
		this.userLocalSettings.tooltip = localize('userSettings', "User");

		this.resetLabels();

		this.settingsSwitcherBar.push([this.userLocalSettings]);
	}

	get settingsTarget(): SettingsTarget | null {
		return this._settingsTarget;
	}

	set settingsTarget(settingsTarget: SettingsTarget | null) {
		if (settingsTarget !== null && settingsTarget !== ConfigurationTarget.USER_LOCAL) throw new Error('Settings has one user target.');
		this._settingsTarget = settingsTarget;
		this.userLocalSettings.checked = ConfigurationTarget.USER_LOCAL === this.settingsTarget;
	}

	setResultCount(settingsTarget: SettingsTarget, count: number): void {
		if (settingsTarget === ConfigurationTarget.USER_LOCAL) {
			let label = localize('userSettings', "User");
			if (count) {
				label += ` (${count})`;
			}

			this.userLocalSettings.label = label;
		}
	}

	updateLanguageFilterIndicators(filter: string | undefined) {
		this.resetLabels();
		if (filter) {
			const languageToUse = this.languageService.getLanguageName(filter);
			if (languageToUse) {
				const languageSuffix = ` [${languageToUse}]`;
				this.userLocalSettings.label += languageSuffix;
			}
		}
	}

	updateTarget(settingsTarget: SettingsTarget): Promise<void> {
		const isSameTarget = this.settingsTarget === settingsTarget;

		if (!isSameTarget) {
			this.settingsTarget = settingsTarget;
			this._onDidTargetChange.fire(this.settingsTarget);
		}

		return Promise.resolve(undefined);
	}

}

export interface SearchOptions extends IHistoryInputOptions {
	focusKey?: IContextKey<boolean>;
	showResultCount?: boolean;
	ariaLive?: string;
	ariaLabelledBy?: string;
}

export class SearchWidget extends Widget {

	domNode!: HTMLElement;

	private countElement!: HTMLElement;
	private searchContainer!: HTMLElement;
	inputBox!: HistoryInputBox;
	private controlsDiv!: HTMLElement;

	private readonly _onDidChange: Emitter<string> = this._register(new Emitter<string>());
	public get onDidChange(): Event<string> { return this._onDidChange.event; }

	private readonly _onFocus: Emitter<void> = this._register(new Emitter<void>());
	public get onFocus(): Event<void> { return this._onFocus.event; }

	constructor(parent: HTMLElement, protected options: SearchOptions,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IKeybindingService protected readonly keybindingService: IKeybindingService
	) {
		super();
		this.create(parent);
	}

	private create(parent: HTMLElement) {
		this.domNode = DOM.append(parent, DOM.$('div.settings-header-widget'));
		this.createSearchContainer(DOM.append(this.domNode, DOM.$('div.settings-search-container')));
		this.controlsDiv = DOM.append(this.domNode, DOM.$('div.settings-search-controls'));

		if (this.options.showResultCount) {
			this.countElement = DOM.append(this.controlsDiv, DOM.$('.settings-count-widget'));

			this.countElement.style.backgroundColor = asCssVariable(badgeBackground);
			this.countElement.style.color = asCssVariable(badgeForeground);
			this.countElement.style.border = `1px solid ${asCssVariable(contrastBorder)}`;
		}

		this.inputBox.inputElement.setAttribute('aria-live', this.options.ariaLive || 'off');
		if (this.options.ariaLabelledBy) {
			this.inputBox.inputElement.setAttribute('aria-labelledBy', this.options.ariaLabelledBy);
		}
		const focusTracker = this._register(DOM.trackFocus(this.inputBox.inputElement));
		this._register(focusTracker.onDidFocus(() => this._onFocus.fire()));

		const focusKey = this.options.focusKey;
		if (focusKey) {
			this._register(focusTracker.onDidFocus(() => focusKey.set(true)));
			this._register(focusTracker.onDidBlur(() => focusKey.set(false)));
		}
	}

	private createSearchContainer(searchContainer: HTMLElement) {
		this.searchContainer = searchContainer;
		const searchInput = DOM.append(this.searchContainer, DOM.$('div.settings-search-input'));
		this.inputBox = this._register(this.createInputBox(searchInput));
		this._register(this.inputBox.onDidChange(value => this._onDidChange.fire(value)));
	}

	protected createInputBox(parent: HTMLElement): HistoryInputBox {
		const showHistoryHint = () => showHistoryKeybindingHint(this.keybindingService);
		return new ContextScopedHistoryInputBox(parent, this.contextViewService, { ...this.options, showHistoryHint }, this.contextKeyService);
	}

	showMessage(message: string): void {
		// Avoid setting the aria-label unnecessarily, the screenreader will read the count every time it's set, since it's aria-live:assertive. #50968
		if (this.countElement && message !== this.countElement.textContent) {
			this.countElement.textContent = message;
			this.inputBox.inputElement.setAttribute('aria-label', message);
			this.inputBox.inputElement.style.paddingRight = this.getControlsWidth() + 'px';
		}
	}

	layout(dimension: DOM.Dimension) {
		if (dimension.width < 400) {
			this.countElement?.classList.add('hide');

			this.inputBox.inputElement.style.paddingRight = '0px';
		} else {
			this.countElement?.classList.remove('hide');

			this.inputBox.inputElement.style.paddingRight = this.getControlsWidth() + 'px';
		}
	}

	private getControlsWidth(): number {
		const countWidth = this.countElement ? DOM.getTotalWidth(this.countElement) : 0;
		return countWidth + 20;
	}

	focus() {
		this.inputBox.focus();
		if (this.getValue()) {
			this.inputBox.select();
		}
	}

	hasFocus(): boolean {
		return this.inputBox.hasFocus();
	}

	clear() {
		this.inputBox.value = '';
	}

	getValue(): string {
		return this.inputBox.value;
	}

	setValue(value: string): string {
		return this.inputBox.value = value;
	}

	override dispose(): void {
		this.options.focusKey?.set(false);
		super.dispose();
	}
}

export class EditPreferenceWidget<T> extends Disposable {

	private _line: number = -1;
	private _preferences: T[] = [];

	private readonly _editPreferenceDecoration: IEditorDecorationsCollection;

	private readonly _onClick = this._register(new Emitter<IEditorMouseEvent>());
	readonly onClick: Event<IEditorMouseEvent> = this._onClick.event;

	constructor(private editor: ICodeEditor) {
		super();
		this._editPreferenceDecoration = this.editor.createDecorationsCollection();
		this._register(this.editor.onMouseDown((e: IEditorMouseEvent) => {
			if (e.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN || e.target.detail.isAfterLines || !this.isVisible()) {
				return;
			}
			this._onClick.fire(e);
		}));
	}

	get preferences(): T[] {
		return this._preferences;
	}

	getLine(): number {
		return this._line;
	}

	show(line: number, hoverMessage: string, preferences: T[]): void {
		this._preferences = preferences;
		const newDecoration: IModelDeltaDecoration[] = [];
		this._line = line;
		newDecoration.push({
			options: {
				description: 'edit-preference-widget-decoration',
				glyphMarginClassName: ThemeIcon.asClassName(settingsEditIcon),
				glyphMarginHoverMessage: new MarkdownString().appendText(hoverMessage),
				stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
			},
			range: {
				startLineNumber: line,
				startColumn: 1,
				endLineNumber: line,
				endColumn: 1
			}
		});
		this._editPreferenceDecoration.set(newDecoration);
	}

	hide(): void {
		this._editPreferenceDecoration.clear();
	}

	isVisible(): boolean {
		return this._editPreferenceDecoration.length > 0;
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}
