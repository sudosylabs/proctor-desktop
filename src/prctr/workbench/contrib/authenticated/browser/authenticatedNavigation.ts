import type { Event } from '../../../../base/common/event.js';

export const AUTHENTICATED_NAVIGATION_SERVICE = 'prctr.authenticated.service.navigation';
export interface AuthenticatedNavigationService {
	readonly current: string;
	readonly onDidChange: Event<string>;
	select(destination: string): void;
}
