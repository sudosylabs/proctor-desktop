import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
app.setName('Proctor Notification Preview');
void app
	.whenReady()
	.then(async () => {
		const window = new BrowserWindow({
			width: 1000,
			height: 700,
			minWidth: 520,
			minHeight: 440,
			backgroundColor: '#181818',
			titleBarStyle: 'hiddenInset',
			webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
		});
		window.webContents.on('console-message', (_event, _level, message) =>
			console.error(message)
		);
		window.webContents.on('render-process-gone', (_event, details) => console.error(details));
		window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
		await window.loadFile(join(import.meta.dirname, 'index.html'));
		window.webContents.on('will-navigate', (event) => event.preventDefault());
		if (process.argv.includes('--capture')) {
			await new Promise((resolve) => setTimeout(resolve, 750));
			writeFileSync(
				join(import.meta.dirname, 'preview.png'),
				(await window.webContents.capturePage()).toPNG()
			);
			app.quit();
		}
		app.on('window-all-closed', () => app.quit());
	})
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});
