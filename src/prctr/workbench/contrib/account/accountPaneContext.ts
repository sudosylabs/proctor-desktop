/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { status } from '../../../base/browser/ui/aria/aria.js';
import type { MenuControl } from '../../../base/browser/ui/menu/menuControl.js';
import type { ToastHost } from '../../../base/browser/ui/toast/toastHost.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../platform/theme/browser/proctorIcon.js';
import type { WorkbenchOverlayHost } from '../../browser/overlayHost.js';

export const IAccountPaneContext = createDecorator<IAccountPaneContext>('accountPaneContext');

/** A failed result's detail and, when it can be repeated, how to try again. */
export interface AccountToastFailure {
	readonly body?: string;
	readonly retry?: () => void;
}

/**
 * What one Account pane gives the page it shows: its document and the window's
 * overlays, the pane's row menu and toasts, announcements, and focus.
 */
export interface IAccountPaneContext {
	readonly _serviceBrand: undefined;
	readonly document: Document;
	readonly overlays: WorkbenchOverlayHost;
	readonly menu: MenuControl;
	/** Moves focus to the page heading, as when a dialog closes without another target. */
	focusPage(): void;
	announce(text: string): void;
	/**
	 * Reports the result of something the person just did. A success leaves on its own; a
	 * failure stays until dismissed and can offer to try again.
	 */
	toast(title: string, failure?: AccountToastFailure): void;
}

export class AccountPaneContext implements IAccountPaneContext {
	declare readonly _serviceBrand: undefined;

	constructor(
		readonly document: Document,
		readonly overlays: WorkbenchOverlayHost,
		readonly menu: MenuControl,
		private readonly toasts: ToastHost,
		private readonly retryLabel: string,
		private readonly focus: () => void
	) {}

	focusPage(): void {
		this.focus();
	}

	announce(text: string): void {
		status(text);
	}

	toast(title: string, failure?: AccountToastFailure): void {
		if (failure === undefined) {
			this.toasts.show({
				tone: 'success',
				icon: proctorIconFactory('status.success', 18),
				title
			});
			return;
		}
		this.toasts.show({
			tone: 'failure',
			icon: proctorIconFactory('status.attention', 18),
			title,
			...(failure.body === undefined ? {} : { body: failure.body }),
			...(failure.retry === undefined
				? {}
				: {
						action: {
							label: this.retryLabel,
							icon: proctorIconFactory('action.retry', 14),
							run: failure.retry
						}
					})
		});
	}
}
