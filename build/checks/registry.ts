import type { Check } from './types.ts';
import { assuranceCheck, policySchemaCheck } from './assurance.ts';
import { dependencyCheck } from './dependencies.ts';
import { documentationCheck, hygieneCheck, pinnedActionsCheck } from './documentation.ts';
import { generatedCheck } from './generated.ts';
import { provenanceCheck } from './provenance.ts';
import { compositionCheck, cssCheck, sourceGraphCheck } from './source.ts';

export const checks: readonly Check[] = [
  policySchemaCheck,
  assuranceCheck,
  dependencyCheck,
  documentationCheck,
  hygieneCheck,
  pinnedActionsCheck,
  generatedCheck,
  provenanceCheck,
  sourceGraphCheck,
  compositionCheck,
  cssCheck
];

export function checkMap(entries: readonly Check[] = checks): ReadonlyMap<string, Check> {
  const result = new Map<string, Check>();
  for (const entry of entries) {
    if (result.has(entry.id)) throw new Error(`Duplicate check id ${entry.id}`);
    result.set(entry.id, entry);
  }
  return result;
}
