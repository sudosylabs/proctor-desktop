import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import { checkAttemptConfigurationCompatibility, deriveAttemptConfiguration, projectFrozenAttemptConfiguration, validateFrozenAttemptConfiguration, type FrozenAttemptConfiguration } from '../../../../src/prctr/platform/settings/common/attemptConfiguration.ts';
import { parseSettingsDocument } from '../../../../src/prctr/platform/settings/common/settingsDocument.ts';
import { EffectiveSettings } from '../../../../src/prctr/platform/settings/common/settingsResolution.ts';
import { settingsRegistry } from '../../../../src/prctr/platform/settings/common/settingsRegistry.ts';

suite('Attempt Configuration', () => {
  test('derives a closed immutable candidate-safe object', () => {
    const effective = new EffectiveSettings(parseSettingsDocument('{"editor.fontSize":18,"editor.tabSize":2,"http.proxy":"x"}'), { window: 'candidate' });
    const candidate = deriveAttemptConfiguration(effective, { registryFingerprint: settingsRegistry.fingerprint, desktopBuild: '1.0.0', desktopTarget: 'darwin-arm64', userSettingsRevision: 'rev-1' }, ['candidate.submit', 'bad value'], ['ctrl+enter']);
    assert.strictEqual(candidate.presentation.editorFontSize, 18);
    assert.strictEqual('tabSize' in candidate.presentation, false);
    assert.strictEqual('source' in candidate, false);
    assert.deepStrictEqual(candidate.approvedCommands, ['candidate.submit']);
    assert.deepStrictEqual(candidate.approvedKeybindings, ['ctrl+enter']);
    assert.ok(Object.isFrozen(candidate.presentation));
	assert.throws(() => deriveAttemptConfiguration(effective, { registryFingerprint: settingsRegistry.fingerprint, desktopBuild: '1.0.0', desktopTarget: 'darwin-arm64', userSettingsRevision: 'rev-1' }, Array(129).fill('candidate.submit'), []), /too large/u);
	assert.throws(() => deriveAttemptConfiguration(effective, { registryFingerprint: settingsRegistry.fingerprint, desktopBuild: '1.0.0', desktopTarget: 'darwin-arm64', userSettingsRevision: 'rev-1' }, [], Array(129).fill('ctrl+enter')), /too large/u);
  });

  test('re-entry checks exact build/target/registry and projection does not mutate frozen state', () => {
    const effective = new EffectiveSettings(parseSettingsDocument('{}'), { window: 'candidate' });
    const base = deriveAttemptConfiguration(effective, { registryFingerprint: settingsRegistry.fingerprint, desktopBuild: '1', desktopTarget: 'win32-x64', userSettingsRevision: 'r' }, [], []);
    const frozen = Object.freeze({ ...base, attemptConfigurationRevision: 'a1', digest: 'sha256:server' }) as FrozenAttemptConfiguration;
	assert.deepStrictEqual(validateFrozenAttemptConfiguration(frozen), frozen);
    assert.deepStrictEqual(checkAttemptConfigurationCompatibility(frozen, { registryFingerprint: settingsRegistry.fingerprint, desktopBuild: '1', desktopTarget: 'win32-x64' }), { compatible: true });
    assert.deepStrictEqual(checkAttemptConfigurationCompatibility(frozen, { registryFingerprint: settingsRegistry.fingerprint, desktopBuild: '2', desktopTarget: 'win32-x64' }), { compatible: false, reason: 'build' });
    const projection = projectFrozenAttemptConfiguration(frozen, [{ id: 'accessibility.reducedMotion', value: true, reason: 'OS request' }]);
    assert.strictEqual(projection.presentation.reducedMotion, true);
    assert.strictEqual(frozen.presentation.reducedMotion, false);
    assert.throws(() => projectFrozenAttemptConfiguration(frozen, [{ id: 'editor.tabSize', value: 2, reason: 'not candidate-safe' }]));
	const strengthened = projectFrozenAttemptConfiguration(frozen, [{ id: 'workbench.preferHighContrast', value: true, reason: '  OS\ncontrast request  ' }, { id: 'editor.fontSize', value: frozen.presentation.editorFontSize + 2, reason: 'larger type' }]);
	assert.strictEqual(strengthened.presentation.preferHighContrast, true); assert.strictEqual(strengthened.presentation.editorFontSize, frozen.presentation.editorFontSize + 2); assert.deepStrictEqual(strengthened.appliedConstraintReasons, ['OS contrast request', 'larger type']);
	const alreadyStrong = { ...frozen, presentation: { ...frozen.presentation, reducedMotion: true, screenReaderMode: 'auto' as const, announcementMode: 'auto' as const } };
	assert.throws(() => projectFrozenAttemptConfiguration(alreadyStrong, [{ id: 'accessibility.reducedMotion', value: false, reason: 'weaker' }]), /preserve or strengthen/u);
	assert.throws(() => projectFrozenAttemptConfiguration(alreadyStrong, [{ id: 'accessibility.screenReaderMode', value: 'off', reason: 'weaker' }]), /preserve or strengthen/u);
	assert.throws(() => projectFrozenAttemptConfiguration(alreadyStrong, [{ id: 'accessibility.announcementMode', value: 'minimal', reason: 'weaker' }]), /preserve or strengthen/u);
	assert.throws(() => projectFrozenAttemptConfiguration(frozen, [{ id: 'window.zoomLevel', value: 'large', reason: 'invalid' } as never]), /preserve or strengthen/u);
	assert.throws(() => projectFrozenAttemptConfiguration(frozen, [{ id: 'window.zoomLevel', value: frozen.presentation.zoomPercent, reason: 'one' }, { id: 'window.zoomLevel', value: frozen.presentation.zoomPercent, reason: 'two' }]), /duplicated/u);
  });

	test('rejects malformed or non-canonical frozen values before projection', () => {
		const effective = new EffectiveSettings(parseSettingsDocument('{}'), { window: 'candidate' }); const base = deriveAttemptConfiguration(effective, { registryFingerprint: settingsRegistry.fingerprint, desktopBuild: '1', desktopTarget: 'darwin-arm64', userSettingsRevision: 'r1' }, ['candidate.submit'], ['ctrl+enter']); const frozen = { ...base, attemptConfigurationRevision: 'a1', digest: 'sha256:server' } as FrozenAttemptConfiguration;
		for (const invalid of [
			{ ...frozen, unexpected: true },
			{ ...frozen, presentation: { ...frozen.presentation, zoomPercent: Number.NaN } },
			{ ...frozen, digest: 'not-a-digest' },
			{ ...frozen, approvedCommands: ['bad value'] },
			{ ...frozen, approvedCommands: Array(129).fill('candidate.submit') },
			{ ...frozen, approvedKeybindings: ['ctrl+enter', 'ctrl+enter'] }
		]) assert.throws(() => validateFrozenAttemptConfiguration(invalid));
	});
});
