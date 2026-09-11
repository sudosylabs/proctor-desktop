/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port editor-browser-core

import { DisposableStore, toDisposable, type IDisposable, Disposable } from '../common/lifecycle.js';
import { autorun, type IObservable } from '../common/observable.js';
import { getWindows } from './dom.js';
import { mainWindow } from './window.js';
import { StyleSheetHandle } from './styleSheetHandle.js';
export type { StyleSheetHandle } from './styleSheetHandle.js';

const globalStylesheets = new Map<StyleSheetHandle /* main stylesheet */, Set<StyleSheetHandle /* aux window clones that track the main stylesheet */>>();

export function isGlobalStylesheet(node: Node): boolean {
	return [...globalStylesheets.keys()].some(style => style.anchor === node);
}

class WrappedStyleElement extends Disposable {
	private _currentCssStyle = '';
	private _styleSheet: StyleSheetHandle | undefined = undefined;

	setStyle(cssStyle: string): void {
		if (cssStyle === this._currentCssStyle) {
			return;
		}
		this._currentCssStyle = cssStyle;

		if (!this._styleSheet) {
			this._styleSheet = createStyleSheet(mainWindow.document.head, s => s.textContent = cssStyle, this._store);
		} else {
			this._styleSheet.textContent = cssStyle;
		}
	}

	override dispose(): void {
		super.dispose();

		this._styleSheet = undefined;
	}
}

export function createStyleSheet(container: HTMLElement = mainWindow.document.head, beforeAppend?: (style: StyleSheetHandle) => void, disposableStore?: DisposableStore): StyleSheetHandle {
	const style = new StyleSheetHandle(container);
	try { beforeAppend?.(style); } catch (error) { style.dispose(); throw error; }
	disposableStore?.add(style);

	// With <head> as container, the stylesheet becomes global and is tracked
	// to support auxiliary windows to clone the stylesheet.
	if (container === mainWindow.document.head) {
		const globalStylesheetClones = new Set<StyleSheetHandle>();
		globalStylesheets.set(style, globalStylesheetClones);
		style.onDidRemove(() => {
			globalStylesheets.delete(style);
			for (const clone of [...globalStylesheetClones]) clone.dispose();
		});

		for (const { window: targetWindow, disposables } of getWindows()) {
			if (targetWindow === mainWindow) {
				continue; // main window is already tracked
			}

			const cloneDisposable = disposables.add(cloneGlobalStyleSheet(style, globalStylesheetClones, targetWindow));
			disposableStore?.add(cloneDisposable);
		}
	}

	return style;
}

export function cloneGlobalStylesheets(targetWindow: Window): IDisposable {
	const disposables = new DisposableStore();

	for (const [globalStylesheet, clonedGlobalStylesheets] of globalStylesheets) {
		disposables.add(cloneGlobalStyleSheet(globalStylesheet, clonedGlobalStylesheets, targetWindow));
	}

	return disposables;
}

function cloneGlobalStyleSheet(globalStylesheet: StyleSheetHandle, globalStylesheetClones: Set<StyleSheetHandle>, targetWindow: Window): IDisposable {
	const disposables = new DisposableStore();

	const clone = new StyleSheetHandle(targetWindow.document.head);
	disposables.add(toDisposable(() => clone.remove()));

	for (const rule of globalStylesheet.sheet?.cssRules ?? []) {
		clone.sheet?.insertRule(rule.cssText, clone.sheet?.cssRules.length);
	}

	disposables.add(globalStylesheet.onDidChangeTextContent(value => {
		clone.textContent = value;
	}));
	disposables.add(globalStylesheet.onDidRemove(() => disposables.dispose()));

	globalStylesheetClones.add(clone);
	disposables.add(toDisposable(() => globalStylesheetClones.delete(clone)));

	return disposables;
}

let _sharedStyleSheet: StyleSheetHandle | null = null;
function getSharedStyleSheet(): StyleSheetHandle {
	if (!_sharedStyleSheet) {
		_sharedStyleSheet = createStyleSheet();
	}
	return _sharedStyleSheet;
}

export function createCSSRule(selector: string, cssText: string, style = getSharedStyleSheet()): void {
	if (!style || !cssText) {
		return;
	}

	style.sheet?.insertRule(`${selector} {${cssText}}`, 0);

	// Apply rule also to all cloned global stylesheets
	for (const clonedGlobalStylesheet of globalStylesheets.get(style) ?? []) {
		createCSSRule(selector, cssText, clonedGlobalStylesheet);
	}
}

export function removeCSSRulesContainingSelector(ruleName: string, style = getSharedStyleSheet()): void {
	if (!style) {
		return;
	}

	const rules = style.sheet?.cssRules ?? [];
	const toDelete: number[] = [];
	for (let i = 0; i < rules.length; i++) {
		const rule = rules[i];
		if (isCSSStyleRule(rule) && rule.selectorText.indexOf(ruleName) !== -1) {
			toDelete.push(i);
		}
	}

	for (let i = toDelete.length - 1; i >= 0; i--) {
		style.sheet?.deleteRule(toDelete[i]);
	}

	// Remove rules also from all cloned global stylesheets
	for (const clonedGlobalStylesheet of globalStylesheets.get(style) ?? []) {
		removeCSSRulesContainingSelector(ruleName, clonedGlobalStylesheet);
	}
}

function isCSSStyleRule(rule: CSSRule): rule is CSSStyleRule {
	return typeof (rule as CSSStyleRule).selectorText === 'string';
}

export function createStyleSheetFromObservable(css: IObservable<string>): IDisposable {
	const store = new DisposableStore();
	const w = store.add(new WrappedStyleElement());
	store.add(autorun(reader => {
		w.setStyle(css.read(reader));
	}));
	return store;
}
