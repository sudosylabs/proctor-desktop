import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { createLocalization, defineMessage } from '../../../base/common/localization.js';
import type { AuthenticatedWindowDescriptor } from '../../windows/common/windowProtocol.js';
import { accountMenuActions } from '../common/accountMenu.js';
import type { AccountMenuHost } from './accountMenuIpc.js';

const messages = {
	profile: defineMessage({
		id: 'account.menu.profile',
		defaultMessage: 'Profile',
		description: 'Native account menu profile action.'
	}),
	sessions: defineMessage({
		id: 'account.menu.sessions',
		defaultMessage: 'Sessions',
		description: 'Native account menu sessions action.'
	}),
	settings: defineMessage({
		id: 'account.menu.settings',
		defaultMessage: 'Settings',
		description: 'Native account menu settings action.'
	}),
	logout: defineMessage({
		id: 'account.menu.logout',
		defaultMessage: 'Log out',
		description: 'Native account menu logout action.'
	})
};

/** Electron owns the native material, selection, keyboard navigation and screen-edge placement. */
export function createElectronAccountMenu(
	window: BrowserWindow,
	binding: AuthenticatedWindowDescriptor,
	locale: string
): AccountMenuHost {
	const localization = createLocalization({
		requestedLocale: locale,
		messages: Object.values(messages),
		catalogs: []
	});
	return {
		popup(anchor, selected, closed) {
			const template: MenuItemConstructorOptions[] = [];
			if (binding.identity)
				template.push(
					{
						label: binding.identity.displayName,
						sublabel: binding.identity.institutionName,
						enabled: false
					},
					{ type: 'separator' }
				);
			let disposed = false;
			for (const action of accountMenuActions) {
				if (action === 'logout') template.push({ type: 'separator' });
				template.push({
					label: localization.format(messages[action]),
					click: () => {
						if (!disposed) selected(action);
					}
				});
			}
			const menu = Menu.buildFromTemplate(template);
			const zoom = window.webContents.getZoomFactor();
			const [width, height] = window.getContentSize();
			menu.popup({
				window,
				x: Math.floor(Math.min(Math.max(anchor.x * zoom, 0), width)),
				y: Math.floor(Math.min(Math.max(anchor.y * zoom, 0), height)),
				callback: () => {
					// Retain the menu until native dismissal; let a click settle before cancellation.
					if (menu)
						setTimeout(() => {
							if (!disposed) closed();
						}, 0);
				}
			});
			return {
				dispose() {
					if (disposed) return;
					disposed = true;
					if (!window.isDestroyed()) menu.closePopup(window);
				}
			};
		}
	};
}
