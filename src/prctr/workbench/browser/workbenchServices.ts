/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../platform/instantiation/common/instantiation.js';
import type { ProductWindowChrome } from '../../platform/windows/browser/productWindowChrome.js';
import type { ProductWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import type { WorkbenchComposition } from '../common/composition.js';
import type { WorkbenchPaneHost } from './paneHost.js';
import type { WorkbenchItemResolverRegistry } from './workbenchPane.js';
import type { WorkbenchShell } from './workbenchShell.js';

export const IWorkbenchWindowService =
	createDecorator<IWorkbenchWindowService>('workbenchWindowService');

/**
 * The window this workbench renders into: its document, its packaged composition and
 * the privileged binding established before the shell was shown.
 */
export interface IWorkbenchWindowService {
	readonly _serviceBrand: undefined;
	readonly document: Document;
	readonly composition: WorkbenchComposition;
	readonly binding: ProductWindowDescriptor;
}

export const IWorkbenchShellService =
	createDecorator<IWorkbenchShellService>('workbenchShellService');
/** The window's regions, overlay host and layout. */
export type IWorkbenchShellService = WorkbenchShell;

export const IWorkbenchPaneHostService = createDecorator<IWorkbenchPaneHostService>(
	'workbenchPaneHostService'
);
/** The content area's single pane host; a destination's contribution assigns it. */
export type IWorkbenchPaneHostService = WorkbenchPaneHost;

export const IWorkbenchItemResolverService = createDecorator<IWorkbenchItemResolverService>(
	'workbenchItemResolverService'
);
/** Resolvers that turn a workbench item into its model and pane. */
export type IWorkbenchItemResolverService = WorkbenchItemResolverRegistry;

export const IProductWindowChromeService = createDecorator<IProductWindowChromeService>(
	'productWindowChromeService'
);
/** The native window chrome, in windows whose root provides a chrome client. */
export interface IProductWindowChromeService extends Pick<
	ProductWindowChrome,
	'element' | 'actions' | 'configuration'
> {
	readonly _serviceBrand: undefined;
}
