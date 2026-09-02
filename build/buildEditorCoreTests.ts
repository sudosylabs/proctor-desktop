import { globSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const outputDirectory = '.build/editor-core-tests';
rmSync(outputDirectory, { force: true, recursive: true }); mkdirSync(outputDirectory, { recursive: true });
await build({ absWorkingDir: process.cwd(), bundle: true, entryNames: '[dir]/[name]', entryPoints: globSync('test/editor/**/*.test.ts').sort(), format: 'esm', logLevel: 'info', outbase: 'test', outdir: outputDirectory, platform: 'node', sourcemap: false, tsconfig: 'build/tsconfig.editor-core-test.json', target: 'node24' });
