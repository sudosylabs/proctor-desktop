/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import type { MenuEntry } from '../../../../base/browser/ui/menu/menuControl.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRowAction } from '../../../browser/authenticated/pages/pageSection.js';
import './media/adminMenuButton.css';

/** A page header's "⋯" button: the page's less common actions, destructive ones last. */
export class AdminMenuButton extends Disposable {
	readonly element: HTMLButtonElement;
	private readonly menuStore = this._register(new DisposableStore());

	constructor(
		host: HTMLElement,
		label: string,
		private readonly actions: () => readonly PageRowAction[],
		private readonly pane: IPagePaneContext
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.element = $('button.prctr-admin-menu-button', {
			type: 'button',
			title: label,
			attrs: { 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }
		});
		this.element.append(
			this._register(createProctorIcon(host.ownerDocument, { id: 'action.more', size: 18 }))
				.element
		);
		host.append(this.element);
		this._register(addDisposableListener(this.element, 'click', () => this.open(label)));
		this._register(
			addDisposableListener(this.element, 'keydown', (event) => {
				if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
				event.preventDefault();
				this.open(label);
			})
		);
	}

	private open(label: string): void {
		const actions = this.actions();
		const ordered = [
			...actions.filter((action) => action.destructive !== true),
			...actions.filter((action) => action.destructive === true)
		];
		const firstDestructive = ordered.findIndex((action) => action.destructive === true);
		const entries: MenuEntry[] = ordered.map((action, index) => ({
			label: action.label,
			icon: proctorIconFactory(action.icon, 16),
			destructive: action.destructive === true,
			separatorBefore: index > 0 && index === firstDestructive,
			enabled: action.enabled !== false,
			run: action.run
		}));
		this.pane.menu.show(this.element, entries, label);
		if (!this.pane.menu.visible) return;
		this.element.setAttribute('aria-expanded', 'true');
		this.menuStore.clear();
		this.menuStore.add(
			this.pane.menu.onDidChangeVisibility((visible) => {
				if (visible) return;
				this.element.setAttribute('aria-expanded', 'false');
				this.menuStore.clear();
			})
		);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
