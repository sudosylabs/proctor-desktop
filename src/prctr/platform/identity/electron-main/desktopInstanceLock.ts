import { app } from 'electron';
import type { IDisposable } from '../../../base/common/lifecycle.js';

/** Exclusive process ownership of the current Electron userData credential directory. */
export function acquireDesktopInstanceLock(onSecondInstance: () => void): IDisposable | undefined {
	if (!app.requestSingleInstanceLock()) return undefined;
	app.on('second-instance', onSecondInstance);
	let disposed = false;
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			app.removeListener('second-instance', onSecondInstance);
			app.releaseSingleInstanceLock();
		}
	};
}
