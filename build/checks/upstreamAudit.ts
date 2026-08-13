import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { FileSystemRepository } from './repository.ts';

type Manifest = {
  readonly clusterId: string;
  readonly upstream: { readonly revision: string };
  readonly items: readonly { readonly upstreamPath: string; readonly upstreamBlob: string }[];
};

const repository = new FileSystemRepository(process.cwd());
const manifests = repository.files().filter(path => path.startsWith('docs/upstream/vscode-ports/') && path.endsWith('.json') && !path.endsWith('/schema.json'));
const arguments_ = process.argv.slice(2); let vscode: string | undefined; let cluster: string | undefined;
for (let index = 0; index < arguments_.length; index++) {
  const argument = arguments_[index];
  if (argument === '--vscode') vscode = arguments_[++index];
  else if (argument === '--cluster') cluster = arguments_[++index];
  else throw new Error(`Unknown argument ${argument}`);
}
if (manifests.length === 0 && arguments_.length === 0) {
  process.stdout.write('No admitted VS Code clusters require an upstream audit.\n');
} else {
  if (vscode === undefined) throw new Error('Usage: npm run audit:upstream -- --vscode <checkout> [--cluster <id>]');
  const checkout = resolve(vscode);
  const selected = manifests.map(path => ({ path, value: JSON.parse(repository.read(path)) as Manifest })).filter(entry => cluster === undefined || entry.value.clusterId === cluster);
  if (selected.length === 0) throw new Error(cluster === undefined ? 'No admitted VS Code cluster manifests exist.' : `Unknown VS Code port cluster ${cluster}`);
  let failures = 0;
  for (const entry of selected) {
    try {
      const revision = execFileSync('git', ['rev-parse', `${entry.value.upstream.revision}^{commit}`], { cwd: checkout, encoding: 'utf8' }).trim();
      if (revision !== entry.value.upstream.revision) throw new Error(`revision resolved to ${revision}`);
      for (const item of entry.value.items) {
        const blob = execFileSync('git', ['rev-parse', `${revision}:${item.upstreamPath}`], { cwd: checkout, encoding: 'utf8' }).trim();
        if (blob !== item.upstreamBlob) throw new Error(`${item.upstreamPath} expected ${item.upstreamBlob}, found ${blob}`);
      }
      process.stdout.write(`Audited ${entry.value.clusterId} at ${revision}.\n`);
    } catch (error) {
      failures++;
      process.stderr.write(`upstream.audit ${entry.path}\n  ${error instanceof Error ? error.message : String(error)}\n  Remediation: Re-intake the cluster against one exact VS Code commit and reconcile its manifest.\n`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}
