/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import { LOG_CHANNEL, validateLogEntry, type WindowLogSink } from '../common/logEntry.js';

/** One window's log capability: entries from its own main frame, validated, into the sink. */
export class LogIpcBridge {
	#disposed = false;
	constructor(
		private readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		window: string,
		sink: WindowLogSink,
		authorize: (event: IpcMainInvokeEvent) => void
	) {
		ipc.handle(LOG_CHANNEL, (event, ...args: unknown[]) => {
			if (this.#disposed) return;
			authorize(event);
			if (args.length !== 1) throw new TypeError('Expected one log entry');
			sink.write(window, validateLogEntry(args[0]));
		});
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.ipc.removeHandler(LOG_CHANNEL);
	}
}
