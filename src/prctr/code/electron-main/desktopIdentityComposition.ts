import { nativeTheme, shell } from 'electron';
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
import { createLocalization, defineMessage } from '../../base/common/localization.js';

const callback = defineMessage({
	id: 'identity.callback.return',
	defaultMessage: 'Return to Proctor to finish signing in. You can close this tab.',
	description: 'Plain-text loopback response; never echoes authorization parameters.'
});
export interface DesktopIdentityCompositionOptions {
	readonly target: DesktopReleaseTarget;
	readonly window: Omit<ElectronProductWindowFactoryOptions, 'launchIdentity'>;
	readonly nativeKeyModule: string;
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
	nativeTheme.themeSource = 'dark';
	const owned = new DisposableStore();
	try {
		const localization = createLocalization({
			requestedLocale: options.locale,
			messages: [callback],
			catalogs: []
		});
		let windows: ProductWindowCoordinator;
		const authorization = owned.add(
			new DesktopAuthorizationService({
				target: options.target,
				keys: loadNativeDesktopKeyCustody(options.nativeKeyModule),
				credentials: new OsDesktopCredentialStore(join(options.stateDirectory, 'identity')),
				http: new DesktopAuthHttp(),
				openBrowser: async (url) => shell.openExternal(url),
				callbackMessage: localization.format(callback),
				onAuthenticated: async (identity) => {
					windows.completeSignIn({
						protocolVersion: 1,
						kind: 'authenticated',
						windowId: randomUUID(),
						institutionOrigin: identity.institutionOrigin,
						principalId: identity.principalId,
						sessionId: identity.sessionId,
						initialDestination: 'account',
						identity,
						...(identity.institutionOrigin.startsWith('http:')
							? { developmentOrigin: true }
							: {})
					});
				}
			})
		);
		const identity = owned.add(
			new DesktopIdentityCoordinator({
				target: options.target,
				transport: new HttpServerReadinessTransport(),
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
			new ElectronProductWindowFactory({ ...options.window, launchIdentity: identity }),
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
		windows.openInitial({ protocolVersion: 1, kind: 'launch', windowId: randomUUID() });
		return { dispose: () => owned.dispose(), shutdown };
	} catch (error) {
		owned.dispose();
		throw error;
	}
}
