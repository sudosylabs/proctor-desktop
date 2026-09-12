import type { ProductArea } from '../../../../platform/examActivity/common/examActivityProtocol.js';
import type { Event } from '../../../../base/common/event.js';

export const AUTHENTICATED_NAVIGATION_SERVICE = 'prctr.authenticated.service.navigation';
export const activityViews = [
	'overview',
	'upcoming',
	'available',
	'in_progress',
	'submitted',
	'results_available',
	'past'
] as const;
export type ActivityView = (typeof activityViews)[number];
export interface AuthenticatedNavigationService {
	readonly activityView?: ActivityView;
	readonly onDidChangeActivityView?: Event<ActivityView>;
	selectActivityView?(view: ActivityView): void;
	readonly current: string;
	readonly productPages?: boolean;
	setProductAreas?(areas: readonly ProductArea[]): void;
	setProductStatus?(message: string, retry?: () => void): void;
	readonly accountHost?: HTMLElement;
	readonly accountSection?: 'profile' | 'sessions';
	readonly accountMenuNavigation?: boolean;
	setProfilePhoto?(dataUrl: string): void;
	readonly onDidChange: Event<string>;
	readonly onDidRequestSettings: Event<void>;
	readonly settingsRequested: boolean;
	select(destination: string): void;
}
