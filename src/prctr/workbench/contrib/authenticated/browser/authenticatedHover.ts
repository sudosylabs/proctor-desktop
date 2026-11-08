/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';

export const IAuthenticatedHoverService = createDecorator<IAuthenticatedHoverService>(
	'authenticatedHoverService'
);

/** AuthenticatedWindow's tooltip: shown on hover and keyboard focus, in the frame's own style. */
export interface IAuthenticatedHoverService {
	readonly _serviceBrand: undefined;
	/** Shows `label` under `target`, followed by the shortcut of `command` when it has one. */
	setupHover(target: HTMLElement, label: string, command?: string): IDisposable;
}

export class AuthenticatedHoverService implements IAuthenticatedHoverService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IHoverService private readonly hoverService: IHoverService,
		@IKeybindingService private readonly keybindingService: IKeybindingService
	) {}

	setupHover(target: HTMLElement, label: string, command?: string): IDisposable {
		return this.hoverService.setupDelayedHover(
			target,
			() => ({
				content: this.withShortcut(label, command),
				position: { hoverPosition: HoverPosition.BELOW }
			}),
			{ groupId: 'authenticated-frame' }
		);
	}

	private withShortcut(label: string, command: string | undefined): string {
		if (command === undefined) {
			return label;
		}
		const shortcut = this.keybindingService.lookupKeybinding(command)?.getLabel();
		return shortcut ? `${label} (${shortcut})` : label;
	}
}
