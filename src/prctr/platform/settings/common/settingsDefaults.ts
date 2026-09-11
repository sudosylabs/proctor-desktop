import { isMacintosh, isWindows } from '../../../base/common/platform.js';
import type { SettingDeclaration } from './settingsManifest.js';

/** Platform-specific source defaults stay explicit in the portable registry fingerprint. */
export function settingDefault(declaration: Readonly<SettingDeclaration>): SettingDeclaration['default'] {
	return declaration.platformDefaults?.[isMacintosh ? 'mac' : isWindows ? 'windows' : 'linux'] ?? declaration.default;
}
