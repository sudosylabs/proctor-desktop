/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountClient,
	AccountIntent,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';

/** A read that has not answered by then fails, so no page waits forever. */
export const ACCOUNT_READ_DEADLINE_MS = 15_000;

export const IAccountService = createDecorator<IAccountService>('accountService');

/**
 * AuthenticatedWindow's bound account capability. The server owns every read and
 * change; this service bounds reads by a deadline, makes one change at a time, and
 * reports the profile photo the window shows.
 */
export interface IAccountService {
	readonly _serviceBrand: undefined;

	/** Whether the capability pushes fresh data; otherwise readers refresh on their own. */
	readonly observable: boolean;
	/** Whether a change is waiting for the server; the next one waits until it replies. */
	readonly isChanging: boolean;
	/** The profile photo changed, as a data URL. */
	readonly onDidChangePhoto: Event<string>;

	/**
	 * Sends one intent. A transport failure becomes a failure reply; a change whose reply
	 * was lost is unconfirmed; a read that misses the deadline is unavailable.
	 */
	request(intent: AccountIntent): Promise<AccountResponse>;
	/** Makes one change at a time; a second request while one is in flight is refused as busy. */
	change(intent: AccountIntent): Promise<AccountResponse | 'busy'>;
	/** Follows one read while the capability can push it. */
	observe(
		intent: AccountIntent,
		listener: (response: AccountResponse) => void
	): IDisposable | undefined;
	/** The current profile photo as a data URL, when the account has one. */
	readPhoto(): Promise<string | undefined>;
	/** Shows a photo the account now uses, everywhere the window shows it. */
	setPhoto(dataUrl: string): void;
}

export class AccountService extends Disposable implements IAccountService {
	declare readonly _serviceBrand: undefined;

	private readonly photoEmitter = this._register(new Emitter<string>());
	readonly onDidChangePhoto: Event<string> = this.photoEmitter.event;

	private changing = false;

	constructor(
		private readonly client: AccountClient,
		private readonly readDeadline: number = ACCOUNT_READ_DEADLINE_MS
	) {
		super();
	}

	get observable(): boolean {
		return this.client.observe !== undefined;
	}

	get isChanging(): boolean {
		return this.changing;
	}

	async request(intent: AccountIntent): Promise<AccountResponse> {
		try {
			if (!isRead(intent)) {
				return await this.client.request(intent);
			}
			return await this.requestWithDeadline(intent);
		} catch {
			return { kind: 'error', reason: isRead(intent) ? 'unavailable' : 'unconfirmed' };
		}
	}

	async change(intent: AccountIntent): Promise<AccountResponse | 'busy'> {
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
		intent: AccountIntent,
		listener: (response: AccountResponse) => void
	): IDisposable | undefined {
		return this.client.observe?.(intent, listener);
	}

	async readPhoto(): Promise<string | undefined> {
		const result = await this.request({ kind: 'readPhoto' });
		return result.kind === 'photo' ? result.dataUrl : undefined;
	}

	setPhoto(dataUrl: string): void {
		this.photoEmitter.fire(dataUrl);
	}

	private async requestWithDeadline(intent: AccountIntent): Promise<AccountResponse> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<AccountResponse>((resolve) => {
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

function isRead(intent: AccountIntent): boolean {
	return (
		intent.kind === 'read' ||
		intent.kind === 'readHistory' ||
		intent.kind === 'readPhoto' ||
		intent.kind === 'openSecurity'
	);
}
