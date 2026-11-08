/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days from `time` to `now` in the local time zone: 0 is today, 1 is yesterday. */
export function calendarDaysBefore(time: number, now: number): number {
	const day = (value: number): number => {
		const date = new Date(value);
		return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	};
	return Math.round((day(now) - day(time)) / DAY);
}

export type RelativeDay = 'today' | 'yesterday' | 'other';

export function relativeDay(time: number, now: number): RelativeDay {
	const days = calendarDaysBefore(time, now);
	if (days === 0) return 'today';
	if (days === 1) return 'yesterday';
	return 'other';
}
