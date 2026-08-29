import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const outputDirectory = '.generated-check/security-utility';
const outputFile = `${outputDirectory}/securityUtilityProtocol.test.mjs`;

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });
try {
  await build({
    bundle: true,
    entryPoints: ['test/security-utility/securityUtilityProtocol.test.ts'],
    format: 'esm',
    outfile: outputFile,
    packages: 'external',
    platform: 'node',
    sourcemap: false,
    target: 'node24'
  });
  const result = spawnSync(process.execPath, ['--test', outputFile], { stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(outputDirectory, { force: true, recursive: true });
}
