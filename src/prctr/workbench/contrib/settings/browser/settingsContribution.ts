/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { defineMessage } from '../../../../base/common/localization.js';
import type { INotificationService } from '../../../../platform/notification/common/notification.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { parseSettingsDocument } from '../../../../platform/settings/common/settingsDocument.js';
import { settingsRegistry } from '../../../../platform/settings/common/settingsRegistry.js';
import type { UserSettingsProjection } from '../../../../platform/settings/common/settingsRendererProtocol.js';
import {
	BROWSER_THEME_SERVICE,
	type BrowserThemeService
} from '../../../../platform/theme/browser/themeService.js';
import { PROCTOR_SCHEME_THEME_NAMES } from '../../../../platform/theme/common/bundledThemes.js';
import type { WorkbenchContributionRegistration } from '../../../browser/bootstrap.js';
import { WORKBENCH_NOTIFICATION_SERVICE } from '../../../browser/parts/notifications/notifications.js';
import { WorkbenchModalContext } from '../../../common/contextKeys.js';
import { registerProctorAction } from '../../../services/actions/common/proctorActions.js';
import type { SettingsRendererClient } from '../../../services/settings/common/settingsRendererClient.js';
import {
	AUTHENTICATED_NAVIGATION_SERVICE,
	type AuthenticatedNavigationService
} from '../../authenticated/browser/authenticatedNavigation.js';
export type { SettingsRendererClient } from '../../../services/settings/common/settingsRendererClient.js';

export const OPEN_SETTINGS_COMMAND_ID = 'prctr.authenticated.openSettings';

const messages = Object.freeze({
	openSettings: defineMessage({
		id: 'settings.command.open',
		defaultMessage: 'Open Settings',
		description: 'Command that opens the Settings page of Account.'
	}),
	loadFailed: defineMessage({
		id: 'settings.presentation.unavailable',
		defaultMessage: 'Settings are unavailable. Open Settings to try again.',
		description: 'Notification when the window cannot read the settings it is presented with.'
	})
});

/**
 * AuthenticatedWindow's settings presentation and the way to Settings: the window follows the
 * account's theme, motion, zoom and color settings, and Ctrl/Cmd+, opens Account › Settings.
 */
export function createSettingsContribution(
	client: SettingsRendererClient
): WorkbenchContributionRegistration {
	return {
		id: 'prctr.authenticated.settings',
		phase: 'ready',
		dependencies: ['prctr.authenticated.navigation'],
		messages: Object.values(messages),
		activate(context) {
			const store = context.disposables.add(new DisposableStore());
			const navigation = context.getService<AuthenticatedNavigationService>(
				AUTHENTICATED_NAVIGATION_SERVICE
			);
			const presentation = context.getService<BrowserThemeService>(BROWSER_THEME_SERVICE);
			const notifications = context.getService<INotificationService>(
				WORKBENCH_NOTIFICATION_SERVICE
			);
			const view = context.document.defaultView;
			store.add(
				registerProctorAction({
					command: {
						id: OPEN_SETTINGS_COMMAND_ID,
						title: messages.openSettings,
						precondition: WorkbenchModalContext.toNegated()
					},
					handler: () => navigation.selectAccountPage('settings'),
					keybindings: [
						{
							primary: KeyMod.CtrlCmd | KeyCode.Comma,
							weight: KeybindingWeight.WorkbenchContrib
						}
					],
					commandPalette: true
				})
			);
			let received = false;
			const apply = (next: UserSettingsProjection): void => {
				if (store.isDisposed) return;
				received = true;
				applySettingsPresentation(presentation, next, view);
			};
			store.add(toDisposable(client.onDidChange(apply)));
			void client.projection().then(
				// A change that arrived during the read is newer than the snapshot.
				(snapshot) => {
					if (!received) apply(snapshot);
				},
				() => {
					if (!store.isDisposed)
						notifications.error(context.localization.format(messages.loadFailed));
				}
			);
		}
	};
}

/** Applies a projection's window theme, colors, token customizations, motion and zoom. */
export function applySettingsPresentation(
	presentation: BrowserThemeService,
	next: UserSettingsProjection,
	view: Pick<Window, 'matchMedia'> | null
): void {
	const parsed = parseSettingsDocument(next.source);
	const tokens = settingsRegistry.normalize(
		'editor.tokenColorCustomizations',
		parsed.values.get('editor.tokenColorCustomizations') ?? {}
	);
	const semantic = settingsRegistry.normalize(
		'editor.semanticTokenColorCustomizations',
		parsed.values.get('editor.semanticTokenColorCustomizations') ?? {}
	);
	// A chosen window theme pins Proctor Light or Dark; otherwise the window follows the system.
	const chosen = windowThemeName(next.presentation, view);
	if (chosen !== undefined)
		presentation.setTheme(chosen, next.presentation.colorCustomizations, tokens, semantic);
	else presentation.followSystemTheme(next.presentation.colorCustomizations, tokens, semantic);
	presentation.setMotionPreference(next.presentation.reducedMotion ? 'reduced' : 'full');
	presentation.setZoomPercent(next.presentation.zoomPercent);
}

/**
 * The theme a window-theme choice pins, or undefined to follow the system. High contrast uses
 * the high-contrast theme of the scheme shown, which for System is the system's own scheme.
 */
export function windowThemeName(
	presentation: Pick<UserSettingsProjection['presentation'], 'windowTheme' | 'highContrast'>,
	view: Pick<Window, 'matchMedia'> | null
): string | undefined {
	if (!presentation.highContrast)
		return presentation.windowTheme === 'system'
			? undefined
			: PROCTOR_SCHEME_THEME_NAMES[presentation.windowTheme];
	const dark =
		presentation.windowTheme === 'dark' ||
		(presentation.windowTheme === 'system' &&
			view?.matchMedia('(prefers-color-scheme: dark)').matches === true);
	return dark ? 'GitHub Dark High Contrast' : 'GitHub Light High Contrast';
}
