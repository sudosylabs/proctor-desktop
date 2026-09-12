import { validateApiValue } from '../../serverApi/node/apiContract.js';
import {
	canonicalContractDigest,
	parseStrictContractJson
} from '../../serverApi/node/canonicalContract.js';
import type { components } from '../../serverApi/common/serverApi.generated.js';
import {
	validateFrozenAttemptConfiguration,
	type AttemptConfigurationCandidate,
	type FrozenAttemptConfiguration
} from '../common/attemptConfiguration.js';
import { SETTINGS_REGISTRY_VERSION } from '../common/settingsManifest.js';

type CandidateWire = components['schemas']['AttemptConfigurationCandidate'];
type FrozenWire = components['schemas']['FrozenAttemptConfiguration'];
export function encodeAttemptConfiguration(
	candidate: AttemptConfigurationCandidate
): CandidateWire {
	const value = {
		manifest_fingerprint: candidate.manifestFingerprint,
		registry_fingerprint: candidate.registryFingerprint,
		desktop_build: candidate.desktopBuild,
		desktop_target: candidate.desktopTarget,
		user_settings_revision: candidate.userSettingsRevision,
		presentation: {
			color_theme: candidate.presentation.colorTheme,
			prefer_high_contrast: candidate.presentation.preferHighContrast,
			zoom_percent: candidate.presentation.zoomPercent,
			editor_font_size_px: candidate.presentation.editorFontSize,
			editor_line_height_px: candidate.presentation.editorLineHeight,
			reduced_motion: candidate.presentation.reducedMotion,
			screen_reader_mode: candidate.presentation.screenReaderMode,
			announcement_mode: candidate.presentation.announcementMode,
			cursor_style: candidate.presentation.cursorStyle,
			cursor_blinking: candidate.presentation.cursorBlinking
		},
		approved_commands: candidate.approvedCommands,
		approved_keybindings: candidate.approvedKeybindings
	};
	validateApiValue({ $ref: '#/components/schemas/AttemptConfigurationCandidate' }, value);
	canonicalContractDigest(value, 16384);
	// Also validate the packaged command catalog and presentation without requiring server output.
	validateFrozenAttemptConfiguration({
		...candidate,
		attemptConfigurationRevision: 'validation',
		digest: `sha256:${'0'.repeat(64)}`
	});
	return Object.freeze(value);
}
export function decodeFrozenAttemptConfiguration(bytes: Uint8Array): FrozenAttemptConfiguration {
	const value = parseStrictContractJson(bytes, { maxBytes: 16384, integerNumbersOnly: true });
	validateApiValue({ $ref: '#/components/schemas/FrozenAttemptConfiguration' }, value);
	const wire = value as FrozenWire;
	const { attempt_configuration_revision: revision, digest, ...candidate } = wire;
	if (canonicalContractDigest(candidate, 16384) !== digest)
		throw new TypeError('Frozen configuration digest mismatch');
	return validateFrozenAttemptConfiguration({
		schemaVersion: 1,
		registryVersion: SETTINGS_REGISTRY_VERSION,
		manifestFingerprint: candidate.manifest_fingerprint,
		registryFingerprint: candidate.registry_fingerprint,
		desktopBuild: candidate.desktop_build,
		desktopTarget: candidate.desktop_target,
		userSettingsRevision: candidate.user_settings_revision,
		presentation: {
			colorTheme: candidate.presentation.color_theme,
			preferHighContrast: candidate.presentation.prefer_high_contrast,
			zoomPercent: candidate.presentation.zoom_percent,
			editorFontSize: candidate.presentation.editor_font_size_px,
			editorLineHeight: candidate.presentation.editor_line_height_px,
			reducedMotion: candidate.presentation.reduced_motion,
			screenReaderMode: candidate.presentation.screen_reader_mode,
			announcementMode: candidate.presentation.announcement_mode,
			cursorStyle: candidate.presentation.cursor_style,
			cursorBlinking: candidate.presentation.cursor_blinking
		},
		approvedCommands: candidate.approved_commands,
		approvedKeybindings: candidate.approved_keybindings,
		attemptConfigurationRevision: revision,
		digest
	});
}
