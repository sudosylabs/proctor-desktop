import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { SettingsClipboardClient } from './settingsNativeHost.js';

export const ISettingsClipboardClient = createDecorator<SettingsClipboardClient>('settingsClipboardClient');
