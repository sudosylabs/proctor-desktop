import { Emitter } from '../../../src/prctr/base/common/event.ts';
import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import { NotificationMenu } from '../../../src/prctr/workbench/browser/parts/notifications/notificationMenu.ts';
import type { WorkbenchNotifications } from '../../../src/prctr/workbench/browser/parts/notifications/notifications.ts';

export async function verifyNotificationPopups(
	frame: HTMLElement,
	notifications: WorkbenchNotifications
): Promise<number> {
	const store = new DisposableStore();
	const changed = store.add(new Emitter<void>());
	const effects = {
		canInteract: () => true,
		onDidChangeInteraction: changed.event,
		restoreFocus: () => {},
		onActionError: () => {}
	};
	const menu = store.add(new NotificationMenu(notifications.element, effects));
	const document = frame.ownerDocument;
	const window = document.defaultView!;
	let checks = 0;
	const assert = (condition: unknown, message: string): void => {
		if (!condition) throw new Error(`Notification popups: ${message}`);
		checks++;
	};
	const delay = (ms: number): Promise<void> =>
		new Promise((resolve) => window.setTimeout(resolve, ms));
	const inside = (rect: DOMRect, bounds: DOMRect): boolean =>
		rect.left >= bounds.left &&
		rect.right <= bounds.right + 1 &&
		rect.top >= bounds.top &&
		rect.bottom <= bounds.bottom + 1;
	try {
		frame.scrollIntoView();
		const anchor = [
			...notifications.center.element.querySelectorAll<HTMLButtonElement>(
				'.notifications-center-header button'
			)
		].at(-1)!;
		// Force the menu to overlap the notification body: hit testing must see the menu.
		notifications.preferences.setPosition('top-right');
		for (const zoom of ['1', '1.25']) {
			frame.style.zoom = zoom;
			frame.scrollIntoView();
			menu.show(
				anchor,
				[
					{
						label: 'A longer localized notification preference that must stay on one line'
					},
					{ label: 'Short preference', separatorBefore: true }
				],
				'Notification preferences'
			);
			const popup = frame.querySelector<HTMLElement>('.prctr-menu')!;
			const row = popup.querySelector('button')!;
			const bounds = popup.getBoundingClientRect();
			assert(
				inside(bounds, notifications.element.getBoundingClientRect()),
				`menu stays inside owner at zoom ${zoom}`
			);
			const hit = document.elementFromPoint(bounds.left + 10, bounds.top + bounds.height / 2);
			assert(
				hit !== null && popup.contains(hit),
				`menu paints above notifications at zoom ${zoom}`
			);
			assert(
				getComputedStyle(row).whiteSpace === 'nowrap' &&
					row.getBoundingClientRect().height ===
						popup.querySelectorAll('button')[1]!.getBoundingClientRect().height,
				`long and short menu labels both occupy one line at zoom ${zoom}`
			);
			assert(
				popup.querySelector('[role=separator]'),
				'menu keeps a noninteractive group separator'
			);
			row.focus();
			row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
			assert(
				document.activeElement === popup.querySelectorAll('button')[1],
				'keyboard navigation skips the separator'
			);
			row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			assert(!menu.visible, 'Escape dismisses the menu');
			menu.hide(false);
		}
		frame.style.zoom = '';
		frame.scrollIntoView();
		await delay(50);
		for (const position of ['bottom-right', 'top-right', 'bottom-left'] as const) {
			anchor.blur();
			if (!document.hasFocus())
				anchor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
			notifications.preferences.setPosition(position);
			anchor.focus({ preventScroll: true });
			// Electron's hidden harness does not deliver native focus events to its iframe.
			if (!document.hasFocus())
				anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
			await delay(350);
			const tip = frame.querySelector<HTMLElement>('.prctr-notification-hover')!;
			assert(
				tip,
				`keyboard focus opens tooltip at ${position}: focused=${document.activeElement === anchor}, connected=${anchor.isConnected}, hidden=${notifications.center.element.hidden}`
			);
			const bounds = tip.getBoundingClientRect();
			const card = notifications.center.element.getBoundingClientRect();
			assert(
				inside(bounds, notifications.element.getBoundingClientRect()) &&
					(bounds.bottom <= card.top ||
						bounds.top >= card.bottom ||
						bounds.right <= card.left ||
						bounds.left >= card.right),
				`tooltip avoids notification and remains within window at ${position}`
			);
		}
		anchor.blur();
		if (!document.hasFocus())
			anchor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
	} finally {
		frame.style.zoom = '';
		store.dispose();
	}
	return checks;
}
