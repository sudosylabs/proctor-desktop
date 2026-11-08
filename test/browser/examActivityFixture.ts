import { IBrowserThemeService } from '../../src/prctr/platform/theme/browser/themeService.js';
import { bootstrapWorkbench } from '../../src/prctr/workbench/browser/bootstrap.js';
import { authenticatedComposition } from '../../src/prctr/workbench/browser/authenticatedManifest.js';
import { commonWorkbenchContributions } from '../../src/prctr/workbench/workbench.common.main.js';
import { createDesktopWorkbenchContribution } from '../../src/prctr/code/electron-browser/workbench.desktop.main.js';
import { authenticatedFrameContribution } from '../../src/prctr/workbench/browser/authenticated/authenticated.contribution.js';
import { examActivityContribution } from '../../src/prctr/workbench/contrib/examActivity/examActivity.contribution.js';
import { accountContribution } from '../../src/prctr/workbench/contrib/account/account.contribution.js';
import { IAuthenticatedNavigationService } from '../../src/prctr/workbench/services/authenticatedNavigation/common/authenticatedNavigation.js';
import { authenticatedWindowServices } from '../../src/prctr/code/electron-browser/authenticatedServices.js';
import type { SettingsRendererClient } from '../../src/prctr/workbench/services/settings/common/settingsRendererClient.js';
import {
	inertContribution,
	unavailableAccount,
	unusedClipboard
} from './authenticatedTestServices.js';
import type {
	ExamActivity,
	ExamActivityClient,
	ProductArea
} from '../../src/prctr/platform/examActivity/common/examActivityProtocol.js';
import { isMacintosh } from '../../src/prctr/base/common/platform.js';

export const sampleExams: readonly ExamActivity[] = [
	{
		sittingId: 'y'.repeat(26),
		title: 'Algorithms and data structures',
		academicUnit: 'School of Computing',
		className: 'Computer Science · Year 2',
		startsAt: '2026-09-21T08:00:00Z',
		endsAt: '2026-09-21T10:00:00Z',
		activity: 'available',
		access: 'joinable',
		actions: ['enter'],
		attemptId: null,
		submittedAt: null
	},
	{
		sittingId: 'b'.repeat(26),
		title: 'Database systems',
		academicUnit: 'School of Computing',
		className: 'Computer Science · Year 2',
		startsAt: '2026-09-24T12:00:00Z',
		endsAt: '2026-09-24T14:00:00Z',
		activity: 'upcoming',
		access: 'not_open',
		actions: [],
		attemptId: null,
		submittedAt: null
	},
	{
		sittingId: 'n'.repeat(26),
		title: 'Introduction to programming',
		academicUnit: 'School of Computing',
		className: 'Computer Science · Year 1',
		startsAt: '2026-09-02T08:00:00Z',
		endsAt: '2026-09-02T10:00:00Z',
		activity: 'results_available',
		access: 'result_available',
		actions: ['view_result'],
		attemptId: 'r'.repeat(26),
		submittedAt: '2026-09-02T09:46:00Z'
	}
];
export async function mountExamActivityFixture(
	document: Document,
	client: ExamActivityClient,
	areas: readonly ProductArea[] = [
		'account',
		'settings',
		'student_activity',
		'exam_management',
		'administration'
	]
) {
	const settings: SettingsRendererClient = {
		projection: () => new Promise(() => {}),
		async preview() {},
		async cancelPreview() {},
		async commit() {
			return { kind: 'unavailable' as const };
		},
		onDidChange: () => () => {}
	};
	const result = await bootstrapWorkbench(
		document,
		authenticatedComposition,
		[
			...commonWorkbenchContributions,
			createDesktopWorkbenchContribution('authenticated', async () => ({
				kind: 'authenticated',
				windowId: 'window:exam-activity-fixture',
				institutionOrigin: 'https://institution.example.test',
				principalId: 'y'.repeat(26),
				sessionId: 'b'.repeat(26),
				initialDestination: 'activity',
				identity: {
					principalId: 'y'.repeat(26),
					sessionId: 'b'.repeat(26),
					institutionOrigin: 'https://institution.example.test',
					institutionName: 'Northbridge University',
					displayName: 'Alex Lawson',
					availableProductAreas: areas,
					noCurrentAffiliation: false,
					noAssignedAccess: false
				}
			})),
			authenticatedFrameContribution,
			examActivityContribution,
			accountContribution,
			inertContribution('prctr.authenticated.administration', [
				'prctr.authenticated.navigation'
			]),
			inertContribution('prctr.authenticated.settings', ['prctr.authenticated.navigation'])
		],
		{
			windowChrome: {
				async configuration() {
					return {
						platform: isMacintosh ? 'darwin' : 'linux',
						mode: isMacintosh ? 'nativeTrafficLights' : 'nativeOverlay',
						controlsLocation: isMacintosh ? 'left' : 'right',
						titlebarHeight: 35,
						fullscreen: false,
						material: 'none' as const
					};
				},
				onDidChangeMaterial: () => ({ dispose() {} }),
				onDidChangeFullscreen() {
					return { dispose() {} };
				},
				zoomFactor() {
					return 1;
				},
				async update() {}
			},
			services: authenticatedWindowServices({
				async signOut() {},
				account: unavailableAccount,
				settings,
				clipboard: unusedClipboard,
				examActivity: client
			})
		}
	);
	const [navigation, theme] = result.instantiationService.invokeFunction(
		(accessor) =>
			[
				accessor.get(IAuthenticatedNavigationService),
				accessor.get(IBrowserThemeService)
			] as const
	);
	return { ...result, navigation, theme };
}
