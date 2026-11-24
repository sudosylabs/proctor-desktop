import type { AccountClient } from '../../../src/prctr/platform/account/common/accountProtocol.ts';
import type { ExamActivityClient } from '../../../src/prctr/platform/examActivity/common/examActivityProtocol.ts';
import type { UserSettingsProjection } from '../../../src/prctr/platform/settings/common/settingsRendererProtocol.ts';
import { BoardAdministration, BOARD_NOW } from './boardData.ts';

/*
 * The real AuthenticatedWindow with the design boards' data instead of a server. The shot names
 * the area, the page and the theme, as `administration/users,dark`; once the page has its data
 * it marks the document ready for its capture.
 */
const [place = 'administration/users', theme = 'light'] = (
	new URLSearchParams(location.search).get('shot') ?? ''
).split(',');
const [area = 'administration', page = 'users'] = place.split('/');

// The boards are drawn at one moment, so every date and relative time matches them.
const realNow = Date.now;
const offset = BOARD_NOW - realNow();
Date.now = () => realNow() + offset;

const unavailable = { kind: 'error' as const, reason: 'unavailable' as const };
const account: AccountClient = { request: async () => unavailable };
const examActivity: ExamActivityClient = { request: async () => unavailable as never };
const projection: UserSettingsProjection = {
	source: '{}',
	revision: 'revision:preview',
	availability: 'available',
	writable: true,
	presentation: {
		windowTheme: theme === 'dark' ? 'dark' : 'light',
		highContrast: false,
		zoomPercent: 100,
		reducedMotion: true
	}
};
const refuse = async (): Promise<never> => {
	throw new Error('Not part of the preview');
};

(globalThis as unknown as { proctorAuthenticated: unknown }).proctorAuthenticated = {
	async bootstrap() {
		return {
			kind: 'authenticated',
			windowId: 'window:preview',
			institutionOrigin: 'https://northbridge.example',
			principalId: 'p'.repeat(26),
			sessionId: 's'.repeat(26),
			initialDestination: area,
			identity: {
				principalId: 'p'.repeat(26),
				sessionId: 's'.repeat(26),
				institutionOrigin: 'https://northbridge.example',
				institutionName: 'Northbridge University',
				displayName: 'Amara Okafor',
				availableProductAreas: ['account', 'settings', 'exam_management', 'administration'],
				noCurrentAffiliation: false,
				noAssignedAccess: false
			}
		};
	},
	signOut: refuse,
	close: refuse,
	windowChrome: {
		async configuration() {
			return {
				platform: 'darwin',
				mode: 'nativeTrafficLights',
				controlsLocation: 'left',
				titlebarHeight: 28,
				fullscreen: false,
				material: 'none'
			};
		},
		onDidChangeMaterial: () => ({ dispose() {} }),
		onDidChangeFullscreen: () => ({ dispose() {} }),
		zoomFactor: () => 1,
		async update() {}
	},
	settings: {
		projection: async () => projection,
		async preview() {},
		async cancelPreview() {},
		async commit() {
			return { kind: 'unavailable' as const };
		},
		onDidChange: () => () => undefined
	},
	settingsNative: {
		clipboard: {
			readText: refuse,
			writeText: refuse,
			readFindText: refuse,
			writeFindText: refuse,
			readImage: refuse,
			readResources: refuse,
			writeResources: refuse,
			hasResources: refuse,
			paste: refuse
		}
	},
	account,
	administration: new BoardAdministration(),
	examActivity
};

await import('../../../src/prctr/code/electron-browser/authenticated.main.ts');

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** The control whose own label reads `text`, ignoring a count drawn beside it. */
const byText = (selector: string, text: string): HTMLElement | undefined => {
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
		if (node.textContent?.trim() === text) {
			const control = node.parentElement?.closest<HTMLElement>(selector);
			if (control !== null && control !== undefined) return control;
		}
	return undefined;
};
const AREA_LABELS: Readonly<Record<string, string>> = {
	administration: 'Admin',
	account: 'Account',
	activity: 'Activity',
	exams: 'Exams'
};
const PAGE_LABELS: Readonly<Record<string, string>> = {
	overview: 'Overview',
	users: 'Users',
	invitations: 'Invitations',
	imports: 'Imports',
	structure: 'Structure',
	periods: 'Academic periods',
	progression: 'Progression',
	roles: 'Roles',
	policy: 'Access policy',
	audits: 'Audits',
	retention: 'Data retention',
	jobs: 'Jobs',
	mail: 'Mail',
	profile: 'Profile',
	security: 'Sign-in and security',
	sessions: 'Sessions and devices',
	tokens: 'Access tokens',
	history: 'Account history',
	settings: 'Settings'
};
await settle(400);
byText('button, a', AREA_LABELS[area] ?? area)?.click();
await settle(300);
byText('button, a, [role="treeitem"]', PAGE_LABELS[page] ?? page)?.click();
await settle(1200);
(document.activeElement as HTMLElement | null)?.blur();
document.documentElement.dataset.previewReady = 'true';
