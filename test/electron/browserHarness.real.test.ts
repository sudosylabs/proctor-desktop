import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

test('sandboxed Chromium renderer runs deterministic browser fixtures', () => {
  const electronExecutable: unknown = createRequire(import.meta.url)('electron');
  if (typeof electronExecutable !== 'string') {
    throw new TypeError('Electron package did not resolve to an executable path');
  }
  const output = execFileSync(electronExecutable, ['.build/browser-harness'], {
    encoding: 'utf8',
    timeout: 20_000
  }).trim();
  const result = JSON.parse(output) as {
    readonly chrome?: unknown;
    readonly electron?: unknown;
    readonly preferences?: unknown;
    readonly renderer?: unknown;
  };
  assert.equal(result.electron, '44.0.0');
  assert.equal(result.chrome, '152.0.7977.54');
  assert.deepEqual(result.preferences, {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false
  });
  assert.ok(typeof result.renderer === 'object' && result.renderer !== null);
  const { userAgent, ...renderer } = result.renderer as Record<string, unknown>;
  if (typeof userAgent !== 'string') {
    throw new TypeError('Renderer did not report a string user agent');
  }
  assert.match(userAgent, /\bChrome\/152\.0\.7977\.54\b/u);
  assert.match(userAgent, /\bElectron\/44\.0\.0\b/u);
  assert.deepEqual(renderer, {
    activations: '1',
    direction: 'rtl',
    fixture: 'browser-harness',
    hasNodeProcess: false,
    hasNodeRequire: false,
    heading: 'بيئة اختبار Proctor',
    locale: 'ar',
    ready: 'true'
  });
});
