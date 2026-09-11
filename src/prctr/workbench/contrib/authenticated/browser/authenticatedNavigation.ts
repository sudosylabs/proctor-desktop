import type { Event } from '../../../../base/common/event.js';

export const AUTHENTICATED_NAVIGATION_SERVICE = 'prctr.authenticated.service.navigation';
export interface AuthenticatedNavigationService {
	readonly current: string;
	readonly accountHost?: HTMLElement;
	readonly accountSection?: 'profile' | 'sessions';
	readonly accountMenuNavigation?: boolean;
	setProfilePhoto?(dataUrl: string): void;
	readonly onDidChange: Event<string>;
	readonly onDidRequestSettings: Event<void>;
	readonly settingsRequested: boolean;
	select(destination: string): void;
}
