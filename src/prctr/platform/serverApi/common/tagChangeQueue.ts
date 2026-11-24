/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { tagsOverlap, type ServerDataTag } from './serverDataTags.js';

/** How many changes may wait on one tag; the next is refused as busy. */
export const MAX_QUEUED_CHANGES_PER_TAG = 4;

interface Entry {
	readonly locks: readonly ServerDataTag[];
	running: boolean;
	readonly start: () => void;
}

/**
 * Runs changes so that two holding overlapping tags never run together: the later one waits,
 * first in, first out. Changes with unrelated tags run at the same time. A change with no locks
 * starts at once.
 */
export class TagChangeQueue {
	private readonly entries: Entry[] = [];

	/**
	 * Runs `task` once no earlier change holds an overlapping tag. Returns `'busy'` without
	 * running it when one of its tags already has {@link MAX_QUEUED_CHANGES_PER_TAG} waiting.
	 */
	run<T>(locks: readonly ServerDataTag[], task: () => Promise<T>): Promise<T | 'busy'> {
		const full = locks.some(
			(lock) =>
				this.entries.filter(
					(entry) => !entry.running && entry.locks.some((held) => tagsOverlap(held, lock))
				).length >= MAX_QUEUED_CHANGES_PER_TAG
		);
		if (full) return Promise.resolve('busy');
		return new Promise<T>((resolve, reject) => {
			const entry: Entry = {
				locks,
				running: false,
				start: () => {
					entry.running = true;
					// The lock is released before the caller hears the result.
					task()
						.finally(() => {
							this.entries.splice(this.entries.indexOf(entry), 1);
							this.startReady();
						})
						.then(resolve, reject);
				}
			};
			this.entries.push(entry);
			this.startReady();
		});
	}

	/** The number of changes running or waiting. */
	get size(): number {
		return this.entries.length;
	}

	private startReady(): void {
		for (const [index, entry] of this.entries.entries()) {
			if (entry.running) continue;
			const blocked = this.entries
				.slice(0, index)
				.some((earlier) =>
					earlier.locks.some((held) =>
						entry.locks.some((lock) => tagsOverlap(held, lock))
					)
				);
			if (!blocked) entry.start();
		}
	}
}
