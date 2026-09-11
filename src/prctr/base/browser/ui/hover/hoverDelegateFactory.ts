/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-controls

import type { IHoverDelegate, IScopedHoverDelegate } from './hoverDelegate.js';
import { Lazy } from '../../../common/lazy.js';
import { toDisposable, type IDisposable } from '../../../common/lifecycle.js';

const nullHoverDelegateFactory = () => ({
	get delay(): number { return -1; },
	dispose: () => { },
	showHover: () => { return undefined; },
});

type HoverDelegateFactory = (placement: 'mouse' | 'element', enableInstantHover: boolean) => IScopedHoverDelegate;
function createBinding(factory: HoverDelegateFactory) {
	return { factory, mouse: new Lazy<IHoverDelegate>(() => factory('mouse', false)), element: new Lazy<IHoverDelegate>(() => factory('element', false)) };
}
const bindings = [createBinding(nullHoverDelegateFactory)];

// TODO: Remove when getDefaultHoverDelegate is no longer used
export function setHoverDelegateFactory(hoverDelegateProvider: ((placement: 'mouse' | 'element', enableInstantHover: boolean) => IScopedHoverDelegate)): IDisposable {
	// Proctor owns this binding for one window service graph. Do not retain a
	// resolved null delegate or the delegate of a disposed prior composition.
	const binding = createBinding(hoverDelegateProvider);
	bindings.push(binding);
	return toDisposable(() => { bindings.splice(bindings.indexOf(binding), 1); });
}

// TODO: Refine type for use in new IHoverService interface
export function getDefaultHoverDelegate(placement: 'mouse' | 'element'): IHoverDelegate {
	if (placement === 'element') {
		return bindings[bindings.length - 1].element.value;
	}
	return bindings[bindings.length - 1].mouse.value;
}

// TODO: Create equivalent in IHoverService
export function createInstantHoverDelegate(): IScopedHoverDelegate {
	// Creates a hover delegate with instant hover enabled.
	// This hover belongs to the consumer and requires the them to dispose it.
	// Instant hover only makes sense for 'element' placement.
	return bindings[bindings.length - 1].factory('element', true);
}
