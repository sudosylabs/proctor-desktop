import { shell, net, powerMonitor } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DisposableStore } from '../../base/common/lifecycle.js';
import { DesktopIdentityCoordinator } from '../../platform/identity/electron-main/desktopIdentityCoordinator.js';
import { DesktopAuthorizationService } from '../../platform/identity/electron-main/desktopAuthorizationService.js';
import { HttpServerReadinessTransport } from '../../platform/identity/electron-main/httpServerReadinessTransport.js';
import { DesktopAuthHttp } from '../../platform/identity/node/desktopAuthHttp.js';
import { OsDesktopCredentialStore } from '../../platform/identity/electron-main/desktopCredentialStore.js';
import { loadNativeDesktopKeyCustody } from '../../platform/identity/electron-main/nativeDesktopKeyCustody.js';
import type { DesktopReleaseTarget } from '../../platform/identity/electron-main/serverReadiness.js';
import { ProductWindowCoordinator } from '../../platform/windows/common/windowCoordinator.js';
import {
	ElectronProductWindowFactory,
	type ElectronProductWindowFactoryOptions
} from '../../platform/windows/electron-main/electronProductWindowFactory.js';
import { createLocalization } from '../../base/common/localization.js';

import {
	callbackPageMessages,
	createDesktopAuthCallbackPages
} from '../../workbench/node/desktopAuthCallbackPage.js';

export interface DesktopIdentityCompositionOptions {
	readonly target: DesktopReleaseTarget;
	readonly window: Omit<
		ElectronProductWindowFactoryOptions,
		'launchIdentity' | 'account' | 'settings' | 'examActivity'
	>;
	readonly nativeKeyModule: string;
	readonly callbackBrandingDirectory: string;
	readonly stateDirectory: string;
	readonly allowDevelopmentLoopback: boolean;
	readonly locale: string;
	readonly onExit: () => void;
}
export function createDesktopIdentityComposition(options: DesktopIdentityCompositionOptions): {
	dispose(): void;
	shutdown(): Promise<void>;
} {
	if (options.window.production && options.allowDevelopmentLoopback)
		throw new Error('Development HTTP is unavailable in production');
	const owned = new DisposableStore();
	try {
		const localization = createLocalization({
			requestedLocale: options.locale,
			messages: Object.values(callbackPageMessages),
			catalogs: []
		});
		let windows: ProductWindowCoordinator;
		const http = new DesktopAuthHttp();
		const authorization = owned.add(
			new DesktopAuthorizationService({
				target: options.target,
				keys: loadNativeDesktopKeyCustody(options.nativeKeyModule),
				credentials: new OsDesktopCredentialStore(join(options.stateDirectory, 'identity')),
				http,
				openBrowser: async (url) => shell.openExternal(url),
				callbackPages: createDesktopAuthCallbackPages(
					localization,
					options.callbackBrandingDirectory
				),
				onAuthenticated: async (identity) => {
					windows.completeSignIn({
						kind: 'authenticated',
						windowId: randomUUID(),
						institutionOrigin: identity.institutionOrigin,
						principalId: identity.principalId,
						sessionId: identity.sessionId,
						initialDestination: identity.availableProductAreas.includes(
							'student_activity'
						)
							? 'activity'
							: identity.availableProductAreas.includes('exam_management')
								? 'management'
								: identity.availableProductAreas.includes('administration')
									? 'administration'
									: 'account',
						identity,
						...(identity.institutionOrigin.startsWith('http:')
							? { developmentOrigin: true }
							: {})
					});
				}
			})
		);
		const connectivity = () => authorization.setApiOnline(net.isOnline());
		const connectivityTimer = setInterval(connectivity, 5000);
		connectivityTimer.unref();
		powerMonitor.on('resume', connectivity);
		owned.add({
			dispose: () => {
				clearInterval(connectivityTimer);
				powerMonitor.removeListener('resume', connectivity);
			}
		});
		connectivity();
		const identity = owned.add(
			new DesktopIdentityCoordinator({
				target: options.target,
				transport: new HttpServerReadinessTransport(http.transport),
				allowDevelopmentLoopback: options.allowDevelopmentLoopback,
				authorization
			})
		);
		let shutdownPromise: Promise<void> | undefined;
		const shutdown = (): Promise<void> =>
			(shutdownPromise ??= authorization.shutdown().then(() => owned.dispose()));
		const exit = (): void => {
			void shutdown().then(options.onExit);
		};
		windows = new ProductWindowCoordinator(
			new ElectronProductWindowFactory({
				...options.window,
				launchIdentity: identity,
				account: authorization,
				examActivity: authorization,
				settings: authorization
			}),
			{
				accept: (_descriptor, intent) => {
					if (shutdownPromise) return;
					if (intent.kind === 'authenticated.signOut') {
						void authorization.signOut();
						return;
					}
					if (intent.kind === 'launch.exit' || intent.kind === 'authenticated.close') {
						exit();
						return;
					}
					throw new Error('Attempt entry requires the secure participation composition');
				}
			}
		);
		owned.add({ dispose: () => windows.shutdown() });
		owned.add(
			authorization.onDidEndSession((outcome) => {
				identity.acceptSessionOutcome(outcome);
				if (windows.current?.kind === 'authenticated') windows.returnToLaunch(randomUUID());
			})
		);
		owned.add(windows.onDidTerminate(exit));
		windows.openInitial({ kind: 'launch', windowId: randomUUID() });
		return { dispose: () => owned.dispose(), shutdown };
	} catch (error) {
		owned.dispose();
		throw error;
	}
}
