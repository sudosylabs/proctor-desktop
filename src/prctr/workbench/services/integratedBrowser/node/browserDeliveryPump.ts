/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerApiError } from '../../../../platform/serverApi/common/serverApi.js';
import type { BrowserDeliveryService } from './browserDeliveryService.js';

/** Fair per-Attempt delivery. A status+budget+control/data cycle stays below two requests each second.
 * Captured bytes stay protected on every failure. Connectivity changes wake pending sources;
 * a source status or receipt never changes the privileged browser admission gate.
 */
export class BrowserDeliveryPump {
	private readonly pending = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private inFlight = false;
	private disposed = false;
	private online = true;
	private failures = 0;
	private nextAt = 0;
	constructor(
		private readonly service: Pick<BrowserDeliveryService, 'deliver'>,
		private readonly unavailable: (error: unknown) => void
	) {}
	notify(source: string): void {
		if (this.disposed) return;
		this.pending.add(source);
		this.schedule();
	}
	setOnline(online: boolean): void {
		this.online = online;
		if (!online && this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		if (online) this.schedule();
	}
	private schedule(): void {
		if (this.disposed || !this.online || this.inFlight || this.timer || !this.pending.size)
			return;
		this.timer = setTimeout(
			() => {
				this.timer = undefined;
				void this.run();
			},
			Math.max(0, this.nextAt - Date.now())
		);
		this.timer.unref();
	}
	private async run(): Promise<void> {
		const source = this.pending.values().next().value;
		if (this.disposed || !this.online || !source) return;
		this.pending.delete(source);
		this.inFlight = true;
		this.nextAt = Date.now() + 2000;
		try {
			const sent = await this.service.deliver(source);
			this.failures = 0;
			if (sent > 0) this.pending.add(source);
		} catch (error) {
			this.failures++;
			this.nextAt =
				Date.now() +
				Math.max(
					1000,
					Math.min(30_000, 1000 * 2 ** Math.min(this.failures, 5)),
					error instanceof ServerApiError ? (error.retryAfterMs ?? 0) : 0
				);
			if (!(
				error instanceof ServerApiError && [401, 403, 404, 410].includes(error.status ?? 0)
			))
				this.pending.add(source);
			this.unavailable(error);
		} finally {
			this.inFlight = false;
			this.schedule();
		}
	}
	dispose(): void {
		this.disposed = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.pending.clear();
	}
}
