import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import type { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';

/** The host explicitly supplies workspace variables, or none for an account editor. */
export const ISnippetWorkspaceContext = createDecorator<ISnippetWorkspaceContext>('snippetWorkspaceContext');

export interface ISnippetWorkspaceContext {
	readonly _serviceBrand: undefined;
	readonly workspace: IWorkspaceContextService | undefined;
}
