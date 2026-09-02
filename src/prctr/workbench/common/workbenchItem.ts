/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from '../../base/common/event.js';
import type { IDisposable } from '../../base/common/lifecycle.js';

export interface WorkbenchItemPresentation {
	readonly title: string;
	readonly accessibleLabel: string;
	readonly description?: string;
}

export interface WorkbenchItem {
	readonly typeId: string;
	readonly logicalIdentity: string;
	readonly presentation: WorkbenchItemPresentation;
	readonly closable: boolean;
	readonly restorable: boolean;
	readonly onDidChangePresentation: Event<void>;
	matches(other: WorkbenchItem): boolean;
}

export interface ResolvedWorkbenchItem extends IDisposable {
	readonly item: WorkbenchItem;
}
