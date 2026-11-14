import { app, BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const timeout = setTimeout(() => app.exit(1), 25000);
void app.whenReady().then(async () => {
	const window = new BrowserWindow({
		show: false,
		width: 900,
		height: 700,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInWorker: false,
			backgroundThrottling: false,
			webSecurity: true
		}
	});
	// Windows and Linux lay out no page for a window that was never shown, and pdf.js renders
	// its text layer only once the page has a layout; show it without taking focus.
	if (process.platform !== 'darwin') window.showInactive();
	try {
		const remoteRequests: string[] = [];
		window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
			if (/^https?:/.test(details.url)) {
				remoteRequests.push(details.url);
				callback({ cancel: true });
			} else {
				callback({});
			}
		});
		window.webContents.on('console-message', (event) => {
			console.error(event.message);
		});
		const assets = await readFile(join(app.getAppPath(), 'assets.json'), 'utf8');
		await window.loadFile(join(app.getAppPath(), 'index.html'));
		const run = (code: string) => window.webContents.executeJavaScript(code);
		const waitFor = async (condition: string): Promise<void> => {
			for (let count = 0; count < 160; ++count) {
				if (await run(condition)) {
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(`Timeout ${condition}: ${await run('document.body.dataset.state')}`);
		};
		await run(`window.mountPreview('markdown',${assets})`);
		await waitFor(
			`document.body.dataset.state === 'ready' && !!document.querySelector('iframe')`
		);
		const frame = () =>
			window.webContents.mainFrame.frames.find(
				(candidate) => candidate.url === 'about:srcdoc'
			)!;
		for (
			let count = 0;
			count < 100 && !(await frame()?.executeJavaScript('!!document.querySelector("h1")'));
			++count
		) {
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		assert.equal(
			await frame().executeJavaScript('document.querySelector("h1")?.textContent'),
			'Preview'
		);
		assert.equal(await run('document.body.dataset.compromised'), undefined);
		assert.equal(
			await frame().executeJavaScript('try { parent.document.body; false } catch { true }'),
			true
		);
		assert.equal(await frame().executeJavaScript('typeof process'), 'undefined');
		assert.equal((await run("window.resolveMarkdownFragment('#preview')")).line, 0);
		await run(
			"document.documentElement.style.setProperty('--prctr-theme-editor-foreground', '#123456'); document.documentElement.style.colorScheme='light'; document.documentElement.dataset.prctrThemeContrast='high'"
		);
		for (
			let count = 0;
			count < 100 &&
			!(await frame().executeJavaScript(
				"document.body.classList.contains('vscode-high-contrast-light')"
			));
			++count
		) {
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		assert.equal(
			await frame().executeJavaScript('getComputedStyle(document.body).color'),
			'rgb(18, 52, 86)'
		);
		await run('window.updatePreview("# Changed\\n\\n[link](https://example.invalid/)")');
		await waitFor(`document.body.dataset.state === 'ready'`);
		for (
			let count = 0;
			count < 100 &&
			(await frame().executeJavaScript('document.querySelector("h1")?.textContent')) !==
				'Changed';
			++count
		) {
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		assert.equal(
			await frame().executeJavaScript('document.querySelector("h1")?.textContent'),
			'Changed'
		);
		await frame().executeJavaScript('document.querySelector("a").click()');
		await waitFor(`document.body.dataset.link === 'https://example.invalid/'`);
		const png = [
			...Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
				'base64'
			)
		];
		// A malformed container with a spoofed MIME must neither reach the parent
		// event loop nor prevent a later valid preview.
		const malformed = Buffer.alloc(16);
		malformed.write('icns');
		malformed.writeUInt32BE(16, 4);
		malformed.write('ic07', 8);
		await run(
			`window.mountPreview('image',${assets},${JSON.stringify([...malformed])},'image/png')`
		);
		await run(
			'window.__previewTimerAlive = false; setTimeout(() => window.__previewTimerAlive = true, 10)'
		);
		await waitFor('window.__previewTimerAlive === true');
		await waitFor("document.body.dataset.state === 'error'");
		assert.equal(await run('document.body.dataset.released'), 'true');
		await run(
			`window.mountPreview('image',${assets},${JSON.stringify([...malformed])},'image/avif')`
		);
		await run('window.revokePreview()');
		assert.equal(await run('document.body.dataset.state'), 'disposed');
		await run(
			`window.mountPreview('image',${assets},${JSON.stringify([...malformed])},'image/png')`
		);
		await run(`window.replacePreviewImage(${JSON.stringify(png)})`);
		await waitFor(`document.body.dataset.state === 'ready'`);
		// Allow the old decoder's deadline to pass. Its cancellation/error must not
		// clear the new document or release its current authorized lease.
		await new Promise((resolve) => setTimeout(resolve, 1100));
		assert.equal(await run('document.body.dataset.state'), 'ready');
		assert.equal(await run('document.body.dataset.replacementReleased'), 'false');
		assert.equal(
			await frame().executeJavaScript('document.querySelector("img").naturalWidth'),
			1
		);
		await run("window.zoomPreview('in')");
		await waitFor("document.body.dataset.scale === '1.5'");
		const svg =
			// SVG remains an image: embedded scripts and network references cannot execute.
			'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><script>parent.document.body.dataset.compromised="true"</script><image href="https://example.invalid/svg-image.png" width="24" height="12"/><rect width="24" height="12" fill="red"/></svg>';
		await run(
			`window.mountPreview('image',${assets},${JSON.stringify([...Buffer.from(svg)])},'image/svg+xml')`
		);
		await waitFor(`document.body.dataset.state === 'ready'`);
		assert.equal(
			await frame().executeJavaScript('document.querySelector("img").naturalWidth'),
			24
		);
		assert.equal(await run('document.body.dataset.compromised'), undefined);
		const gif = [
			...Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
		];
		await run(`window.mountPreview('image',${assets},${JSON.stringify(gif)},'image/gif')`);
		await waitFor(`document.body.dataset.state === 'ready'`);
		assert.equal(
			await frame().executeJavaScript('document.querySelector("img").naturalWidth'),
			1
		);
		const pdf =
			'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length 39>>stream\nBT /F1 12 Tf 10 150 Td (Hello PDF) Tj ET\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF';
		await run(`window.mountPreview('pdf',${assets},${JSON.stringify([...Buffer.from(pdf)])})`);
		await waitFor(`document.body.dataset.state === 'ready'`);
		for (
			let count = 0;
			count < 100 &&
			!(await frame().executeJavaScript('!!document.querySelector(".textLayer span")'));
			++count
		) {
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		const pdfText = await frame().executeJavaScript(
			'document.querySelector(".textLayer")?.textContent ?? ""'
		);
		assert.ok(typeof pdfText === 'string');
		assert.match(pdfText, /Hello PDF/);
		assert.equal(await run('document.body.dataset.pageCount'), '1');
		await run("window.findPreview('Hello')");
		await waitFor("document.body.dataset.matches === '1'");
		await run('window.revokePreview()');
		assert.equal(await run('document.querySelector("iframe") === null'), true);
		assert.equal(await run('document.body.dataset.released'), 'true');
		await run('window.updatePreview("![pending](pending.png)")');
		await run(`window.mountPreview('markdown',${assets})`);
		await waitFor(`document.body.dataset.pending === 'true'`);
		await run('window.revokePreview()');
		await run(`window.releasePendingPreviewResource(${JSON.stringify(png)})`);
		await waitFor(`document.body.dataset.pendingReleased === 'true'`);
		assert.equal(await run('document.querySelector("iframe") === null'), true);
		assert.deepEqual(remoteRequests, []);
		process.stdout.write(
			JSON.stringify({
				passed: true,
				markdown: true,
				image: true,
				pdfTextLayer: true,
				isolated: true
			}) + '\n'
		);
		clearTimeout(timeout);
		window.destroy();
		app.exit(0);
	} catch (error) {
		console.error(error);
		clearTimeout(timeout);
		window.destroy();
		app.exit(1);
	}
});
