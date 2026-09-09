import type { PresentationCategory } from '../../../common/restoration.js';

/** Device-local layout only; never an account setting or an authorization input. */
export const authenticatedLayoutCategory: PresentationCategory = Object.freeze({
	id: 'prctr.authenticated.layout',
	scope: 'device',
	schemaVersion: 1,
	sensitivity: 'nonSensitive',
	cleanupOwner: 'prctr.authenticated.navigation'
});
const SIDEBAR_KEY = 'prctr.authenticated.layout.v1.sidebarVisible';
export class AuthenticatedLayoutState {
	constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {}
	get sidebarVisible(): boolean {
		try {
			return this.storage?.getItem(SIDEBAR_KEY) !== 'false';
		} catch {
			return true;
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
