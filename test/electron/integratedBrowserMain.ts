import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { app, BrowserWindow, type WebContentsView } from 'electron';
import { BrowserHostSupervisor } from '../../src/prctr/platform/integratedBrowser/common/browserHostSupervisor.js';
import { createElectronBrowserHostFactory } from '../../src/prctr/platform/integratedBrowser/electron-main/electronBrowserEnforcer.js';
import {
	decideBrowserNavigation,
	validateBrowserPolicy
} from '../../src/prctr/platform/integratedBrowser/common/browserPolicy.js';

const deadline = setTimeout(() => {
	process.stdout.write('{"error":"integrated_browser_timeout"}\n');
	app.exit(1);
}, 20_000);
void app
	.whenReady()
	.then(async () => {
		const server = createServer((request, response) => {
			response.setHeader('Content-Type', 'text/html');
			response.end(
				request.url === '/redirect'
					? ''
					: '<!doctype html><title>Approved page</title><body>Approved browser fixture</body>'
			);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		assert(address && typeof address !== 'string');
		const origin = `http://127.0.0.1:${address.port}`;
		const policy = validateBrowserPolicy(
			{
				schemaVersion: 1,
				attemptId: 'attempt',
				participationGeneration: 1,
				revision: 'revision',
				ordinal: 1,
				digest: 'sha256:abcdefgh',
				rules: [
					{
						id: 'allowed',
						origin,
						allowRedirects: true,
						blockedConsequence: 'activity',
						institutionHttpException: true
					}
				]
			},
			{ institutionOrigin: `https://127.0.0.1:${address.port}` }
		);
		const window = new BrowserWindow({
			show: false,
			webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
		});
		const views: WebContentsView[] = [];
		let destroyed = 0;
		let popupAttempts = 0;
		let failures = 0;
		const factory = createElectronBrowserHostFactory({
			updateSurface(view, surface) {
				if (!views.includes(view)) {
					views.push(view);
					window.contentView.addChildView(view);
				}
				view.setBounds(surface.bounds);
				view.setVisible(surface.visible);
			},
			detachAndDestroy(view) {
				window.contentView.removeChildView(view);
				const gone = new Promise<void>((resolve) =>
					view.webContents.once('destroyed', resolve)
				);
				view.webContents.close({ waitForBeforeUnload: false });
				destroyed++;
				return gone;
			}
		});
		const supervisor = new BrowserHostSupervisor(
			factory,
			{
				checkTopLevel: (url, kind, redirectFromRuleId) =>
					decideBrowserNavigation(
						policy,
						url,
						kind === 'redirect' ? { redirectFromRuleId } : {}
					),
				checkSubresource: (url) => decideBrowserNavigation(policy, url).allowed,
				commitTopLevel() {},
				blockPopup() {
					popupAttempts++;
				}
			},
			() => {
				failures++;
			}
		);
		try {
			supervisor.setSurface({
				visible: true,
				focus: false,
				bounds: { x: 0, y: 0, width: 800, height: 600 }
			});
			supervisor.setInputBlocked(false);
			await supervisor.open(origin);
			assert.equal(views.length, 1);
			const first = views[0]!.webContents;
			assert.equal(
				await first.executeJavaScript("typeof process + ':' + typeof require"),
				'undefined:undefined'
			);
			assert.equal(
				await first.executeJavaScript(
					"fetch('http://127.0.0.2/forbidden').then(() => false, () => true)"
				),
				true
			);
			await first.executeJavaScript("window.open('https://example.net/forbidden'); true");
			assert.equal(popupAttempts, 1);
			await first.executeJavaScript("localStorage.setItem('prior-partition', 'yes'); true");
			const firstDestroyed = new Promise<void>((resolve) => first.once('destroyed', resolve));
			supervisor.setInputBlocked(true);
			assert.equal(destroyed, 1);
			await firstDestroyed;
			assert.equal(first.isDestroyed(), true);
			supervisor.setInputBlocked(false);
			await supervisor.reload();
			assert.equal(views.length, 2);
			// reload() is asynchronous at the engine boundary; execute after its finished load.
			if (views[1]!.webContents.isLoading())
				await new Promise<void>((resolve) =>
					views[1]!.webContents.once('did-finish-load', resolve)
				);
			assert.equal(
				await views[1]!.webContents.executeJavaScript(
					"localStorage.getItem('prior-partition')"
				),
				null
			);
			await supervisor.close();
			assert.equal(destroyed, 2);
			assert.equal(failures, 0);
			process.stdout.write(
				JSON.stringify({
					passed: true,
					sandboxed: true,
					networkDenied: true,
					popupDenied: true,
					pauseDestroyed: true,
					ephemeralResume: true
				}) + '\n'
			);
		} finally {
			await supervisor.close();
			window.destroy();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			);
			clearTimeout(deadline);
		}
		app.exit(0);
	})
	.catch((error) => {
		process.stdout.write(
			JSON.stringify({
				error: 'integrated_browser_failed',
				details: String(error?.stack ?? error)
			}) + '\n'
		);
		app.exit(1);
	});
