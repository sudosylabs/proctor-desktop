import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import type { IWorkbenchLayoutService, IWorkbenchLayoutGeometry, IWorkbenchPartLayoutService } from './layoutService.js';
import type { Event } from '../../../../base/common/event.js';

export const IEditorWorkbenchLayoutService = createDecorator<IEditorWorkbenchLayoutService>('editorWorkbenchLayout');
/** Source editor part layout over Proctor's existing shell, without authority to rebuild the shell. */
export interface IEditorWorkbenchLayoutService extends Omit<ILayoutService, 'getContainer'>, IWorkbenchLayoutGeometry, IWorkbenchPartLayoutService,
	Pick<IWorkbenchLayoutService, 'getContainer' | 'getMaximumEditorDimensions' | 'isRestored' | 'setPartHidden'> {
	readonly onDidChangePresentation: Event<void>;
	useUppercaseViewHeaders(): boolean;
	layout(): void;
}
