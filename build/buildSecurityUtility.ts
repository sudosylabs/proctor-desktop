import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const outputDirectory = '.build/security-utility';
const nativeOutput = join(outputDirectory, 'prctr_native_node_bridge.node');
const buildIdentity = sourceBuildIdentity();

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });
execFileSync('cargo', [
  'build', '--locked', '--manifest-path', 'native/Cargo.toml',
  '-p', 'prctr-native-node-bridge'
], { stdio: 'inherit' });
cpSync(nativeLibraryPath(), nativeOutput);

await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  define: {
    __PRCTR_ALLOW_UNSIGNED_SECURITY_UTILITY_NATIVE__: 'true',
    __PRCTR_SECURITY_UTILITY_TEST_DIAGNOSTICS__: 'true',
    __PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__: JSON.stringify(buildIdentity)
  },
  entryPoints: {
    main: 'src/prctr/code/electron-main/securityUtilityComposition.ts',
    'security-utility': 'src/prctr/code/electron-utility/securityUtilityEntryPoint.ts',
    'test-main': 'test/electron/securityUtilityMain.ts'
  },
  external: ['electron', 'electron/main', 'electron/utility'],
  format: 'esm',
  logLevel: 'info',
  outdir: outputDirectory,
  platform: 'node',
  sourcemap: false,
  target: 'node24'
});
writeFileSync(join(outputDirectory, 'package.json'), `${JSON.stringify({
  name: 'proctor-security-utility-test-harness',
  private: true,
  type: 'module',
  main: 'test-main.js'
}, null, 2)}\n`, 'utf8');

function nativeLibraryPath(): string {
  if (process.platform === 'win32') {
    return 'native/target/debug/prctr_native_node_bridge.dll';
  }
  const extension = process.platform === 'darwin' ? 'dylib' : 'so';
  return `native/target/debug/libprctr_native_node_bridge.${extension}`;
}

function sourceBuildIdentity(): string {
  const hash = createHash('sha256');
  const roots = ['package.json', 'package-lock.json', 'native/Cargo.lock', 'native/Cargo.toml', 'native/crates', 'native/schemas', 'src/prctr'];
  for (const path of roots.flatMap(walkFiles).sort()) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return `proctor-desktop@0.0.0-private:${hash.digest('hex')}`;
}

function walkFiles(path: string): readonly string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'target' || entry.name.startsWith('.')) return [];
    return walkFiles(join(path, entry.name));
  });
}
