import {
  copyFileSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { build } from 'esbuild';

const outputDirectory = '.build/browser-harness';

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });

await Promise.all([
  build({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: { renderer: 'test/browser/rendererHarness.ts' },
    format: 'esm',
    logLevel: 'info',
    outdir: outputDirectory,
    platform: 'browser',
    sourcemap: false,
    target: 'chrome152',
    tsconfig: 'build/tsconfig.browser.json'
  }),
  build({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: { main: 'test/electron/browserHarnessMain.ts' },
    external: ['electron', 'electron/main'],
    format: 'esm',
    logLevel: 'info',
    outdir: outputDirectory,
    platform: 'node',
    sourcemap: false,
    target: 'node24',
    tsconfig: 'build/tsconfig.electron-main.json'
  })
]);

copyFileSync('test/browser/rendererHarness.html', `${outputDirectory}/index.html`);
writeFileSync(`${outputDirectory}/package.json`, `${JSON.stringify({
  name: 'proctor-browser-test-harness',
  private: true,
  type: 'module',
  main: 'main.js'
}, null, 2)}\n`, 'utf8');
