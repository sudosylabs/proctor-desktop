import type { IDisposable } from '../../src/prctr/base/common/lifecycle.ts';
import type { LocalizationContext } from '../../src/prctr/base/common/localization.ts';
import type { AccountClient } from '../../src/prctr/platform/account/common/accountProtocol.ts';
import { IClipboardService } from '../../src/prctr/platform/clipboard/common/clipboardService.ts';
import type { IInstantiationService } from '../../src/prctr/platform/instantiation/common/instantiation.ts';
import { InstantiationService } from '../../src/prctr/platform/instantiation/common/instantiationService.ts';
import { ServiceCollection } from '../../src/prctr/platform/instantiation/common/serviceCollection.ts';
import type { AuthenticatedWindowDescriptor } from '../../src/prctr/platform/windows/common/windowProtocol.ts';
import { IAuthenticatedHoverService } from '../../src/prctr/workbench/browser/authenticated/authenticatedHover.ts';
import { authenticatedComposition } from '../../src/prctr/workbench/browser/authenticatedManifest.ts';
import type { WorkbenchOverlayHost } from '../../src/prctr/workbench/browser/overlayHost.ts';
import {
	IWorkbenchOverlayService,
	IWorkbenchWindowService
} from '../../src/prctr/workbench/browser/workbenchServices.ts';
import {
	AccountFormatService,
	IAccountFormatService
} from '../../src/prctr/workbench/contrib/account/accountFormat.ts';
import {
	AccountService,
	IAccountService
} from '../../src/prctr/workbench/services/account/common/account.ts';
import { IAuthenticatedNavigationService } from '../../src/prctr/workbench/services/authenticatedNavigation/common/authenticatedNavigation.ts';
import { NativeClipboardService } from '../../src/prctr/workbench/services/clipboard/browser/nativeClipboardService.ts';
import {
	ILocalizationService,
	localizationService
} from '../../src/prctr/workbench/services/localization/common/localization.ts';
import {
	IUserSettingsService,
	UserSettingsService,
	type SettingsRendererClient
} from '../../src/prctr/workbench/services/settings/common/settingsRendererClient.ts';

export interface AccountTestServicesOptions {
	readonly document: Document;
	readonly overlays: WorkbenchOverlayHost;
	readonly account: AccountClient;
	readonly binding: AuthenticatedWindowDescriptor;
	readonly localization: LocalizationContext;
	readonly now: () => number;
	readonly settings?: SettingsRendererClient;
	readonly signOut?: () => void;
	readonly writeClipboard?: (text: string) => Promise<void>;
}

/** The services an Account pane and its pages take, over test doubles of the window's. */
export function createAccountTestServices(options: AccountTestServicesOptions): {
	readonly instantiationService: IInstantiationService;
	readonly dispose: () => void;
} {
	const localization = localizationService(options.localization);
	const windowService = Object.freeze({
		_serviceBrand: undefined,
		document: options.document,
		composition: authenticatedComposition,
		binding: options.binding
	});
	const account = new AccountService(options.account);
	const services = new ServiceCollection(
		[IWorkbenchWindowService, windowService],
		[IWorkbenchOverlayService, options.overlays],
		[ILocalizationService, localization],
		[IAccountService, account],
		[IAccountFormatService, new AccountFormatService(options.now, localization, windowService)],
		[IUserSettingsService, new UserSettingsService(options.settings ?? unavailableSettings)],
		[IClipboardService, new NativeClipboardService(clipboard(options.writeClipboard))],
		[IAuthenticatedHoverService, titleHover],
		[IAuthenticatedNavigationService, navigation(options.signOut ?? (() => undefined))]
	);
	const instantiationService = new InstantiationService(services, true);
	return {
		instantiationService,
		dispose: () => {
			instantiationService.dispose();
			account.dispose();
		}
	};
}

const unavailableSettings: SettingsRendererClient = Object.freeze({
	projection: () => new Promise<never>(() => {}),
	async preview() {},
	async cancelPreview() {},
	async commit() {
		return { kind: 'unavailable' as const };
	},
	onDidChange: () => () => {}
});

/** Shows hovers as native titles, so tests can read what a row would show. */
const titleHover: IAuthenticatedHoverService = Object.freeze({
	_serviceBrand: undefined,
	setupHover(target: HTMLElement, label: string): IDisposable {
		target.title = label;
		return { dispose: () => target.removeAttribute('title') };
	}
});

function clipboard(writeText: ((text: string) => Promise<void>) | undefined) {
	const refuse = async (): Promise<never> => {
		throw new Error('The clipboard is not part of this test');
	};
	return Object.freeze({
		readText: refuse,
		writeText: writeText ?? refuse,
		readFindText: refuse,
		writeFindText: refuse,
		readImage: refuse,
		readResources: refuse,
		writeResources: refuse,
		hasResources: refuse,
		paste: refuse
	});
}

/** Account only signs out through navigation; every other navigation call is unexpected. */
function navigation(signOut: () => void): IAuthenticatedNavigationService {
	const unexpected = (): never => {
		throw new Error('Account pages do not navigate in this test');
	};
	const none = () => ({ dispose() {} });
	return Object.freeze({
		_serviceBrand: undefined,
		current: 'account' as const,
		activityView: 'overview' as const,
		accountPage: 'profile' as const,
		onDidChange: none,
		onDidChangeActivityView: none,
		onDidChangeAccountPage: none,
		select: unexpected,
		selectActivityView: unexpected,
		selectAccountPage: unexpected,
		setProductAreas: unexpected,
		setProductStatus: unexpected,
		setAccountCount: unexpected,
		signOut
	});
}
