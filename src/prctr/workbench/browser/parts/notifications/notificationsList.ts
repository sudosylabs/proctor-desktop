/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port workbench-notifications
import { addDisposableListener, trackFocus } from '../../../../base/browser/dom.js';
import { List, unthemedListStyles } from '../../../../base/browser/ui/list/listWidget.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import type { INotificationViewItem } from '../../../common/notifications.js';
import { NotificationRenderer } from './notificationsViewer.js';
import type { NotificationLabels } from './notificationPresentation.js';

/** The complete upstream virtual list handles rows, scrollbars, keyboard and type navigation. */
export class NotificationsList extends Disposable {
	readonly #list: List<INotificationViewItem>;
	readonly #height = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this.#height.event;
	#items: INotificationViewItem[] = [];
	#width = 450;
	#maxHeight = 400;
	constructor(
		private readonly host: HTMLElement,
		renderer: NotificationRenderer,
		labels: NotificationLabels
	) {
		super();
		host.classList.add('notifications-list-container');
		this.measureItem = (item) => renderer.measure(item, this.#width);
		this.#list = this._register(
			new List(
				'Notifications',
				host,
				{
					getHeight: (item) => renderer.measure(item, this.#width),
					getTemplateId: () => renderer.templateId
				},
				[renderer],
				{
					setRowLineHeight: false,
					horizontalScrolling: false,
					verticalScrollMode: ScrollbarVisibility.Auto,
					multipleSelectionSupport: false,
					keyboardNavigationLabelProvider: {
						getKeyboardNavigationLabel: (item) => item.message.linkedText.toString()
					},
					accessibilityProvider: {
						getAriaLabel: (item) => labels.accessible(item),
						getWidgetAriaLabel: () => labels.notifications,
						getRole: () => 'dialog'
					}
				}
			)
		);
		this.#list.style({
			...unthemedListStyles,
			tableColumnsBorder: undefined,
			tableOddRowsBackgroundColor: undefined,
			listFocusOutline: 'var(--prctr-color-border-focus)',
			listInactiveFocusOutline: 'var(--prctr-color-border-strong)',
			listHoverOutline: 'var(--prctr-color-border-default)'
		});
		this._register(
			this.#list.onDidChangeSelection((event) => {
				if (event.indexes.length) this.#list.setSelection([]);
			})
		);
		this._register(
			this.#list.onMouseDblClick((event) => {
				if (!(event.browserEvent.target as HTMLElement).closest('button,a'))
					event.element?.toggle();
			})
		);
		this._register(
			this.#list.onDidChangeContentHeight(() => {
				this.#list.layout(Math.min(this.#maxHeight, this.#list.contentHeight), this.#width);
				this.#height.fire();
			})
		);
		const focus = this._register(trackFocus(this.element));
		this._register(
			focus.onDidBlur(() => {
				if (host.ownerDocument.hasFocus()) this.#list.setFocus([]);
			})
		);
		this._register(
			addDisposableListener(this.element, 'keydown', (event) => {
				if ((event.target as HTMLElement).closest('button,a,input')) return;
				const item = this.focused;
				if (event.key === 'ArrowRight') {
					item?.expand();
					event.preventDefault();
				}
				if (event.key === 'ArrowLeft') {
					item?.collapse();
					event.preventDefault();
				}
				if (event.key === 'Enter' || event.key === ' ') {
					item?.toggle();
					event.preventDefault();
				}
				if (event.key === 'Delete' || (event.key === 'Backspace' && event.metaKey)) {
					if (item && !item.hasActiveProgress) item.close();
					event.preventDefault();
				}
			})
		);
	}
	get element(): HTMLElement {
		return this.#list.getHTMLElement();
	}
	get height(): number {
		return Math.min(this.#maxHeight, this.#list.contentHeight);
	}
	get focused(): INotificationViewItem | undefined {
		return this.#items[this.#list.getFocus()[0]];
	}
	get hasFocus(): boolean {
		return this.element.contains(this.element.ownerDocument.activeElement);
	}
	setItems(items: readonly INotificationViewItem[]): void {
		const hadFocus = this.hasFocus;
		const index = this.#list.getFocus()[0];
		const item = this.#items[index];
		const top = typeof index === 'number' ? this.#list.getRelativeTop(index) : null;
		this.#items = [...items];
		this.#list.splice(0, this.#list.length, this.#items);
		if (typeof index === 'number' && items.length) {
			const next = Math.max(
				0,
				items.includes(item) ? items.indexOf(item) : Math.min(index - 1, items.length - 1)
			);
			this.#list.setFocus([next]);
			if (typeof top === 'number') this.#list.reveal(next, top);
		}
		this.#list.layout(Math.min(this.#maxHeight, this.#list.contentHeight), this.#width);
		if (hadFocus) this.#list.domFocus();
	}
	update(item: INotificationViewItem, redraw: boolean): void {
		const index = this.#items.indexOf(item);
		if (index < 0) return;
		if (redraw) {
			const focused = this.hasFocus;
			const focusedIndex = this.#list.getFocus()[0];
			this.#list.splice(index, 1, [item]);
			if (focused) {
				this.#list.setFocus([typeof focusedIndex === 'number' ? focusedIndex : index]);
				this.#list.domFocus();
			}
		}
		this.#list.updateElementHeight(index, this.measureItem(item));
	}
	private measureItem: (item: INotificationViewItem) => number = () => 42;
	layout(width: number, maxHeight: number): void {
		const changed = this.#width !== width;
		this.#width = width;
		this.host.style.width = `${width}px`;
		this.#maxHeight = Math.max(0, maxHeight);
		if (changed) this.setItems(this.#items);
		this.#list.layout(Math.min(this.#maxHeight, this.#list.contentHeight), width);
	}
	remeasure(): void {
		this.setItems(this.#items);
	}
	focus(item?: INotificationViewItem): void {
		const index = item ? this.#items.indexOf(item) : 0;
		if (index >= 0 && this.#items.length) {
			this.#list.setFocus([index]);
			this.#list.reveal(index);
		}
		this.#list.domFocus();
	}
	next(previous = false): void {
		if (previous) this.#list.focusPrevious();
		else this.#list.focusNext();
		const i = this.#list.getFocus()[0];
		if (typeof i === 'number') this.#list.reveal(i);
		this.#list.domFocus();
	}
}
