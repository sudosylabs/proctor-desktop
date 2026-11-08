/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** A decorative icon a control creates in its own document and disposes with itself. */
export interface ControlIcon {
	readonly element: HTMLElement;
	dispose(): void;
}

/**
 * Creates a control's icon. Controls in `base` take icons as factories so the window that
 * composes them chooses the icon set.
 */
export type ControlIconFactory = (document: Document) => ControlIcon;
