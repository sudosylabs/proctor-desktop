import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const outdir = '.build/window-skeleton'; rmSync(outdir, { recursive: true, force: true }); mkdirSync(outdir, { recursive: true });
await Promise.all([
  build({ absWorkingDir: process.cwd(), bundle: true, entryPoints: { main: 'test/electron/windowSkeletonMain.ts' }, external: ['electron', 'electron/main'], format: 'esm', outdir, platform: 'node', target: 'node24', tsconfig: 'build/tsconfig.electron-test.json' }),
  ...(['launch', 'authenticated', 'candidate'] as const).map(kind => build({ absWorkingDir: process.cwd(), bundle: true, entryPoints: { [`${kind}Preload`]: `src/prctr/code/electron-browser/${kind}Preload.ts` }, external: ['electron'], format: 'cjs', outExtension: { '.js': '.cjs' }, outdir, platform: 'node', target: 'node24', tsconfig: 'build/tsconfig.electron-browser.json' }))
]);
writeFileSync(`${outdir}/index.html`, '<!doctype html><html><body>Proctor window skeleton</body></html>\n', 'utf8');
writeFileSync(`${outdir}/package.json`, `${JSON.stringify({ name: 'proctor-window-skeleton', private: true, type: 'module', main: 'main.js' }, null, 2)}\n`, 'utf8');
