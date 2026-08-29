import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const outputDirectory = '.generated-check/security-utility';
const testEntries = [
  'test/security-utility/nativePermissionBroker.test.ts',
  'test/security-utility/securityUtilityProtocol.test.ts'
] as const;
const outputFiles = testEntries.map(entry => (
  `${outputDirectory}/${entry.slice(entry.lastIndexOf('/') + 1).replace(/\.ts$/u, '.mjs')}`
));

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });
try {
  await build({
    bundle: true,
    entryPoints: [...testEntries],
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    outdir: outputDirectory,
    packages: 'external',
    platform: 'node',
    sourcemap: false,
    target: 'node24'
  });
  const result = spawnSync(process.execPath, ['--test', ...outputFiles], { stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(outputDirectory, { force: true, recursive: true });
}
