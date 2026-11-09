/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	isAdministrationRead,
	type AdministrationClient,
	type AdministrationIntent,
	type AdministrationResponse
} from '../../../../platform/administration/common/administrationProtocol.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { ApiSubscription } from '../../../../platform/serverApi/common/apiObservation.js';

/** A read that has not answered by then fails, so no page waits forever. */
export const ADMINISTRATION_READ_DEADLINE_MS = 15_000;

export const IAdministrationService =
	createDecorator<IAdministrationService>('administrationService');

/**
 * AuthenticatedWindow's bound Administration capability. The server owns and authorizes every
 * read and change; this service bounds reads by a deadline and makes one change at a time.
 */
export interface IAdministrationService {
	readonly _serviceBrand: undefined;

	/** Whether the capability pushes fresh data; otherwise readers refresh on their own. */
	readonly observable: boolean;
	/** Whether a change is waiting for the server; the next one waits until it replies. */
	readonly isChanging: boolean;

	/**
	 * Sends one intent. A transport failure becomes a failure reply; a change whose reply
	 * was lost is unconfirmed; a read that misses the deadline is unavailable.
	 */
	request(intent: AdministrationIntent): Promise<AdministrationResponse>;
	/** Makes one change at a time; a second request while one is in flight is refused as busy. */
	change(intent: AdministrationIntent): Promise<AdministrationResponse | 'busy'>;
	/** Follows one read while the capability can push it. */
	observe(
		intent: AdministrationIntent,
		listener: (response: AdministrationResponse) => void
	): ApiSubscription | undefined;
}

export class AdministrationService extends Disposable implements IAdministrationService {
	declare readonly _serviceBrand: undefined;

	private changing = false;

	constructor(
		private readonly client: AdministrationClient,
		private readonly readDeadline: number = ADMINISTRATION_READ_DEADLINE_MS
	) {
		super();
	}

	get observable(): boolean {
		return this.client.observe !== undefined;
	}

	get isChanging(): boolean {
		return this.changing;
	}

	async request(intent: AdministrationIntent): Promise<AdministrationResponse> {
		const read = isAdministrationRead(intent);
		try {
			return read
				? await this.requestWithDeadline(intent)
				: await this.client.request(intent);
		} catch {
			return { kind: 'error', reason: read ? 'unavailable' : 'unconfirmed' };
		}
	}

	async change(intent: AdministrationIntent): Promise<AdministrationResponse | 'busy'> {
		if (this.changing) {
			return 'busy';
		}
		this.changing = true;
		try {
			return await this.request(intent);
		} finally {
			this.changing = false;
		}
	}

	observe(
		intent: AdministrationIntent,
		listener: (response: AdministrationResponse) => void
	): ApiSubscription | undefined {
		return this.client.observe?.(intent, listener);
	}

	private async requestWithDeadline(
		intent: AdministrationIntent
	): Promise<AdministrationResponse> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<AdministrationResponse>((resolve) => {
			timer = setTimeout(
				() => resolve({ kind: 'error', reason: 'unavailable' }),
				this.readDeadline
			);
		});
		try {
			return await Promise.race([this.client.request(intent), deadline]);
		} finally {
			clearTimeout(timer);
		}
	}
}
