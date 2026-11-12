/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { status } from '../../../../base/browser/ui/aria/aria.js';
import type { StatusBadgeTone } from '../../../../base/browser/ui/badge/statusBadge.js';
import type { MenuControl } from '../../../../base/browser/ui/menu/menuControl.js';
import type { ToastHost } from '../../../../base/browser/ui/toast/toastHost.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { WorkbenchOverlayHost } from '../../overlayHost.js';

export const IPagePaneContext = createDecorator<IPagePaneContext>('pagePaneContext');

/** A page's heading: its title and description, and for a record its trail and status. */
export interface PageHeading {
	readonly title: string;
	readonly description: string;
	/** The pages above this one, each opening its own list, as in Users › Daniel Mensah. */
	readonly trail?: readonly { readonly label: string; open(): void }[];
	/** A status word beside the title, coloured only when it needs attention. */
	readonly status?: { readonly text: string; readonly tone: StatusBadgeTone };
	/** Initials shown before the title, as for a person, until `photo` arrives. */
	readonly initials?: string;
	/** The person's picture as a data URL, shown in place of the initials. */
	readonly photo?: string;
}

/** A failed result's detail and, when it can be repeated, how to try again. */
export interface PageToastFailure {
	readonly body?: string;
	readonly retry?: () => void;
}

/**
 * What one area's pane gives the page it shows: its document and the window's overlays,
 * the pane's row menu and toasts, announcements, focus, and how its failures read.
 */
export interface IPagePaneContext {
	readonly _serviceBrand: undefined;
	readonly document: Document;
	readonly overlays: WorkbenchOverlayHost;
	readonly menu: MenuControl;
	/** The accessible name of a dialog's × button. */
	readonly closeLabel: string;
	/** Moves focus to the page heading, as when a dialog closes without another target. */
	focusPage(): void;
	announce(text: string): void;
	/** The sentence for one of the area's failure reasons, as shown in a section or dialog. */
	describeFailure(reason: string): string;
	/** Renames the page, as a record's page does once it knows the record. */
	setHeading(heading: PageHeading): void;
	/**
	 * Reports the result of something the person just did. A success leaves on its own; a
	 * failure stays until dismissed and can offer to try again.
	 */
	toast(title: string, failure?: PageToastFailure): void;
	/** A change that can be taken back: the toast offers Undo and stays until dismissed. */
	toastUndo(title: string, undo: () => void): void;
}

export class PagePaneContext implements IPagePaneContext {
	declare readonly _serviceBrand: undefined;

	constructor(
		readonly document: Document,
		readonly overlays: WorkbenchOverlayHost,
		readonly menu: MenuControl,
		private readonly toasts: ToastHost,
		private readonly retryLabel: string,
		private readonly undoLabel: string,
		readonly closeLabel: string,
		private readonly focus: () => void,
		private readonly failureText: (reason: string) => string,
		private readonly heading: (heading: PageHeading) => void
	) {}

	focusPage(): void {
		this.focus();
	}

	announce(text: string): void {
		status(text);
	}

	describeFailure(reason: string): string {
		return this.failureText(reason);
	}

	setHeading(heading: PageHeading): void {
		this.heading(heading);
	}

	toastUndo(title: string, undo: () => void): void {
		this.toasts.show({
			tone: 'success',
			icon: proctorIconFactory('status.success', 18),
			title,
			persistent: true,
			action: {
				label: this.undoLabel,
				icon: proctorIconFactory('action.reset', 14),
				run: undo
			}
		});
	}

	toast(title: string, failure?: PageToastFailure): void {
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
