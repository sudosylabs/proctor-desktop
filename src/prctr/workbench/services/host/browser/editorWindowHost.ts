import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { IHostService } from './host.js';

/** The editor can focus/dim its owning window; it cannot open windows or control application lifetime. */
export const IEditorWindowHost = createDecorator<IEditorWindowHost>('editorWindowHost');
export interface IEditorWindowHost extends Pick<
	IHostService,
	| '_serviceBrand'
	| 'onDidChangeFocus'
	| 'hasFocus'
	| 'focus'
	| 'moveTop'
	| 'setWindowDimmed'
	| 'getCursorScreenPoint'
> {}
