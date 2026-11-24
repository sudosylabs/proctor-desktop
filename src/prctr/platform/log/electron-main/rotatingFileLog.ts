/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { appendFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogEntry, WindowLogSink } from '../common/logEntry.js';

/** The log file grows to this size before it is set aside for a fresh one. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Proctor's log in the application's logs folder: one line per entry, written in order, and
 * bounded: past 5 MB the file becomes `proctor.1.log`, replacing the previous one.
 */
export class RotatingFileLog implements WindowLogSink {
	private readonly path: string;
	private queue: Promise<void> = Promise.resolve();

	constructor(folder: string) {
		this.path = join(folder, 'proctor.log');
	}

	write(window: string, entry: LogEntry): void {
		const line = `${new Date().toISOString()} [${entry.level}] ${window}/${entry.area}: ${entry.message.replace(/[\r\n]+/gu, ' ')}\n`;
		this.queue = this.queue.then(() => this.append(line)).catch(() => undefined);
	}

	/** Resolves once every entry written so far is on disk. */
	flush(): Promise<void> {
		return this.queue;
	}

	private async append(line: string): Promise<void> {
		const size = await stat(this.path).then(
			(info) => info.size,
			() => 0
		);
		if (size + line.length > MAX_BYTES)
			await rename(this.path, join(this.path, '..', 'proctor.1.log'));
		await appendFile(this.path, line, 'utf8');
	}
}
