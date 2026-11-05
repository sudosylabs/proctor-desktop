import { nativeTheme } from 'electron';
import {
	DesktopIdentityCoordinator,
	type DesktopIdentityCoordinatorOptions
} from '../../platform/identity/electron-main/desktopIdentityCoordinator.js';
import { HttpServerReadinessTransport } from '../../platform/identity/electron-main/httpServerReadinessTransport.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import { ProductWindowCoordinator } from '../../platform/windows/common/windowCoordinator.js';
import {
	ElectronProductWindowFactory,
	type ElectronProductWindowFactoryOptions
} from '../../platform/windows/electron-main/electronProductWindowFactory.js';

export interface LaunchWindowCompositionOptions {
	readonly window: Omit<ElectronProductWindowFactoryOptions, 'launchIdentity'>;
	readonly windowId: string;
	readonly target: DesktopIdentityCoordinatorOptions['target'];
	readonly allowDevelopmentLoopback?: boolean;
	readonly authorization?: DesktopIdentityCoordinatorOptions['authorization'];
	readonly onExit: () => void;
}

/** Select the real public HTTP adapter in main; release metadata and auth custody never come from preload. */
export function createLaunchWindowComposition(options: LaunchWindowCompositionOptions): {
	readonly identity: DesktopIdentityCoordinator;
	readonly windows: ProductWindowCoordinator;
	dispose(): void;
} {
	if (options.window.production && options.allowDevelopmentLoopback)
		throw new Error('Production LaunchWindow cannot enable development HTTP');
	// Resolve the product default before native chrome and renderer media queries initialize.
	nativeTheme.themeSource = 'dark';
	const identity = new DesktopIdentityCoordinator({
		target: options.target,
		transport: new HttpServerReadinessTransport(),
		allowDevelopmentLoopback: options.allowDevelopmentLoopback === true,
		authorization: options.authorization
	});
	const owned = new DisposableStore();
	owned.add(identity);
	try {
		const windows = new ProductWindowCoordinator(
			new ElectronProductWindowFactory({ ...options.window, launchIdentity: identity }),
			{
				accept: (_descriptor, intent) => {
					if (intent.kind !== 'launch.exit')
						throw new Error('Intent is outside LaunchWindow composition');
					owned.dispose();
					options.onExit();
				}
			}
		);
		owned.add({ dispose: () => windows.shutdown() });
		owned.add(windows.onDidTerminate(() => owned.dispose()));
		windows.openInitial({ kind: 'launch', windowId: options.windowId });
		return Object.freeze({ identity, windows, dispose: () => owned.dispose() });
	} catch (error) {
		try {
			owned.dispose();
		} catch (cleanup) {
			throw new AggregateError([error, cleanup], 'LaunchWindow composition rollback failed');
		}
		throw error;
	}
}
