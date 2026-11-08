/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { PresentationCategory } from '../../common/restoration.js';

/** Device-local layout only; never an account setting or an authorization input. */
export const authenticatedLayoutCategory: PresentationCategory = Object.freeze({
	id: 'prctr.authenticated.layout',
	scope: 'device',
	sensitivity: 'nonSensitive',
	cleanupOwner: 'prctr.authenticated.navigation'
});

export const SIDEBAR_DEFAULT_WIDTH = 232;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 320;

const VISIBLE_KEY = 'prctr.authenticated.layout.sidebarVisible';
const WIDTH_KEY = 'prctr.authenticated.layout.sidebarWidth';

export function clampSidebarWidth(width: number): number {
	if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
	return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

/**
 * The sidebar's remembered visibility and width on this device. Unreadable or
 * unwritable storage keeps the defaults for this window only.
 */
export class AuthenticatedLayoutState {
	constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {}

	get sidebarVisible(): boolean {
		return this.read(VISIBLE_KEY) !== 'false';
	}

	set sidebarVisible(visible: boolean) {
		this.write(VISIBLE_KEY, String(visible));
	}

	get sidebarWidth(): number {
		const stored = this.read(WIDTH_KEY);
		return stored === null ? SIDEBAR_DEFAULT_WIDTH : clampSidebarWidth(Number(stored));
	}

	set sidebarWidth(width: number) {
		this.write(WIDTH_KEY, String(clampSidebarWidth(width)));
	}

	private read(key: string): string | null {
		try {
			return this.storage?.getItem(key) ?? null;
		} catch {
			return null;
		}
	}

	private write(key: string, value: string): void {
		try {
			this.storage?.setItem(key, value);
		} catch {
			/* The live frame keeps its state when storage is unavailable. */
		}
	}
}
