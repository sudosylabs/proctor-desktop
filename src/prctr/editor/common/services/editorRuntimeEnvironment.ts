import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

/** Build mode only; editor features cannot inspect native paths or extension-host configuration. */
export const IEditorRuntimeEnvironment = createDecorator<IEditorRuntimeEnvironment>(
	'editorRuntimeEnvironment'
);
export interface IEditorRuntimeEnvironment {
	readonly _serviceBrand: undefined;
	readonly isDevelopment: boolean;
}
