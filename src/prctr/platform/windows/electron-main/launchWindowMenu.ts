import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { createLocalization, defineMessage } from '../../../base/common/localization.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import type { LaunchIdentityProjection } from '../../identity/common/launchIdentity.js';

const messages = Object.freeze({
	application: defineMessage({
		id: 'launch.menu.application',
		defaultMessage: 'Proctor',
		description: 'Native Launch application menu.'
	}),
	file: defineMessage({
		id: 'launch.menu.file',
		defaultMessage: 'File',
		description: 'Native Launch file menu.'
	}),
	edit: defineMessage({
		id: 'launch.menu.edit',
		defaultMessage: 'Edit',
		description: 'Native Launch editing menu.'
	}),
	view: defineMessage({
		id: 'launch.menu.view',
		defaultMessage: 'View',
		description: 'Native Launch presentation menu.'
	}),
	window: defineMessage({
		id: 'launch.menu.window',
		defaultMessage: 'Window',
		description: 'Native Launch window menu.'
	}),
	help: defineMessage({
		id: 'launch.menu.help',
		defaultMessage: 'Help',
		description: 'Native Launch help menu.'
	}),
	quit: defineMessage({
		id: 'launch.menu.quit',
		defaultMessage: 'Quit Proctor',
		description: 'Exit through the owning Launch composition.'
	}),
	diagnostics: defineMessage({
		id: 'launch.menu.diagnostics',
		defaultMessage: 'Connection Diagnostics…',
		description: 'Open bounded connection information in a native dialog.'
	}),
	diagnosticsTitle: defineMessage({
		id: 'launch.menu.diagnostics.title',
		defaultMessage: 'Connection diagnostics',
		description: 'Native diagnostics dialog title.'
	}),
	diagnosticsDetail: defineMessage({
		id: 'launch.menu.diagnostics.detail',
		defaultMessage:
			'Proctor {version}\nPlatform: {platform}\nInstitution: {institution}\nServer: {origin}',
		description: 'Bounded support details; no credentials or private server payloads.'
	}),
	none: defineMessage({
		id: 'launch.menu.none',
		defaultMessage: 'Not selected',
		description: 'Diagnostics value before selecting a server.'
	}),
	unknown: defineMessage({
		id: 'launch.menu.unknown',
		defaultMessage: 'Not verified',
		description: 'Diagnostics value when the Institution has not been verified.'
	}),
	close: defineMessage({
		id: 'launch.menu.close',
		defaultMessage: 'Close',
		description: 'Dismiss native diagnostics.'
	})
});

/** Native menus belong only to the signed-out window and never expose renderer diagnostics. */
export function installLaunchWindowMenu(
	window: BrowserWindow,
	locale: string,
	projection: () => LaunchIdentityProjection | undefined,
	onExit: () => void
): IDisposable {
	const localization = createLocalization({
		requestedLocale: locale,
		messages: Object.values(messages),
		catalogs: []
	});
	const label = (key: keyof typeof messages): string => localization.format(messages[key]);
	let disposed = false;
	let showingDiagnostics = false;
	const quit: MenuItemConstructorOptions = {
		id: 'prctr.launch.quit',
		label: label('quit'),
		accelerator: 'CommandOrControl+Q',
		click: () => {
			if (!disposed && !window.isDestroyed()) onExit();
		}
	};
	const template: MenuItemConstructorOptions[] = [
		process.platform === 'darwin'
			? {
					label: label('application'),
					submenu: [
						{ role: 'hide' },
						{ role: 'hideOthers' },
						{ role: 'unhide' },
						{ type: 'separator' },
						quit
					]
				}
			: { label: label('file'), submenu: [{ role: 'close' }, { type: 'separator' }, quit] },
		{
			label: label('edit'),
			submenu: [
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				{ role: 'selectAll' }
			]
		},
		{
			label: label('view'),
			submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }]
		},
		{
			label: label('window'),
			submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
		},
		{
			label: label('help'),
			submenu: [
				{
					id: 'prctr.launch.diagnostics',
					label: label('diagnostics'),
					click: () => {
						if (disposed || showingDiagnostics || window.isDestroyed()) return;
						const current = projection();
						showingDiagnostics = true;
						void dialog
							.showMessageBox(window, {
								type: 'info',
								title: label('application'),
								message: label('diagnosticsTitle'),
								detail: localization.format(messages.diagnosticsDetail, {
									version: app.getVersion(),
									platform: `${process.platform} / ${process.arch}`,
									institution: current?.institutionName ?? label('unknown'),
									origin: current?.origin ?? label('none')
								}),
								buttons: [label('close')],
								noLink: true
							})
							.finally(() => {
								showingDiagnostics = false;
							})
							.catch(() => {
								/* Window closure can dismiss the native sheet. */
							});
					}
				}
			]
		}
	];
	const menu = Menu.buildFromTemplate(template);
	const activate = (): void => {
		if (!disposed && !window.isDestroyed()) Menu.setApplicationMenu(menu);
	};
	const owned: IDisposable = {
		dispose: () => {
			if (disposed) return;
			disposed = true;
			window.off('focus', activate);
			if (Menu.getApplicationMenu() === menu) Menu.setApplicationMenu(null);
			if (!window.isDestroyed()) window.setMenu(null);
		}
	};
	try {
		if (process.platform === 'darwin') {
			window.on('focus', activate);
			activate();
		} else {
			window.setMenu(menu);
			window.setAutoHideMenuBar(true);
			window.setMenuBarVisibility(false);
		}
		return owned;
	} catch (error) {
		owned.dispose();
		throw error;
	}
}
