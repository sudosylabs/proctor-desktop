/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { AbstractLogger, LogLevel, type ILogService } from '../common/log.js';
import { MAX_LOG_MESSAGE, type LogArea, type LogEntryLevel } from '../common/logEntry.js';

/** How a window sends one entry to main; it never waits and never throws. */
export type LogForwarder = (level: LogEntryLevel, area: LogArea, message: string) => void;

/**
 * A window's `ILogService`: entries at or above the level go to main's log through the window's
 * one log capability. A message is the caller's text with its arguments' safe forms appended:
 * an error by its name and message, numbers and booleans as written, anything else dropped.
 */
export class ForwardingLogService extends AbstractLogger implements ILogService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly forward: LogForwarder,
		private readonly area: LogArea = 'workbench',
		level: LogLevel = LogLevel.Info
	) {
		super();
		this.setLevel(level);
	}

	trace(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Trace)) this.send('trace', message, args);
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Debug)) this.send('debug', message, args);
	}

	info(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Info)) this.send('info', message, args);
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Warning)) this.send('warning', message, args);
	}

	error(message: string | Error, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Error)) this.send('error', describe(message), args);
	}

	flush(): void {}

	private send(level: LogEntryLevel, message: string, args: readonly unknown[]): void {
		const text = [message, ...args.flatMap(safeArgument)].join(' ').slice(0, MAX_LOG_MESSAGE);
		if (text.length > 0) this.forward(level, this.area, text);
	}
}

function describe(value: unknown): string {
	return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
}

/** Only values that can't carry personal text: errors by name and message, numbers, booleans. */
function safeArgument(value: unknown): string[] {
	if (value instanceof Error) return [describe(value)];
	if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
	return [];
}
