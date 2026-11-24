/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import type { MenuControl, MenuEntry } from '../../../../base/browser/ui/menu/menuControl.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { IPagePaneContext } from './pagePaneContext.js';
import type { PageRowAction } from './pageSection.js';
import './media/rowMenuButton.css';
import './media/pageMenuButton.css';

/**
 * The "⋯" button at the end of a row that opens the row's actions. It is always visible in a
 * muted grey, so it can be found without hovering. Destructive actions come last, after a
 * separator; Arrow Up and Arrow Down open the menu as a click does. Everything it registers is
 * added to `store`, which the row owns. `className` names the button for its owner's layout.
 */
export function createRowMenuButton(
	store: DisposableStore,
	menu: MenuControl,
	document: Document,
	options: {
		readonly label: string;
		readonly actions: readonly PageRowAction[];
		readonly className: string;
	}
): HTMLButtonElement {
	const button = createMenuButton(
		store,
		document,
		`prctr-row-menu-button.${options.className}`,
		options.label
	);
	bindActionMenu(store, menu, button, options.label, () => options.actions);
	return button;
}

/**
 * A page header's "⋯" button: the page's less common actions, read when it opens, destructive
 * ones last. It is boxed like the header's other buttons.
 */
export class PageMenuButton extends Disposable {
	readonly element: HTMLButtonElement;

	constructor(
		host: HTMLElement,
		label: string,
		actions: () => readonly PageRowAction[],
		pane: IPagePaneContext
	) {
		super();
		const store = this._register(new DisposableStore());
		this.element = createMenuButton(store, host.ownerDocument, 'prctr-page-menu-button', label);
		host.append(this.element);
		bindActionMenu(store, pane.menu, this.element, label, actions);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}

function createMenuButton(
	store: DisposableStore,
	document: Document,
	classes: string,
	label: string
): HTMLButtonElement {
	const $ = createElementFactory(document);
	const button = $(`button.${classes}`, {
		type: 'button',
		title: label,
		attrs: { 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }
	});
	button.append(store.add(createProctorIcon(document, { id: 'action.more', size: 18 })).element);
	return button;
}

/** Opens the actions on click or Arrow Up/Down, and mirrors the menu in `aria-expanded`. */
function bindActionMenu(
	store: DisposableStore,
	menu: MenuControl,
	button: HTMLButtonElement,
	label: string,
	actions: () => readonly PageRowAction[]
): void {
	const open = (): void => {
		menu.show(button, menuEntries(actions()), label);
		if (!menu.visible) return;
		button.setAttribute('aria-expanded', 'true');
		const visibility = store.add(new DisposableStore());
		visibility.add(
			menu.onDidChangeVisibility((visible) => {
				if (visible) return;
				button.setAttribute('aria-expanded', 'false');
				store.delete(visibility);
			})
		);
	};
	store.add(addDisposableListener(button, 'click', open));
	store.add(
		addDisposableListener(button, 'keydown', (event) => {
			if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
			event.preventDefault();
			open();
		})
	);
}

/** The menu entries for actions: destructive ones last, after a separator. */
function menuEntries(actions: readonly PageRowAction[]): MenuEntry[] {
	const ordered = [
		...actions.filter((action) => action.destructive !== true),
		...actions.filter((action) => action.destructive === true)
	];
	const firstDestructive = ordered.findIndex((action) => action.destructive === true);
	return ordered.map((action, index) => ({
		label: action.label,
		icon: proctorIconFactory(action.icon, 16),
		destructive: action.destructive === true,
		separatorBefore: index > 0 && index === firstDestructive,
		enabled: action.enabled !== false,
		...(action.locked === undefined
			? {}
			: {
					trailingIcon: proctorIconFactory('status.locked', 14),
					accessibleLabel: action.locked
				}),
		run: action.run
	}));
}
