import type { ParsedSettingsDocument } from './settingsDocument.js';
import { activeSettingIds, settingsRegistry } from './settingsRegistry.js';
import type { EffectiveSettingId, SettingValueMap, SettingWindow } from './settingsManifest.js';

export type SettingSource = 'default' | 'portableUser' | 'device' | 'languageOverride' | 'windowConstraint' | 'examConstraint' | 'platformConstraint' | 'safetyInvariant';

export interface SettingConstraint<K extends EffectiveSettingId = EffectiveSettingId> {
  readonly id: K;
  readonly value: SettingValueMap[K];
  readonly reason: string;
}

export interface SettingsResolutionContext {
  readonly window: SettingWindow;
  readonly language?: string;
  readonly deviceValues?: Readonly<Partial<SettingValueMap>>;
  readonly windowConstraints?: readonly SettingConstraint[];
  readonly examConstraints?: readonly SettingConstraint[];
  readonly platformConstraints?: readonly SettingConstraint[];
  readonly safetyInvariants?: readonly SettingConstraint[];
}

export interface SettingInspection<K extends EffectiveSettingId> {
  readonly id: K;
  readonly requested: SettingValueMap[K];
  readonly effective: SettingValueMap[K];
  readonly source: SettingSource;
  readonly constraintReason?: string;
}

export class EffectiveSettings {
  readonly #values: ReadonlyMap<EffectiveSettingId, SettingInspection<EffectiveSettingId>>;

  constructor(document: ParsedSettingsDocument, context: SettingsResolutionContext) {
    const values = new Map<EffectiveSettingId, SettingInspection<EffectiveSettingId>>();
    const language = context.language?.toLowerCase();
    for (const id of activeSettingIds()) {
      const declaration = settingsRegistry.declaration(id)!;
      if (!declaration.windows.includes(context.window)) continue;
      let requested = declaration.default as SettingValueMap[typeof id];
      let source: SettingSource = 'default';
      const scoped = declaration.storage === 'portableUser' ? document.values.get(id) : context.deviceValues?.[id];
      const normalized = settingsRegistry.normalize(id, scoped);
      if (normalized !== undefined) {
        requested = normalized;
        source = declaration.storage === 'portableUser' ? 'portableUser' : 'device';
      }
      if (language !== undefined && declaration.languageOverride) {
        const languageValue = document.languageValues.get(language)?.get(id);
        const normalizedLanguage = settingsRegistry.normalize(id, languageValue);
        if (normalizedLanguage !== undefined) { requested = normalizedLanguage; source = 'languageOverride'; }
      }
      let effective = requested;
      let constraintReason: string | undefined;
      const tiers: readonly [readonly SettingConstraint[] | undefined, SettingSource][] = [
        [context.windowConstraints, 'windowConstraint'], [context.examConstraints, 'examConstraint'],
        [context.platformConstraints, 'platformConstraint'], [context.safetyInvariants, 'safetyInvariant']
      ];
      for (const [constraints, constraintSource] of tiers) {
        const constraint = constraints?.find(candidate => candidate.id === id);
        if (constraint === undefined) continue;
        const constrained = settingsRegistry.normalize(id, constraint.value);
        if (constrained === undefined) throw new Error(`Invalid trusted constraint for ${id}`);
        effective = constrained;
        source = constraintSource;
        constraintReason = boundedReason(constraint.reason);
      }
      values.set(id, Object.freeze({ id, requested, effective, source, ...(constraintReason === undefined ? {} : { constraintReason }) }));
    }
    this.#values = values;
  }

  get<K extends EffectiveSettingId>(id: K): SettingValueMap[K] {
    const inspection = this.#values.get(id);
    if (inspection === undefined) throw new Error(`Setting ${id} is not applicable to this window`);
    return inspection.effective as SettingValueMap[K];
  }

  inspect<K extends EffectiveSettingId>(id: K): SettingInspection<K> {
    const inspection = this.#values.get(id);
    if (inspection === undefined) throw new Error(`Setting ${id} is not applicable to this window`);
    return inspection as SettingInspection<K>;
  }
}

function boundedReason(reason: string): string {
  const sanitized = reason.replace(/[\r\n\u0000-\u001f]/gu, ' ').trim();
  return sanitized.slice(0, 160) || 'A trusted constraint applies.';
}
