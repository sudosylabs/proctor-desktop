import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const harnessTimeout = setTimeout(() => {
  process.stdout.write(`${JSON.stringify({ error: 'browser_harness_timeout' })}\n`);
  app.exit(1);
}, 10_000);

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
    await window.loadFile(join(app.getAppPath(), 'index.html'), {
      query: { locale: 'ar' }
    });
    const renderer = await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('button');
      button?.click();
      return {
        activations: button?.dataset.activations,
        direction: document.documentElement.dir,
        fixture: document.querySelector('main')?.dataset.fixture,
        hasNodeProcess: 'process' in globalThis,
        hasNodeRequire: 'require' in globalThis,
        heading: document.querySelector('h1')?.textContent,
        locale: document.documentElement.lang,
        ready: document.body.dataset.ready,
        userAgent: navigator.userAgent
      };
    })()`, true) as unknown;
    const preferences = (window.webContents as unknown as {
      getLastWebPreferences(): {
        readonly contextIsolation?: boolean;
        readonly nodeIntegration?: boolean;
        readonly nodeIntegrationInSubFrames?: boolean;
        readonly nodeIntegrationInWorker?: boolean;
        readonly sandbox?: boolean;
        readonly webSecurity?: boolean;
        readonly webviewTag?: boolean;
      };
    }).getLastWebPreferences();
    process.stdout.write(`${JSON.stringify({
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
      renderer
    })}\n`);
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
  process.stdout.write(`${JSON.stringify({
    error: 'browser_harness_failed',
    cause: error instanceof Error ? error.message : String(error)
  })}\n`);
  app.exit(1);
}
