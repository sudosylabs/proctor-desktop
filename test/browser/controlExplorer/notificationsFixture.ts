import { Emitter } from '../../../src/prctr/base/common/event.ts';
import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import {
	Severity,
	NotificationPriority
} from '../../../src/prctr/platform/notification/common/notification.ts';
import { WorkbenchNotifications } from '../../../src/prctr/workbench/browser/parts/notifications/notifications.ts';
import { verifyNotificationPopups } from './notificationPopupTests.ts';
import type { ControlFixtureResult } from './manifest.ts';

export function notificationsFixture(host: HTMLElement): ControlFixtureResult {
	const store = new DisposableStore();
	const frame = host.ownerDocument.createElement('div');
	frame.style.cssText = 'position:relative;width:100%;height:500px';
	host.append(frame);
	store.add({ dispose: () => frame.remove() });
	const status = host.ownerDocument.createElement('div');
	frame.append(status);
	const changed = store.add(new Emitter<void>());
	let allowed = true;
	let restored = 0;
	let opened = 0;
	let copied = '';
	const notifications = store.add(
		new WorkbenchNotifications({
			host: frame,
			indicatorHost: status,
			effects: {
				openLink: async () => {
					opened++;
				},
				copyText: async (text) => {
					copied = text;
				},
				canInteract: () => allowed,
				onDidChangeInteraction: changed.event,
				restoreFocus: () => restored++
			},
			geometry: () => ({
				width: Math.max(frame.clientWidth, 300),
				height: 500,
				top: 32,
				bottom: 28
			})
		})
	);
	const assert = (condition: unknown, message: string): void => {
		if (!condition) throw new Error('Notifications: ' + message);
	};
	const tick = (): Promise<void> =>
		new Promise((resolve) =>
			host.ownerDocument.defaultView!.requestAnimationFrame(() => resolve())
		);
	return {
		states: 12,
		disposable: store,
		verify: async () => {
			let checks = 0;
			notifications.start();
			for (let i = 0; i < 15; i++) notifications.service.error('Duplicate');
			await tick();
			assert(
				notifications.service.model.notifications.length === 1,
				'duplicates consolidated in model'
			);
			assert(
				frame.querySelectorAll('.notification-toast-container').length === 1,
				'pending duplicate produces one toast'
			);
			checks += 2;
			const toast = frame.querySelector<HTMLElement>('.notification-toast')!;
			const toastBounds = toast.getBoundingClientRect();
			assert(
				toastBounds.width > 0 &&
					toastBounds.height >= 34 &&
					toastBounds.bottom <= frame.getBoundingClientRect().bottom,
				'toast must paint inside its owner, not merely exist in the DOM: ' +
					JSON.stringify({
						toast: toastBounds.toJSON(),
						owner: frame.getBoundingClientRect().toJSON(),
						display: getComputedStyle(toast).display,
						position: getComputedStyle(toast.parentElement!.parentElement!).cssText
					})
			);
			checks++;
			notifications.showCenter();
			assert(!notifications.toasts.visible, 'center hides toasts');
			assert(
				notifications.service.model.notifications.length === 1,
				'hiding toast retains notification'
			);
			checks += 2;
			notifications.clearAll();
			notifications.showCenter();
			const header = notifications.center.element.querySelector<HTMLElement>(
				'.notifications-center-header'
			)!;
			assert(
				header.getBoundingClientRect().height === 35,
				'center retains the upstream 35px header'
			);
			assert(
				header.querySelector('.notifications-center-header-title')?.textContent ===
					'No new notifications',
				'empty center uses the upstream title'
			);
			assert(
				header.querySelectorAll('.actions-container > .action-item').length === 4,
				'center retains separate clear, mute, position and hide actions'
			);
			checks += 3;
			notifications.hide();
			const handle = notifications.service.notify({
				severity: Severity.Info,
				message: 'Uploading work',
				progress: { infinite: true }
			});
			notifications.showCenter();
			assert(
				!frame.querySelector('button[aria-label="Clear notification"]'),
				'active progress has no close button'
			);
			notifications.clearAll();
			assert(
				notifications.service.model.notifications.length === 1,
				'clear all preserves progress'
			);
			checks += 2;
			notifications.showCenter();
			const bit = frame.querySelector<HTMLElement>('.progress-bit')!;
			await tick();
			const transform = getComputedStyle(bit).transform;
			await new Promise((resolve) =>
				host.ownerDocument.defaultView!.setTimeout(resolve, 100)
			);
			assert(
				getComputedStyle(bit).animationPlayState === 'running',
				'essential progress runs with reduced motion'
			);
			assert(
				getComputedStyle(bit).transform !== transform,
				'indefinite progress visibly advances between frames'
			);
			checks += 2;
			notifications.showCenter();
			handle.progress.done();
			assert(
				frame.querySelector('button[aria-label="Clear notification"]'),
				'completion restores close'
			);
			handle.progress.infinite();
			assert(
				!frame.querySelector('button[aria-label="Clear notification"]'),
				'restart removes close'
			);
			checks += 2;
			notifications.hide();
			assert(
				notifications.service.model.notifications.length === 1,
				'hide keeps indefinite notification'
			);
			handle.close();
			checks++;
			let clicked = 0;
			notifications.service.prompt(Severity.Error, 'Reconnect', [
				{ label: 'Retry', keepOpen: true, run: () => clicked++ }
			]);
			notifications.showCenter();
			const retry = [...frame.querySelectorAll<HTMLElement>('button, a[role=button]')].find(
				(button) => button.textContent === 'Retry'
			);
			assert(retry, 'primary action is available');
			retry!.click();
			await Promise.resolve();
			assert(
				clicked === 1 && notifications.service.model.notifications.length === 1,
				'keepOpen action preserves notification'
			);
			checks += 2;
			notifications.read();
			assert(!notifications.reader.element.hidden, 'accessible reader opens');
			assert(
				frame.querySelector('textarea')?.value.includes('Reconnect'),
				'reader includes message'
			);
			notifications.reader.hide();
			checks += 2;
			allowed = false;
			changed.fire();
			assert(
				!notifications.center.visible && !notifications.toasts.visible,
				'gate hides ordinary presentation'
			);
			assert(notifications.element.inert, 'gate isolates notification interaction');
			checks += 2;
			allowed = true;
			changed.fire();
			notifications.clearAll();
			for (let i = 0; i < 60; i++)
				notifications.service.notify({
					severity: Severity.Info,
					message: `Message ${i}`,
					priority: NotificationPriority.SILENT
				});
			notifications.showCenter();
			assert(
				frame.querySelectorAll('.prctr-list-row').length < 60,
				'center virtualizes retained notifications'
			);
			checks++;
			notifications.preferences.setPosition('top-right');
			assert(
				notifications.element.dataset.position === 'top-right',
				'position updates presentation'
			);
			checks++;

			const focused = notifications.service.model.notifications[25]!;
			notifications.center.list.focus(focused);
			const list = notifications.center.list.element;
			assert(list.ownerDocument.activeElement === list, 'center keeps one list tab stop');
			assert(
				getComputedStyle(list.querySelector('.prctr-list-row.focused')!).outlineStyle !==
					'none',
				'list focus styling works under strict CSP'
			);
			checks += 2;
			notifications.clearAll();
			notifications.service.notify({
				severity: Severity.Warning,
				message: '[Open documentation](https://example.test/help)',
				sticky: true
			});
			notifications.showCenter();
			const link = frame.querySelector<HTMLAnchorElement>('.notification-list-item a')!;
			link.click();
			await Promise.resolve();
			assert(opened === 1, 'link activation uses the supplied authorized adapter');
			checks++;
			const article = frame.querySelector<HTMLElement>(
				'.notifications-center .notification-list-item'
			)!;
			article.dispatchEvent(
				new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
			);
			const copy = [...frame.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
				(button) => button.textContent === 'Copy text'
			);
			assert(copy, 'copy action is available only with an adapter');
			copy!.click();
			await Promise.resolve();
			assert(
				copied.includes('Open documentation'),
				'copy receives notification text through the adapter'
			);
			checks += 2;
			allowed = false;
			changed.fire();
			link.click();
			await Promise.resolve();
			assert(opened === 1, 'gating prevents late link activation');
			checks++;
			allowed = true;
			changed.fire();
			notifications.clearAll();
			notifications.service.prompt(Severity.Info, 'A long notification message '.repeat(25), [
				{
					label: 'An action label that remains usable in a narrow window',
					keepOpen: true,
					run: () => {}
				}
			]);
			notifications.showCenter();
			const longRow = frame.querySelector<HTMLElement>(
				'.notifications-center .prctr-list-row'
			)!;
			const longBody = longRow.querySelector<HTMLElement>('.notification-list-item')!;
			assert(
				longBody.scrollHeight <= longRow.clientHeight + 1,
				'long content and wrapped actions fit the measured virtual row'
			);
			checks++;
			notifications.hide();
			notifications.service.model.notifications.forEach((item) => {
				if (item.hasActiveProgress) item.progress.done();
			});
			notifications.clearAll();
			notifications.service.notify({
				severity: Severity.Info,
				message: 'Ready for the examination',
				sticky: true
			});
			notifications.showCenter();
			assert(restored > 0, 'hiding focused presentation restores focus');
			checks++;
			checks += await verifyNotificationPopups(frame, notifications);
			const scheduledHost = host.ownerDocument.createElement('div');
			scheduledHost.style.cssText = 'position:relative;height:500px;width:500px';
			host.append(scheduledHost);
			const scheduler = new WorkbenchNotifications({
				host: scheduledHost,
				indicatorHost: status,
				effects: {
					canInteract: () => true,
					onDidChangeInteraction: changed.event,
					restoreFocus: () => {}
				},
				geometry: () => ({ width: 500, height: 500, top: 0, bottom: 0 })
			});
			try {
				scheduler.start();
				scheduler.service.info('Removed before rendering');
				scheduler.service.model.notifications[0].close();
				await tick();
				assert(!scheduler.toasts.visible, 'removed pending notifications never render');
				checks++;
				for (let i = 0; i < 15; i++) scheduler.service.error(`Flood ${i}`);
				await tick();
				assert(
					scheduler.service.model.notifications.length === 15,
					'spam protection retains every distinct notification'
				);
				assert(
					scheduledHost.querySelectorAll('.notification-toast-container').length <= 3,
					'spam protection bounds scheduled toasts'
				);
				checks += 2;
				const newest = scheduler.service.model.notifications[0];
				// Use a rendered item: burst limiting deliberately leaves newer center-only records.
				const rendered = scheduler.service.model.notifications.find((item) => item.visible);
				assert(
					newest && rendered,
					'burst leaves an accessible retained model and a visible toast'
				);
				rendered!.updateMessage('Long notification '.repeat(100));
				rendered!.expand();
				assert(
					scheduler.toasts.visible,
					'the first large toast can use the full available height'
				);
				checks++;
			} finally {
				scheduler.dispose();
				scheduledHost.remove();
			}
			return checks;
		}
	};
}
