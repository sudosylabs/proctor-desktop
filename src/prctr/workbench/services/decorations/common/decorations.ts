/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-presentation

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { URI } from '../../../../base/common/uri.js';
import type { Event } from '../../../../base/common/event.js';
import type { ColorIdentifier } from '../../../../platform/theme/common/colorRegistry.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import type { CancellationToken } from '../../../../base/common/cancellation.js';
import type { ThemeIcon } from '../../../../base/common/themables.js';

export const IDecorationsService = createDecorator<IDecorationsService>('IFileDecorationsService');

/**
 * Stable marker class set on a label alongside the generated, per-color
 * {@link IDecoration.labelClassName}. Because that class carries a hashed
 * suffix, styling "labels that carry a decoration color" would otherwise need a
 * `[class*="..."]` substring match. Substring matches on `class` make every
 * class mutation in the workbench pay style invalidation, so use this marker
 * instead.
 */
export const DECORATION_LABEL_COLOR_CLASS = 'monaco-decoration-itemColor';

/**
 * Stable marker class set on a label with generated badge classes.
 */
export const DECORATION_BADGE_CLASS = 'monaco-decoration-badge';

export interface IDecorationData {
	readonly weight?: number;
	readonly color?: ColorIdentifier;
	readonly letter?: string | ThemeIcon;
	readonly tooltip?: string;
	readonly strikethrough?: boolean;
	readonly bubble?: boolean;
}

export interface IDecoration extends IDisposable {
	readonly tooltip: string;
	readonly strikethrough: boolean;
	readonly labelClassName: string;
	readonly badgeClassName: string;
	readonly iconClassName: string;
}

export interface IDecorationsProvider {
	readonly label: string;
	readonly onDidChange: Event<readonly URI[]>;
	provideDecorations(uri: URI, token: CancellationToken): IDecorationData | Promise<IDecorationData | undefined> | undefined;
}

export interface IResourceDecorationChangeEvent {
	affectsResource(uri: URI): boolean;
}

export interface IDecorationsService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeDecorations: Event<IResourceDecorationChangeEvent>;

	registerDecorationsProvider(provider: IDecorationsProvider): IDisposable;

	getDecoration(uri: URI, includeChildren: boolean): IDecoration | undefined;
}
