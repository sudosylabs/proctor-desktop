import type { PresentationCategory } from '../../../common/restoration.js';

/** Device-local layout only; never an account setting or an authorization input. */
export const authenticatedLayoutCategory: PresentationCategory = Object.freeze({
	id: 'prctr.authenticated.layout',
	scope: 'device',
	sensitivity: 'nonSensitive',
	cleanupOwner: 'prctr.authenticated.navigation'
});
const SIDEBAR_KEY = 'prctr.authenticated.layout.sidebarVisible';
export class AuthenticatedLayoutState {
	constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {}
	get sidebarVisible(): boolean {
		try {
			return this.storage?.getItem(SIDEBAR_KEY) !== 'false';
		} catch {
			return true;
		}
	}
	get primarySide(): 'left' | 'right' {
		try {
			return this.storage?.getItem('prctr.authenticated.layout.primarySide') === 'right'
				? 'right'
				: 'left';
		} catch {
			return 'left';
		}
	}
	set primarySide(side: 'left' | 'right') {
		try {
			this.storage?.setItem('prctr.authenticated.layout.primarySide', side);
		} catch {
			/* Session-only fallback. */
		}
	}
	set sidebarVisible(visible: boolean) {
		try {
			this.storage?.setItem(SIDEBAR_KEY, String(visible));
		} catch {
			/* The live shell retains its state when storage is unavailable. */
		}
	}
}
