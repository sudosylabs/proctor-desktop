import assert from '../upstream/assert.ts';
import { suite, test } from '../upstream/testAdapter.ts';
import { createCSSRule, createStyleSheet, removeCSSRulesContainingSelector, cloneGlobalStylesheets } from '../../../src/prctr/base/browser/domStylesheets.ts';
import { DefaultStyleController, unthemedListStyles } from '../../../src/prctr/base/browser/ui/list/listWidget.ts';
import { acquireEditorStyleScope } from '../../../src/prctr/workbench/services/editor/browser/editorStyleScope.ts';

suite('Editor stylesheet ownership under production CSP', () => {
	test('text changes and CSSOM edits render without inline style content and dispose completely', () => {
		const host = document.createElement('div');
		const child = host.appendChild(document.createElement('div'));
		child.className = 'prctr-style-test';
		document.body.appendChild(host);
		const initialSheets = document.adoptedStyleSheets.length;
		const style = createStyleSheet(host);
		try {
			style.textContent = '.prctr-style-test { color: rgb(1, 2, 3); }';
			assert.strictEqual(getComputedStyle(child).color, 'rgb(1, 2, 3)');
			assert.strictEqual(style.anchor.textContent, '');
			style.textContent = '.prctr-style-test { color: rgb(4, 5, 6); }';
			assert.strictEqual(getComputedStyle(child).color, 'rgb(4, 5, 6)');
			createCSSRule('.prctr-style-test', 'background-color: rgb(7, 8, 9)', style);
			assert.strictEqual(getComputedStyle(child).backgroundColor, 'rgb(7, 8, 9)');
			removeCSSRulesContainingSelector('prctr-style-test', style);
			assert.strictEqual(style.sheet.cssRules.length, 0);
		} finally { style.dispose(); host.remove(); }
		assert.strictEqual(document.adoptedStyleSheets.length, initialSheets);
	});

	test('a shadow-root sheet stays scoped and supports removing before its parent', () => {
		const host = document.createElement('div');
		document.body.appendChild(host);
		const shadow = host.attachShadow({ mode: 'open' });
		const content = shadow.appendChild(document.createElement('div'));
		const sheet = createStyleSheet(content);
		try {
			sheet.textContent = 'div { color: rgb(11, 22, 33); }';
			assert.strictEqual(getComputedStyle(content).color, 'rgb(11, 22, 33)');
			assert.strictEqual(shadow.adoptedStyleSheets.length, 1);
			sheet.remove();
			sheet.remove();
			assert.strictEqual(shadow.adoptedStyleSheets.length, 0);
		} finally { sheet.dispose(); host.remove(); }
	});

	test('global clones follow text and CSSOM changes and release with their source', () => {
		const frame = document.createElement('iframe');
		document.body.appendChild(frame);
		const target = frame.contentWindow!;
		const initial = target.document.adoptedStyleSheets.length;
		const source = createStyleSheet();
		source.textContent = '.prctr-clone-test { color: rgb(3, 4, 5); }';
		const clones = cloneGlobalStylesheets(target);
		const node = target.document.body.appendChild(target.document.createElement('div'));
		node.className = 'prctr-clone-test';
		try {
			assert.strictEqual(target.getComputedStyle(node).color, 'rgb(3, 4, 5)');
			source.textContent = '.prctr-clone-test { color: rgb(6, 7, 8); }';
			assert.strictEqual(target.getComputedStyle(node).color, 'rgb(6, 7, 8)');
			createCSSRule('.prctr-clone-test', 'background: rgb(9, 10, 11)', source);
			assert.strictEqual(target.getComputedStyle(node).backgroundColor, 'rgb(9, 10, 11)');
			removeCSSRulesContainingSelector('prctr-clone-test', source);
			assert.strictEqual(target.getComputedStyle(node).backgroundColor, 'rgba(0, 0, 0, 0)');
			source.dispose();
			clones.dispose();
			assert.strictEqual(target.document.adoptedStyleSheets.length, initial);
		} finally { source.dispose(); clones.dispose(); frame.remove(); }
	});

	test('Settings custom list styling owns and disposes the same constructed sheet', () => {
		const host = document.createElement('div');
		host.className = 'prctr-list style-test';
		const row = host.appendChild(document.createElement('div'));
		row.className = 'prctr-list-row focused';
		host.tabIndex = 0;
		document.body.appendChild(host);
		const initial = document.adoptedStyleSheets.length;
		const controller = new DefaultStyleController(createStyleSheet(host), 'style-test');
		try {
			controller.style({ ...unthemedListStyles, listInactiveFocusBackground: '#010203' });
			host.focus();
			assert.strictEqual(getComputedStyle(row).backgroundColor, 'rgb(1, 2, 3)');
			controller.style({ ...unthemedListStyles, listInactiveFocusBackground: '#040506' });
			assert.strictEqual(getComputedStyle(row).backgroundColor, 'rgb(4, 5, 6)');
		} finally { controller.dispose(); host.remove(); }
		assert.strictEqual(document.adoptedStyleSheets.length, initial);
	});

	test('overlapping layout leases preserve their shared scope and preexisting root class', () => {
		const isolated = document.implementation.createHTMLDocument();
		const first = acquireEditorStyleScope(isolated);
		const second = acquireEditorStyleScope(isolated);
		first.dispose();
		assert.strictEqual(isolated.documentElement.classList.contains('prctr-editor-scope'), true);
		second.dispose();
		assert.strictEqual(isolated.documentElement.classList.contains('prctr-editor-scope'), false);
		isolated.documentElement.classList.add('prctr-editor-scope');
		acquireEditorStyleScope(isolated).dispose();
		assert.strictEqual(isolated.documentElement.classList.contains('prctr-editor-scope'), true);
	});
});
