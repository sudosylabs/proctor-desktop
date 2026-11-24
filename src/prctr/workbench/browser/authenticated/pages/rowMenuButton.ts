/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import type { MenuControl, MenuEntry } from '../../../../base/browser/ui/menu/menuControl.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageRowAction } from './pageSection.js';
import './media/rowMenuButton.css';

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
	const $ = createElementFactory(document);
	const { label } = options;
	const button = $(`button.prctr-row-menu-button.${options.className}`, {
		type: 'button',
		title: label,
		attrs: { 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }
	});
	button.append(store.add(createProctorIcon(document, { id: 'action.more', size: 18 })).element);
	const ordered = [
		...options.actions.filter((action) => action.destructive !== true),
		...options.actions.filter((action) => action.destructive === true)
	];
	const firstDestructive = ordered.findIndex((action) => action.destructive === true);
	const entries: MenuEntry[] = ordered.map((action, index) => ({
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
	const open = (): void => {
		menu.show(button, entries, label);
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
	return button;
}
