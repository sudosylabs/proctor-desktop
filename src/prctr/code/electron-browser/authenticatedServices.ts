/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { setUnexpectedErrorHandler } from '../../base/common/errors.js';
import {
	ForwardingLogService,
	type LogForwarder
} from '../../platform/log/browser/forwardingLogService.js';
import { ILogService } from '../../platform/log/common/log.js';
import {
	IProctorTelemetryService,
	LogOnlyTelemetryService
} from '../../platform/telemetry/browser/proctorTelemetry.js';
import {
	AdministrationListsService,
	IAdministrationListsService
} from '../../workbench/services/administration/common/administrationLists.js';
import type { AccountClient } from '../../platform/account/common/accountProtocol.js';
import type { AdministrationClient } from '../../platform/administration/common/administrationProtocol.js';
import { IClipboardService } from '../../platform/clipboard/common/clipboardService.js';
import type { ExamActivityClient } from '../../platform/examActivity/common/examActivityProtocol.js';
import { SyncDescriptor } from '../../platform/instantiation/common/descriptors.js';
import type { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import type { SettingsClipboardClient } from '../../platform/settings/common/settingsNativeHost.js';
import type { WorkbenchServicesInitializer } from '../../workbench/browser/bootstrap.js';
import {
	AccountFormatService,
	IAccountFormatService
} from '../../workbench/contrib/account/accountFormat.js';
import {
	AdministrationFormatService,
	IAdministrationFormatService
} from '../../workbench/contrib/administration/administrationFormat.js';
import { AuthenticatedFrame } from '../../workbench/browser/authenticated/authenticatedFrame.js';
import {
	IPageFormatService,
	PageFormatService
} from '../../workbench/browser/authenticated/pages/pageFormat.js';
import { IAuthenticatedNavigationService } from '../../workbench/services/authenticatedNavigation/common/authenticatedNavigation.js';
import { installAuthenticatedWindowServices } from '../../workbench/browser/authenticated/authenticatedWindowServices.js';
import {
	AccountService,
	IAccountService
} from '../../workbench/services/account/common/account.js';
import {
	AdministrationService,
	IAdministrationService
} from '../../workbench/services/administration/common/administration.js';
import {
	IServerDataService,
	ServerDataService
} from '../../workbench/services/serverData/common/serverData.js';
import {
	AuthenticatedHostService,
	IAuthenticatedHostService
} from '../../workbench/services/authenticatedHost/common/authenticatedHost.js';
import { NativeClipboardService } from '../../workbench/services/clipboard/browser/nativeClipboardService.js';
import {
	ExamActivityService,
	IExamActivityService
} from '../../workbench/services/examActivity/common/examActivity.js';
import {
	IUserSettingsService,
	UserSettingsService,
	type SettingsRendererClient
} from '../../workbench/services/settings/common/settingsRendererClient.js';

/** The AuthenticatedWindow preload's capabilities. */
export interface AuthenticatedPreloadCapabilities {
	signOut(): Promise<void>;
	readonly account: AccountClient;
	readonly administration: AdministrationClient;
	readonly settings: SettingsRendererClient;
	readonly clipboard: SettingsClipboardClient;
	/** Present when the window was given the product pages. */
	readonly examActivity?: ExamActivityClient;
	/** Sends one log entry to main's log. */
	readonly log: LogForwarder;
}

/**
 * AuthenticatedWindow's services: each preload capability as the service that presents
 * it, the frame as the window's navigation, and the shared source controls.
 */
export function authenticatedWindowServices(
	preload: AuthenticatedPreloadCapabilities
): readonly WorkbenchServicesInitializer[] {
	const registerPreloadServices = (services: ServiceCollection): void => {
		services.set(
			IAuthenticatedHostService,
			new AuthenticatedHostService(preload, preload.examActivity !== undefined)
		);
		const log = new ForwardingLogService(preload.log);
		services.set(ILogService, log);
		services.set(IProctorTelemetryService, new SyncDescriptor(LogOnlyTelemetryService));
		// An error nobody caught reaches the log, by its name and message only.
		setUnexpectedErrorHandler((error) =>
			log.error(error instanceof Error ? error : 'Unexpected error')
		);
		services.set(IAccountService, new SyncDescriptor(AccountService, [preload.account]));
		services.set(
			IAdministrationService,
			new SyncDescriptor(AdministrationService, [preload.administration])
		);
		services.set(
			IServerDataService,
			new SyncDescriptor(ServerDataService, [
				{ administration: preload.administration, account: preload.account }
			])
		);
		services.set(IPageFormatService, new SyncDescriptor(PageFormatService, [Date.now]));
		services.set(IAccountFormatService, new SyncDescriptor(AccountFormatService));
		services.set(IAdministrationFormatService, new SyncDescriptor(AdministrationFormatService));
		if (preload.examActivity !== undefined) {
			services.set(IExamActivityService, new ExamActivityService(preload.examActivity));
		}
		services.set(IUserSettingsService, new UserSettingsService(preload.settings));
		services.set(IAdministrationListsService, new SyncDescriptor(AdministrationListsService));
		services.set(IClipboardService, new NativeClipboardService(preload.clipboard));
		services.set(IAuthenticatedNavigationService, new SyncDescriptor(AuthenticatedFrame));
	};
	return [registerPreloadServices, installAuthenticatedWindowServices];
}
