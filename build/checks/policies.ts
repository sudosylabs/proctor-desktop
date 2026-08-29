import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import type { Diagnostic, Repository } from './types.ts';
import { diagnostic } from './types.ts';

export type SourcePolicy = {
  readonly sourceRoot: string;
  readonly layers: readonly string[];
  readonly environments: Readonly<Record<string, readonly string[]>>;
  readonly testSegments: readonly string[];
  readonly productionDynamicImportAllowlist: readonly string[];
};

export type Composition = {
  readonly id: string;
  readonly kind: 'main' | 'utility' | 'preload' | 'renderer';
  readonly entrypoint: string;
  readonly preload?: string;
  readonly required: readonly string[];
  readonly forbidden: readonly string[];
  readonly allowedDynamicImports: readonly string[];
};

export type CompositionPolicy = { readonly activationPath: string; readonly compositions: readonly Composition[] };
export type AssuranceControl = {
  readonly id: string;
  readonly kind: string;
  readonly status: 'active' | 'deferred';
  readonly owner: string;
  readonly invariants: readonly string[];
  readonly implementation?: string;
  readonly evidence?: readonly string[];
  readonly activation?: 'source-present' | 'workspace-source-present' | 'browser-source-present' | 'execution-source-present' | 'code-layer-present' | 'css-present' | 'settings-registry-present' | 'native-package-present' | 'packaged-target-present';
  readonly futureKind?: string;
  readonly rationale?: string;
};
export type AssurancePolicy = { readonly invariantSource: string; readonly controls: readonly AssuranceControl[] };
export type DependencyAdmission = {
  readonly ecosystem?: 'npm' | 'cargo';
  readonly package: string;
  readonly version: string;
  readonly kind: 'development' | 'production';
  readonly license: string;
  readonly lifecycleScripts: 'none' | 'blocked' | 'allowed';
  readonly declarations?: readonly {
    readonly manifest: string;
    readonly alias: string;
    readonly kind: 'development' | 'production';
    readonly features: readonly string[];
    readonly defaultFeatures: boolean;
    readonly optional: boolean;
    readonly targetScope: string | null;
  }[];
};
export type DependencyPolicy = {
  readonly allowedLicenseExpressions: readonly string[];
  readonly dependencies: readonly DependencyAdmission[];
};

export function readJson<T>(repository: Repository, path: string): T {
  return JSON.parse(repository.read(path)) as T;
}

const POLICY_FILES = ['assurance', 'compositions', 'dependencies', 'exceptions', 'source-boundaries'] as const;

export function validatePolicies(repository: Repository): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const name of POLICY_FILES) {
    const path = `build/policies/${name}.json`;
    const schemaPath = `build/policies/schemas/${name}.schema.json`;
    try {
      const value = readJson<unknown>(repository, path);
      const schema = readJson<object>(repository, schemaPath);
      const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
      const validate = ajv.compile(schema);
      if (!validate(value)) {
        for (const error of validate.errors ?? []) diagnostics.push(schemaDiagnostic(path, error));
      }
    } catch (error) {
      diagnostics.push(diagnostic('policy.schemas', path, error instanceof Error ? error.message : String(error), `Make ${path} valid JSON conforming to ${schemaPath}.`));
    }
  }
  return diagnostics;
}

function schemaDiagnostic(path: string, error: ErrorObject): Diagnostic {
  return diagnostic('policy.schemas', path, `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`, 'Update the policy to match its checked-in JSON Schema.');
}
