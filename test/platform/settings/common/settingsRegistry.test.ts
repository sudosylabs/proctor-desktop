import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import { SETTINGS_MANIFEST } from '../../../../src/prctr/platform/settings/common/settingsManifest.ts';
import { activeSettingIds, registryFingerprint, settingsRegistry } from '../../../../src/prctr/platform/settings/common/settingsRegistry.ts';

suite('Proctor settings registry', () => {
  test('is finite, immutable, unique, and fingerprinted deterministically', () => {
    assert.strictEqual(new Set(SETTINGS_MANIFEST.map(item => item.id)).size, SETTINGS_MANIFEST.length);
    assert.strictEqual(settingsRegistry.declarations.length, SETTINGS_MANIFEST.length);
    assert.ok(Object.isFrozen(settingsRegistry.declarations));
    assert.strictEqual(settingsRegistry.fingerprint, registryFingerprint({ version: settingsRegistry.version, declarations: settingsRegistry.declarations }));
    assert.strictEqual(activeSettingIds().length, SETTINGS_MANIFEST.filter(item => item.candidate !== 'prohibited').length);
  });

  test('normalizes only complete values and never activates prohibited keys', () => {
    assert.strictEqual(settingsRegistry.normalize('editor.fontSize', 18), 18);
    assert.strictEqual(settingsRegistry.normalize('editor.fontSize', 100), undefined);
    assert.strictEqual(settingsRegistry.normalize('editor.cursorStyle', 'beam'), undefined);
    assert.strictEqual(settingsRegistry.isEffective('http.proxy'), false);
  });
});
