import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const timeout = setTimeout(() => {
	app.exit(1);
}, 20_000);
void app.whenReady().then(async () => {
	const window = new BrowserWindow({
		show: true,
		width: 900,
		height: 650,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInWorker: false,
			webSecurity: true
		}
	});
	window.webContents.on('console-message', (details) => {
		if (details.level === 'error') process.stderr.write(`Worker fixture: ${details.message}\n`);
	});
	try {
		await window.loadFile(join(app.getAppPath(), 'index.html'));
		app.focus({ steal: true });
		window.focus();
		const result: unknown = await window.webContents.executeJavaScript(`new Promise(resolve => {
			const read = () => {
				if (!document.body.dataset.result) return false;
				resolve(JSON.parse(document.body.dataset.result)); return true;
			};
			if (!read()) {
				const observer = new MutationObserver(() => { if (read()) observer.disconnect(); });
				observer.observe(document.body, { attributes: true, attributeFilter: ['data-result'] });
			}
		})`);
		process.stdout.write(`${JSON.stringify(result)}\n`);
		window.destroy();
		clearTimeout(timeout);
		app.exit(0);
	} catch (error) {
		process.stderr.write(`${String(error)}\n`);
		app.exit(1);
	}
});
