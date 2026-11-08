/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountData,
	AccountFailure,
	AccountReadSection,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import { failureWithdrawsData } from '../common/accountPresentation.js';
import type { AccountPageServices } from './accountPageServices.js';

export type AccountDataOf<S extends AccountReadSection> = Extract<AccountData, { section: S }>;

/** The answer is slow enough to say so. */
export const ACCOUNT_READ_SLOW_MS = 8_000;
/** No answer by now is a failure the person can retry; a read never waits forever. */
export const ACCOUNT_READ_DEADLINE_MS = 15_000;

export type AccountReadState =
	| { readonly kind: 'loading'; readonly slow?: boolean }
	| { readonly kind: 'ready' }
	/** Nothing could be read. */
	| { readonly kind: 'failed'; readonly reason: AccountFailure }
	/** A refresh failed; the earlier data stays shown. */
	| { readonly kind: 'stale'; readonly reason: AccountFailure };

/**
 * One account section's data as this page last confirmed it. While its page is
 * visible it follows the capability's observation, or reads once without one.
 * Only the newest explicit read may apply, and a failed refresh keeps what was
 * already shown unless the failure means the data no longer belongs here.
 */
export class AccountRead<S extends AccountReadSection> extends Disposable {
	private readonly changeEmitter = this._register(new Emitter<void>());
	/** The data or the read state changed. */
	readonly onDidChange: Event<void> = this.changeEmitter.event;
	private readonly readEmitter = this._register(new Emitter<void>());
	/** A read succeeded, whether or not the data changed. */
	readonly onDidRead: Event<void> = this.readEmitter.event;

	private readonly observation = this._register(new MutableDisposable());
	private currentData: AccountDataOf<S> | undefined;
	private currentState: AccountReadState = { kind: 'loading' };
	private sequence = 0;
	private readonly timers = this._register(new MutableDisposable());

	constructor(
		private readonly services: AccountPageServices,
		readonly section: S
	) {
		super();
		this._register(toDisposable(() => this.sequence++));
	}

	get data(): AccountDataOf<S> | undefined {
		return this.currentData;
	}

	get state(): AccountReadState {
		return this.currentState;
	}

	setActive(active: boolean): void {
		if (!active) {
			this.observation.clear();
			return;
		}
		if (this.observation.value !== undefined) return;
		const subscription = this.services.observe(
			{ kind: 'read', section: this.section },
			(response) => {
				if (!this._store.isDisposed) this.apply(response);
			}
		);
		if (subscription !== undefined) {
			this.observation.value = subscription;
			if (this.currentState.kind === 'loading') this.startDeadline();
		} else void this.refresh();
	}

	/** Reads again now. Resolves whether the read succeeded and is the newest one. */
	async refresh(): Promise<boolean> {
		const sequence = ++this.sequence;
		if (this.currentData === undefined && this.currentState.kind !== 'loading')
			this.setState({ kind: 'loading' });
		if (this.currentData === undefined) this.startDeadline();
		const response = await this.services.request({ kind: 'read', section: this.section });
		if (this._store.isDisposed || sequence !== this.sequence) return false;
		return this.apply(response);
	}

	/** Marks the wait as slow, then ends it as a failure, unless an answer arrives first. */
	private startDeadline(): void {
		const slow = setTimeout(() => {
			if (this.currentState.kind === 'loading')
				this.setState({ kind: 'loading', slow: true });
		}, ACCOUNT_READ_SLOW_MS);
		const deadline = setTimeout(() => {
			if (this.currentState.kind === 'loading')
				this.setState({ kind: 'failed', reason: 'unavailable' });
		}, ACCOUNT_READ_DEADLINE_MS);
		this.timers.value = toDisposable(() => {
			clearTimeout(slow);
			clearTimeout(deadline);
		});
	}

	private apply(response: AccountResponse): boolean {
		this.timers.clear();
		if (response.kind === 'data' && response.data.section === this.section) {
			const data = response.data as AccountDataOf<S>;
			const changed = JSON.stringify(data) !== JSON.stringify(this.currentData);
			this.currentData = data;
			if (changed || this.currentState.kind !== 'ready') {
				this.currentState = { kind: 'ready' };
				this.changeEmitter.fire();
			}
			this.readEmitter.fire();
			return true;
		}
		const reason = response.kind === 'error' ? response.reason : 'invalid';
		if (failureWithdrawsData(reason)) this.currentData = undefined;
		this.setState(
			this.currentData === undefined ? { kind: 'failed', reason } : { kind: 'stale', reason }
		);
		return false;
	}

	private setState(state: AccountReadState): void {
		this.currentState = state;
		this.changeEmitter.fire();
	}
}
