import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canonicalContractDigest } from '../../../../src/prctr/platform/serverApi/node/canonicalContract.js';
import {
	decodeFrozenAttemptConfiguration,
	encodeAttemptConfiguration
} from '../../../../src/prctr/platform/settings/node/attemptConfigurationWire.js';
import { ATTEMPT_CONFIGURATION_MANIFEST_FINGERPRINT } from '../../../../src/prctr/platform/settings/common/attemptConfigurationManifest.js';
import { deriveAttemptConfiguration } from '../../../../src/prctr/platform/settings/common/attemptConfiguration.js';
import { EffectiveSettings } from '../../../../src/prctr/platform/settings/common/settingsResolution.js';
import { parseSettingsDocument } from '../../../../src/prctr/platform/settings/common/settingsDocument.js';
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const candidate = () =>
	deriveAttemptConfiguration(
		new EffectiveSettings(parseSettingsDocument('{}'), { window: 'candidate' }),
		{
			registryFingerprint: `fnv1a64:${'1'.repeat(16)}`,
			desktopBuild: '1.0.0',
			desktopTarget: 'darwin-arm64',
			userSettingsRevision: 'a'.repeat(26)
		},
		[],
		[]
	);
void test('packaged command manifest matches its complete canonical fingerprint', () => {
	const manifest: unknown = JSON.parse(
		readFileSync('resources/attempt-configuration/manifest.json', 'utf8')
	);
	assert.equal(canonicalContractDigest(manifest), ATTEMPT_CONFIGURATION_MANIFEST_FINGERPRINT);
});
void test('frozen configuration verifies complete snake-case bytes before projection', () => {
	const original = candidate();
	const wire = encodeAttemptConfiguration(original);
	const frozen = {
		...wire,
		attempt_configuration_revision: 'b'.repeat(26),
		digest: canonicalContractDigest(wire)
	};
	const decoded = decodeFrozenAttemptConfiguration(encode(frozen));
	assert.deepEqual(decoded.presentation, original.presentation);
	assert.equal(decoded.manifestFingerprint, original.manifestFingerprint);
	assert.throws(
		() => decodeFrozenAttemptConfiguration(encode({ ...frozen, desktop_build: 'different' })),
		/digest/
	);
	assert.throws(() =>
		decodeFrozenAttemptConfiguration(
			new TextEncoder().encode(
				JSON.stringify(frozen).replace(
					'"desktop_build":',
					'"desktop_build":"duplicate","desktop_build":'
				)
			)
		)
	);
	assert.throws(() =>
		encodeAttemptConfiguration({ ...original, approvedCommands: ['unapproved.command'] })
	);
});
