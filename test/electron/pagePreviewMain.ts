import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Renders AuthenticatedWindow pages offscreen, at the size the design boards draw the window,
 * and saves each as a PNG. Arguments: an output folder, then shots as `name=page,theme`.
 */
const [outputFolder = '.', ...shots] = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
app.setName('Proctor page preview');
void app
	.whenReady()
	.then(async () => {
		for (const shot of shots) {
			const [name, spec = ''] = shot.split('=');
			const window = new BrowserWindow({
				width: 1392,
				height: 852,
				show: false,
				webPreferences: {
					offscreen: true,
					sandbox: true,
					contextIsolation: true,
					nodeIntegration: false
				}
			});
			window.webContents.setFrameRate(30);
			window.webContents.on('console-message', (event) => {
				if (event.level === 'error') console.error(`[${name}] ${event.message}`);
			});
			await window.loadFile(join(import.meta.dirname, 'index.html'), {
				query: { shot: spec }
			});
			// The page reports when its data has arrived and it has settled.
			for (let i = 0; i < 100; i++) {
				const ready = await window.webContents.executeJavaScript(
					'document.documentElement.dataset.previewReady === "true"'
				);
				if (ready) break;
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			await new Promise((resolve) => setTimeout(resolve, 600));
			const image = await window.webContents.capturePage();
			writeFileSync(join(outputFolder, `${name}.png`), image.toPNG());
			window.destroy();
		}
		app.quit();
	})
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});
