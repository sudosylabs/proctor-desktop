import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import type { NotificationEffects } from './notificationPresentation.js';
import { layoutNotificationPopup } from './notificationPopupLayout.js';
import './notificationMenu.css';

export interface NotificationMenuEntry {
	readonly label: string;
	readonly enabled?: boolean;
	readonly checked?: boolean;
	readonly children?: readonly NotificationMenuEntry[];
	readonly run?: () => void | Promise<void>;
}
/** Window-owned nonmodal menu, including submenu, typeahead and focus restoration. */
export class NotificationMenu extends Disposable {
	readonly #active = this._register(new DisposableStore());
	#root: HTMLElement | undefined;
	constructor(
		private readonly host: HTMLElement,
		private readonly effects: NotificationEffects
	) {
		super();
		this._register(
			effects.onDidChangeInteraction(() => {
				if (!effects.canInteract()) this.hide(false);
			})
		);
	}
	get visible(): boolean {
		return this.#root !== undefined;
	}
	show(anchor: HTMLElement, entries: readonly NotificationMenuEntry[], label: string): void {
		this.hide(false);
		if (!this.effects.canInteract()) return;
		const root = this.host.ownerDocument.createElement('div');
		root.className = 'prctr-notification-menu';
		root.role = 'menu';
		root.setAttribute('aria-label', label);
		root.tabIndex = -1;
		this.#root = root;
		this.host.append(root);
		const position = (): void => layoutNotificationPopup(this.host, root, anchor, false);
		const render = (
			items: readonly NotificationMenuEntry[],
			back?: () => void,
			focusedIndex = 0
		): void => {
			const rowStore = new DisposableStore();
			this.#active.add(rowStore);
			root.replaceChildren();
			const buttons: HTMLButtonElement[] = [];
			for (const item of items) {
				const button = root.ownerDocument.createElement('button');
				button.type = 'button';
				button.role = item.checked === undefined ? 'menuitem' : 'menuitemcheckbox';
				button.textContent = item.label;
				button.tabIndex = -1;
				button.setAttribute('aria-disabled', String(item.enabled === false));
				if (item.checked !== undefined)
					button.setAttribute('aria-checked', String(item.checked));
				if (item.children) button.setAttribute('aria-haspopup', 'menu');
				root.append(button);
				buttons.push(button);
				rowStore.add(
					addDisposableListener(button, 'click', () => {
						if (item.enabled === false || !this.effects.canInteract()) return;
						if (item.children) {
							rowStore.dispose();
							render(item.children, () => {
								render(items, back, items.indexOf(item));
							});
							return;
						}
						this.hide();
						Promise.resolve()
							.then(() => {
								if (this.effects.canInteract()) return item.run?.();
							})
							.catch(() => this.effects.onActionError());
					})
				);
			}
			let search = '';
			let last = 0;
			rowStore.add(
				addDisposableListener(root, 'keydown', (event) => {
					let index = buttons.indexOf(
						root.ownerDocument.activeElement as HTMLButtonElement
					);
					if (event.key === 'Escape' || event.key === 'Tab') {
						if (event.key === 'Escape') event.preventDefault();
						event.stopPropagation();
						this.hide();
						return;
					}
					const rtl = root.ownerDocument.documentElement.dir === 'rtl';
					if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') && back) {
						event.preventDefault();
						event.stopPropagation();
						rowStore.dispose();
						back();
						return;
					}
					if (
						event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') &&
						items[index]?.children
					) {
						event.preventDefault();
						event.stopPropagation();
						buttons[index]?.click();
						return;
					}
					if (event.key === 'ArrowDown') index = (index + 1) % buttons.length;
					else if (event.key === 'ArrowUp')
						index = (index - 1 + buttons.length) % buttons.length;
					else if (event.key === 'Home') index = 0;
					else if (event.key === 'End') index = buttons.length - 1;
					else if (
						event.key.length === 1 &&
						!event.ctrlKey &&
						!event.metaKey &&
						event.key !== ' '
					) {
						const now = Date.now();
						search = (now - last > 800 ? '' : search) + event.key.toLocaleLowerCase();
						last = now;
						const match = buttons.findIndex((button) =>
							button.textContent?.toLocaleLowerCase().startsWith(search)
						);
						if (match >= 0) index = match;
					} else return;
					event.preventDefault();
					event.stopPropagation();
					buttons[index]?.focus();
				})
			);
			position();
			(buttons[focusedIndex] ?? root).focus();
		};
		render(entries);

		position();
		this.#active.add(
			addDisposableListener(
				root.ownerDocument,
				'pointerdown',
				(event) => {
					if (
						!root.contains(event.target as Node) &&
						!anchor.contains(event.target as Node)
					)
						this.hide(false);
				},
				true
			)
		);
		const observer = new ResizeObserver(position);
		observer.observe(this.host);
		observer.observe(anchor);
		observer.observe(root);
		this.#active.add({ dispose: () => observer.disconnect() });
		this.#active.add({
			dispose: () => {
				root.remove();
				if (this.#root === root) this.#root = undefined;
			}
		});
		this.#restore = () => {
			if (anchor.isConnected && !anchor.closest('[inert],[hidden]')) anchor.focus();
			else this.effects.restoreFocus();
		};
	}
	#restore: (() => void) | undefined;
	hide(restore = true): void {
		const focus = this.#restore;
		this.#restore = undefined;
		this.#active.clear();
		if (restore) focus?.();
	}
	override dispose(): void {
		this.hide(false);
		super.dispose();
	}
}
