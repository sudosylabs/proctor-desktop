/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** The one channel a window's log entries cross to main on. */
export const LOG_CHANNEL = 'prctr:window:log';

export const logLevels = ['error', 'warning', 'info', 'debug', 'trace'] as const;
export type LogEntryLevel = (typeof logLevels)[number];

/**
 * Where an entry comes from, from a closed list, so a log reads by area and a window can't
 * invent one.
 */
export const logAreas = [
	'workbench',
	'administration',
	'account',
	'settings',
	'examActivity',
	'serverData',
	'telemetry'
] as const;
export type LogArea = (typeof logAreas)[number];

/** A message longer than this is refused rather than cut, so nothing large slips through. */
export const MAX_LOG_MESSAGE = 2_000;

export interface LogEntry {
	readonly level: LogEntryLevel;
	readonly area: LogArea;
	readonly message: string;
}

/**
 * Accepts exactly a level, an area and a message within bounds, or throws. Messages carry ids,
 * closed reasons, timings and counts; what may never be logged is the caller's rule, stated in
 * the observability architecture.
 */
export function validateLogEntry(value: unknown): LogEntry {
	if (typeof value !== 'object' || value === null) throw new TypeError('Expected a log entry');
	const keys = Object.keys(value).sort();
	if (keys.join() !== 'area,level,message') throw new TypeError('Unexpected log entry fields');
	const { level, area, message } = value as Record<string, unknown>;
	if (!(logLevels as readonly unknown[]).includes(level))
		throw new TypeError('Unknown log level');
	if (!(logAreas as readonly unknown[]).includes(area)) throw new TypeError('Unknown log area');
	if (typeof message !== 'string' || message.length === 0 || message.length > MAX_LOG_MESSAGE)
		throw new TypeError('Log message out of bounds');
	return Object.freeze({
		level: level as LogEntryLevel,
		area: area as LogArea,
		message
	});
}

/** Where a window's log entries are written. */
export interface WindowLogSink {
	write(window: string, entry: LogEntry): void;
}
