import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const harnessTimeout = setTimeout(() => {
	process.stdout.write(`${JSON.stringify({ error: 'browser_harness_timeout' })}\n`);
	app.exit(1);
}, 20_000);

void app.whenReady().then(runHarness).catch(failHarness);

async function runHarness(): Promise<void> {
	const window = new BrowserWindow({
		height: 600,
		show: false,
		webPreferences: {
			allowRunningInsecureContent: false,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			nodeIntegrationInWorker: false,
			sandbox: true,
			spellcheck: false,
			webSecurity: true,
			webviewTag: false
		},
		width: 900
	});
	try {
		window.webContents.on('did-navigate', () => window.webContents.setZoomFactor(2));
		await window.loadFile(join(app.getAppPath(), 'index.html'), {
			query: { locale: 'ar' }
		});
		const renderer = (await window.webContents.executeJavaScript(
			`(async () => {
      if (document.body.dataset.ready !== 'true') await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('renderer fixture timeout in ' + (document.body.dataset.currentSuite ?? 'initialization'))), 15000);
        const observer = new MutationObserver(() => {
          if (document.body.dataset.ready === 'true') { clearTimeout(timeout); observer.disconnect(); resolve(); }
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ready'] });
      });
      const button = document.querySelector('button');
      button?.click();
      const icons = [...document.querySelectorAll('.prctr-semantic-icon')];
      return {
        activations: button?.dataset.activations,
        browserOwnerTests: document.body.dataset.browserOwnerTests,
        browserOwnerError: document.body.dataset.browserOwnerError,
        controlExplorer: document.body.dataset.controlExplorer,
        direction: document.documentElement.dir,
        fixture: document.querySelector('main')?.dataset.fixture,
        hasNodeProcess: 'process' in globalThis,
        hasNodeRequire: 'require' in globalThis,
        heading: document.querySelector('h1')?.textContent,
        locale: document.documentElement.lang,
        motionDuration: getComputedStyle(document.documentElement).getPropertyValue('--prctr-motion-duration-normal'),
        overlayBackdrop: getComputedStyle(document.documentElement).getPropertyValue('--prctr-color-overlay-backdrop'),
        presentation: {
          density: document.documentElement.dataset.prctrDensity,
          motion: document.documentElement.dataset.prctrMotion,
          theme: document.documentElement.dataset.prctrTheme,
          themeContrast: document.documentElement.dataset.prctrThemeContrast,
          transparency: document.documentElement.dataset.prctrTransparency
        },
        semanticIcons: icons.map(icon => ({
          ariaHidden: icon.getAttribute('aria-hidden'),
          ariaLabel: icon.getAttribute('aria-label'),
          fontFamily: getComputedStyle(icon).fontFamily,
          id: icon.getAttribute('data-prctr-semantic-icon'),
          modifier: icon.getAttribute('data-prctr-icon-modifier'),
          role: icon.getAttribute('role'),
          size: getComputedStyle(icon).fontSize
        })),
        ready: document.body.dataset.ready,
        themeChanges: document.body.dataset.themeChanges,
        terminalPanelTests: document.body.dataset.terminalPanelTests,
        workbenchKernelTests: document.body.dataset.workbenchKernelTests,
        userAgent: navigator.userAgent
      };
    })()`,
			true
		)) as unknown;
		const preferences = (
			window.webContents as unknown as {
				getLastWebPreferences(): {
					readonly contextIsolation?: boolean;
					readonly nodeIntegration?: boolean;
					readonly nodeIntegrationInSubFrames?: boolean;
					readonly nodeIntegrationInWorker?: boolean;
					readonly sandbox?: boolean;
					readonly webSecurity?: boolean;
					readonly webviewTag?: boolean;
				};
			}
		).getLastWebPreferences();
		process.stdout.write(
			`${JSON.stringify({
				chrome: process.versions.chrome,
				electron: process.versions.electron,
				preferences: {
					contextIsolation: preferences.contextIsolation,
					nodeIntegration: preferences.nodeIntegration,
					nodeIntegrationInSubFrames: preferences.nodeIntegrationInSubFrames,
					nodeIntegrationInWorker: preferences.nodeIntegrationInWorker,
					sandbox: preferences.sandbox,
					webSecurity: preferences.webSecurity,
					webviewTag: preferences.webviewTag
				},
				zoomFactor: window.webContents.getZoomFactor(),
				renderer
			})}\n`
		);
		clearTimeout(harnessTimeout);
		window.destroy();
		app.exit(0);
	} catch (error) {
		window.destroy();
		failHarness(error);
	}
}

function failHarness(error: unknown): void {
	clearTimeout(harnessTimeout);
	process.stdout.write(
		`${JSON.stringify({
			error: 'browser_harness_failed',
			cause: error instanceof Error ? error.message : String(error)
		})}\n`
	);
	app.exit(1);
}
