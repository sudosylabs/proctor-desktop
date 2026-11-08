/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { AccountClient } from '../../platform/account/common/accountProtocol.js';
import { IClipboardService } from '../../platform/clipboard/common/clipboardService.js';
import type { ExamActivityClient } from '../../platform/examActivity/common/examActivityProtocol.js';
import { SyncDescriptor } from '../../platform/instantiation/common/descriptors.js';
import type { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import type { SettingsClipboardClient } from '../../platform/settings/common/settingsNativeHost.js';
import type { WorkbenchServicesInitializer } from '../../workbench/browser/bootstrap.js';
import {
	AccountFormatService,
	IAccountFormatService
} from '../../workbench/contrib/account/browser/accountFormat.js';
import { AuthenticatedFrame } from '../../workbench/browser/authenticated/authenticatedFrame.js';
import { IAuthenticatedNavigationService } from '../../workbench/services/authenticatedNavigation/common/authenticatedNavigation.js';
import { installAuthenticatedWindowServices } from '../../workbench/browser/authenticated/authenticatedWindowServices.js';
import {
	AccountService,
	IAccountService
} from '../../workbench/services/account/common/account.js';
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
	readonly settings: SettingsRendererClient;
	readonly clipboard: SettingsClipboardClient;
	/** Present when the window was given the product pages. */
	readonly examActivity?: ExamActivityClient;
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
		services.set(IAccountService, new SyncDescriptor(AccountService, [preload.account]));
		services.set(IAccountFormatService, new SyncDescriptor(AccountFormatService, [Date.now]));
		if (preload.examActivity !== undefined) {
			services.set(IExamActivityService, new ExamActivityService(preload.examActivity));
		}
		services.set(IUserSettingsService, new UserSettingsService(preload.settings));
		services.set(IClipboardService, new NativeClipboardService(preload.clipboard));
		services.set(IAuthenticatedNavigationService, new SyncDescriptor(AuthenticatedFrame));
	};
	return [registerPreloadServices, installAuthenticatedWindowServices];
}
