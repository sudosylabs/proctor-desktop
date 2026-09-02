import {
	ElectronProductWindowFactory,
	type ElectronProductWindowFactoryOptions
} from '../../platform/windows/electron-main/electronProductWindowFactory.js';
import {
	ProductWindowCoordinator,
	type TrustedWindowIntentSink
} from '../../platform/windows/common/windowCoordinator.js';

/** Main-process composition root. Trusted identity/security coordinators own every call into the returned coordinator. */
export function createProductWindowComposition(
	options: ElectronProductWindowFactoryOptions,
	intentSink: TrustedWindowIntentSink
): ProductWindowCoordinator {
	return new ProductWindowCoordinator(new ElectronProductWindowFactory(options), intentSink);
}
