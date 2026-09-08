import { DisposableStore } from '../../src/prctr/base/common/lifecycle.js';
import { Event } from '../../src/prctr/base/common/event.js';
import { ButtonControl } from '../../src/prctr/base/browser/ui/button/button.js';
import { BrowserThemeService } from '../../src/prctr/platform/theme/browser/themeService.js';
import { Severity } from '../../src/prctr/platform/notification/common/notification.js';
import { WorkbenchNotifications } from '../../src/prctr/workbench/browser/parts/notifications/notifications.js';
import '../../src/prctr/workbench/browser/documentLayout.css';
import './notificationsPreview.css';

const store = new DisposableStore();
const theme = store.add(
	new BrowserThemeService(document, 'dark', {
		density: 'default',
		motion: 'reduced',
		transparency: 'reduced'
	})
);
const root = document.createElement('main');
root.className = 'prctr-notification-preview';
const titlebar = document.createElement('header');
titlebar.textContent = 'Proctor';
const content = document.createElement('section');
const heading = document.createElement('h1');
heading.textContent = 'Notifications';
const subtitle = document.createElement('p');
subtitle.textContent = 'Production notification controls · development preview';
const controls = document.createElement('div');
content.append(heading, subtitle, controls);
const status = document.createElement('footer');
const layer = document.createElement('div');
layer.className = 'prctr-notification-layer';
root.append(titlebar, content, status, layer);
document.body.append(root);
const notifications = store.add(
	new WorkbenchNotifications({
		host: layer,
		indicatorHost: status,
		effects: {
			canInteract: () => true,
			onDidChangeInteraction: Event.None,
			restoreFocus: () => controls.querySelector('button')?.focus()
		},
		geometry: () => ({
			width: root.clientWidth,
			height: root.clientHeight,
			top: 38,
			bottom: 30
		})
	})
);
notifications.start();
const button = (label: string, run: () => void): void => {
	const control = store.add(new ButtonControl(controls, { label, variant: 'secondary' }));
	store.add(control.onDidRequest(run));
};
button('Toast', () => notifications.service.info('Your workspace is up to date.'));
button('Sticky', () =>
	notifications.service.prompt(
		Severity.Warning,
		'The connection was interrupted.',
		[
			{
				label: 'Reconnect',
				run: () => {
					notifications.service.info('Connection restored.');
				}
			}
		],
		{ sticky: true }
	)
);
button('Progress', () => {
	let finish!: () => void;
	void notifications.progress.withProgress(
		{ title: 'Uploading your work', cancellable: true },
		() => new Promise<void>((resolve) => (finish = resolve)),
		() => finish()
	);
});
button('Notification center', () => notifications.showCenter());
button('Theme', () => theme.setTheme(theme.theme.id === 'dark' ? 'light' : 'dark'));
notifications.showCenter();
globalThis.addEventListener('pagehide', () => store.dispose(), { once: true });
