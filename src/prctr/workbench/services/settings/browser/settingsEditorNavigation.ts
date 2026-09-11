import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { IEditorPane } from '../../../common/editor.js';
import type { IOpenSettingsOptions } from '../../preferences/common/preferences.js';

/** Routing within the current Settings modal; it has no file, workspace or remote target authority. */
export const ISettingsEditorNavigation = createDecorator<ISettingsEditorNavigation>('settingsEditorNavigation');
export interface ISettingsEditorNavigation {
	readonly _serviceBrand: undefined;
	openSettingsUi(options: IOpenSettingsOptions): Promise<IEditorPane | undefined>;
	openSettingsJson(options: IOpenSettingsOptions): Promise<IEditorPane | undefined>;
}
