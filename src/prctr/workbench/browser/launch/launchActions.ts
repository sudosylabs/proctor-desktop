/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../base/browser/ui/button/buttonControl.js';
import { Emitter } from '../../../base/common/event.js';
import type { LocalizationContext } from '../../../base/common/localization.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import {
	formatLaunchText,
	type LaunchAction,
	type LaunchActionKind
} from './launchPresentation.js';
import './launchActions.css';

/** The footer: at most one secondary action and the one primary action for the state. */
export class LaunchActions extends Disposable {
	readonly element: HTMLElement;

	private readonly requestEmitter = this._register(new Emitter<LaunchActionKind>());
	readonly onDidRequest = this.requestEmitter.event;

	private readonly secondary: ButtonControl;
	private readonly primary: ButtonControl;
	private secondaryKind: LaunchActionKind | undefined;
	private primaryKind: LaunchActionKind | undefined;

	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.element = $('footer.prctr-launch-actions');
		host.append(this.element);

		this.secondary = this._register(
			new ButtonControl(this.element, { variant: 'secondary', size: 'large', label: '' })
		);
		this.primary = this._register(
			new ButtonControl(this.element, { variant: 'brand', size: 'large', label: '' })
		);
		this.secondary.element.classList.add('prctr-launch-actions__secondary');
		this.primary.element.classList.add('prctr-launch-actions__primary');

		this._register(
			this.secondary.onDidRequest(() => {
				this.request(this.secondaryKind);
			})
		);
		this._register(
			this.primary.onDidRequest(() => {
				this.request(this.primaryKind);
			})
		);
	}

	render(
		secondary: LaunchAction | undefined,
		primary: LaunchAction | undefined,
		busy: boolean
	): void {
		this.secondaryKind = secondary?.kind;
		this.primaryKind = primary?.kind;
		this.renderButton(this.secondary, secondary, false);
		// The primary action waits while an intent is being delivered; Cancel never does.
		this.renderButton(this.primary, primary, busy);
		this.element.hidden = secondary === undefined && primary === undefined;
	}

	/** Moves focus to the first enabled action; returns false when there is none. */
	focusFirstAvailable(): boolean {
		for (const button of [this.primary, this.secondary]) {
			if (!button.element.hidden && !button.element.disabled) {
				button.focus();
				return true;
			}
		}
		return false;
	}

	contains(element: Element | null): boolean {
		return element !== null && this.element.contains(element);
	}

	private renderButton(
		button: ButtonControl,
		action: LaunchAction | undefined,
		busy: boolean
	): void {
		button.element.hidden = action === undefined;
		if (action === undefined) {
			return;
		}
		button.setState({
			label: formatLaunchText(this.localization, action.label),
			...(action.accessibleLabel === undefined
				? {}
				: { accessibleLabel: formatLaunchText(this.localization, action.accessibleLabel) }),
			disabled: !action.enabled,
			busy: busy && action.enabled
		});
	}

	private request(kind: LaunchActionKind | undefined): void {
		if (kind !== undefined) {
			this.requestEmitter.fire(kind);
		}
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
