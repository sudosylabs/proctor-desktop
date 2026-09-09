import { acquireDesktopInstanceLock } from '../../platform/identity/electron-main/desktopInstanceLock.js';
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { createDesktopIdentityComposition } from './desktopIdentityComposition.js';

// Closed development entrypoint. Build selectors are main-process arguments, never renderer data.
const args = process.argv.slice(2);
let release = '0.0.0-private';
let buildId = 'development';
let allowHttp = false;
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--release' && args[i + 1]) release = args[++i]!;
	else if (args[i] === '--build-id' && args[i + 1]) buildId = args[++i]!;
	else if (args[i] === '--allow-http-loopback') allowHttp = true;
	else throw new Error('Unknown Desktop development argument');
}
app.setName('Proctor Development');
// The coordinator owns closure; a secure replacement briefly has no window.
app.on('window-all-closed', () => {});
app.setPath('userData', join(app.getPath('appData'), 'Proctor Development'));
// One process owns this userData directory and its rotating refresh credentials.
const instanceLock = acquireDesktopInstanceLock(() => {
	const window = BrowserWindow.getAllWindows()[0];
	if (window) {
		if (window.isMinimized()) window.restore();
		window.show();
		window.focus();
	}
});
if (!instanceLock) app.exit(0);
else {
	app.once('will-quit', () => instanceLock.dispose());
	void app
		.whenReady()
		.then(() => {
			const root = app.getAppPath();
			const desktop = createDesktopIdentityComposition({
				target: {
					release,
					buildId,
					platform: process.platform,
					architecture: process.arch,
					realtimeProtocol: 1,
					authorizationProtocol: 1
				},
				window: {
					production: false,
					rendererByKind: {
						launch: join(root, 'launch.html'),
						authenticated: join(root, 'authenticated.html'),
						candidate: join(root, 'candidate-unavailable.html')
					},
					preloadByKind: {
						launch: join(root, 'launchPreload.cjs'),
						authenticated: join(root, 'authenticatedPreload.cjs'),
						candidate: join(root, 'candidatePreload.cjs')
					}
				},
				nativeKeyModule: join(root, 'prctr_desktop_key_custody.node'),
				stateDirectory: app.getPath('userData'),
				allowDevelopmentLoopback: allowHttp,
				locale: app.getLocale(),
				onExit: () => app.quit()
			});
			let drained = false;
			app.on('before-quit', (event) => {
				if (drained) return;
				event.preventDefault();
				void desktop.shutdown().then(() => {
					drained = true;
					app.quit();
				});
			});
		})
		.catch(() => {
			console.error('Desktop startup failed.');
			app.exit(1);
		});
}
