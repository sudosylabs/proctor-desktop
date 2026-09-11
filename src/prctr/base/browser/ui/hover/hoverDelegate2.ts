/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-controls

import { Disposable, toDisposable, type IDisposable } from '../../../common/lifecycle.js';
import type { IHoverDelegate2 } from './hover.js';

const nullHoverDelegate: IHoverDelegate2 = {
	showInstantHover: () => undefined,
	showDelayedHover: () => undefined,
	setupDelayedHover: () => Disposable.None,
	setupDelayedHoverAtMouse: () => Disposable.None,
	hideHover: () => undefined,
	showAndFocusLastHover: () => undefined,
	setupManagedHover: () => ({
		dispose: () => undefined,
		show: () => undefined,
		hide: () => undefined,
		update: () => undefined,
	}),
	showManagedHover: () => undefined
};
const bindings = [{ delegate: nullHoverDelegate }];

/**
 * Sets the hover delegate for use **only in the `base/` layer**.
 */
export function setBaseLayerHoverDelegate(hoverDelegate: IHoverDelegate2): IDisposable {
	const binding = { delegate: hoverDelegate };
	bindings.push(binding);
	return toDisposable(() => { bindings.splice(bindings.indexOf(binding), 1); });
}

/**
 * Gets the hover delegate for use **only in the `base/` layer**.
 *
 * Since the hover service depends on various platform services, this delegate essentially bypasses
 * the standard dependency injection mechanism by injecting a global hover service at start up. The
 * only reason this should be used is if `IHoverService` is not available.
 */
export function getBaseLayerHoverDelegate(): IHoverDelegate2 {
	return bindings[bindings.length - 1].delegate;
}
