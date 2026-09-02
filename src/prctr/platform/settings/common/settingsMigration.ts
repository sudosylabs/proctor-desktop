import type { Edit } from '../../../base/common/jsonFormatter.js';
import { parseTree } from '../../../base/common/json.js';
import { parseSettingsDocument, type SettingsDiagnostic } from './settingsDocument.js';
import { settingsRegistry } from './settingsRegistry.js';

export interface SettingsMigrationResult {
  readonly source: string;
  readonly changed: boolean;
  readonly diagnostics: readonly SettingsDiagnostic[];
  readonly migrated: readonly { readonly from: string; readonly to: string }[];
}

export function migrateSettingsDocument(source: string, storedRegistryVersion: number): SettingsMigrationResult {
  const parsed = parseSettingsDocument(source);
  if (!parsed.valid || parsed.root === undefined) return Object.freeze({ source, changed: false, diagnostics: parsed.diagnostics, migrated: [] });
  let next = source;
  const migrated: { from: string; to: string }[] = [];
  for (const declaration of settingsRegistry.declarations) {
    const migration = declaration.migration;
    if (migration === undefined || storedRegistryVersion >= migration.removeAfter) continue;
    if (!Object.hasOwn(parsed.root, migration.from) || Object.hasOwn(parsed.root, declaration.id)) continue;
    const tree = parseTree(next, [], { allowTrailingComma: true });
    const property = tree.children?.find(candidate => candidate.children?.[0]?.value === migration.from);
    const key = property?.children?.[0];
    if (key === undefined) continue;
    next = applyEdits(next, [{ offset: key.offset, length: key.length, content: JSON.stringify(declaration.id) }]);
    migrated.push({ from: migration.from, to: declaration.id });
  }
  return Object.freeze({ source: next, changed: next !== source, diagnostics: parsed.diagnostics, migrated: Object.freeze(migrated) });
}

export function applyEdits(source: string, edits: readonly Edit[]): string {
  let result = source;
  for (let index = edits.length - 1; index >= 0; index--) {
    const edit = edits[index]!;
    result = result.slice(0, edit.offset) + edit.content + result.slice(edit.offset + edit.length);
  }
  return result;
}
