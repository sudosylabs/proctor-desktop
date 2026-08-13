import type { Check, Diagnostic } from './types.ts';
import { diagnostic } from './types.ts';
import { readJson } from './policies.ts';

type PackageManifest = { readonly packageManager?: string; readonly dependencies?: Readonly<Record<string, string>>; readonly devDependencies?: Readonly<Record<string, string>>; readonly allowScripts?: Readonly<Record<string, boolean>> };
type Admission = { readonly package: string; readonly version: string; readonly kind: 'development' | 'production'; readonly lifecycleScripts: 'none' | 'blocked' | 'allowed' };
type DependencyPolicy = { readonly dependencies: readonly Admission[] };

export const dependencyCheck: Check = {
  id: 'dependencies.admission', category: 'dependency', contractRequired: true,
  run: ({ repository }) => {
    const path = 'package.json';
    const diagnostics: Diagnostic[] = [];
    const manifest = readJson<PackageManifest>(repository, path);
    const policy = readJson<DependencyPolicy>(repository, 'build/policies/dependencies.json');
    const admitted = new Map(policy.dependencies.map(entry => [entry.package, entry]));
    const declared = new Map<string, { version: string; kind: 'development' | 'production' }>();
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) declared.set(name, { version, kind: 'production' });
    for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) declared.set(name, { version, kind: 'development' });
    for (const [name, declaration] of declared) {
      const entry = admitted.get(name);
      if (entry === undefined) diagnostics.push(diagnostic('dependencies.admission', path, `${name} is not admitted.`, 'Add a complete reviewed entry to build/policies/dependencies.json.'));
      else if (entry.version !== declaration.version || entry.kind !== declaration.kind) diagnostics.push(diagnostic('dependencies.admission', path, `${name} does not match its admitted version or kind.`, 'Update the manifest, lockfile, and admission record together.'));
      if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(declaration.version)) diagnostics.push(diagnostic('dependencies.admission', path, `${name} is not pinned to an exact version.`, 'Use an exact dependency version.'));
    }
    for (const entry of policy.dependencies) if (!declared.has(entry.package)) diagnostics.push(diagnostic('dependencies.admission', 'build/policies/dependencies.json', `${entry.package} is admitted but not declared.`, 'Remove the orphan admission or declare the dependency.'));
    const scripts = manifest.allowScripts ?? {};
    for (const [name, allowed] of Object.entries(scripts)) {
      const entry = admitted.get(name);
      if (entry === undefined || !declared.has(name)) diagnostics.push(diagnostic('dependencies.admission', path, `allowScripts contains orphan package ${name}.`, 'Remove the orphan lifecycle-script decision.'));
      else if ((entry.lifecycleScripts === 'allowed') !== allowed) diagnostics.push(diagnostic('dependencies.admission', path, `allowScripts disagrees with the admission for ${name}.`, 'Reconcile lifecycle-script policy and package metadata.'));
    }
    for (const entry of policy.dependencies) if (entry.lifecycleScripts === 'allowed' && scripts[entry.package] !== true) diagnostics.push(diagnostic('dependencies.admission', path, `${entry.package} requires an explicit allowed lifecycle-script entry.`, 'Set allowScripts only after the admission records the reviewed script.'));
    if (manifest.packageManager !== 'npm@11.19.0') diagnostics.push(diagnostic('dependencies.admission', path, 'packageManager is not the accepted exact npm version.', 'Set packageManager to npm@11.19.0.'));
    return diagnostics;
  }
};
