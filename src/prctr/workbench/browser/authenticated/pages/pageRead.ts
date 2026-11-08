/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../../base/common/event.js';
import {
	Disposable,
	MutableDisposable,
	toDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';

/** The answer is slow enough to say so. */
export const PAGE_READ_SLOW_MS = 8_000;
/** No answer by now counts as the server being unavailable. */
export const PAGE_READ_DEADLINE_MS = 15_000;

export type PageReadState<F extends string = string> =
	| { readonly kind: 'loading'; readonly slow?: boolean }
	| { readonly kind: 'ready' }
	/** Nothing could be read. */
	| { readonly kind: 'failed'; readonly reason: F }
	/** A refresh failed; the earlier data stays shown. */
	| { readonly kind: 'stale'; readonly reason: F };

/** What one read answered: the data it is for, or why there is none. */
export type PageReadResult<D, F extends string> =
	{ readonly kind: 'data'; readonly data: D } | { readonly kind: 'failure'; readonly reason: F };

/** Where a page's data comes from: one request, or an observation that keeps it current. */
export interface PageReadSource<R> {
	request(): Promise<R>;
	/** Follows the data while the page shows it; undefined when it can only be read once. */
	observe(listener: (response: R) => void): IDisposable | undefined;
}

export interface PageReadOptions<R, D, F extends string> {
	readonly source: PageReadSource<R>;
	/** Reads a response as this page's data or as its failure. */
	interpret(response: R): PageReadResult<D, F>;
	/** The failure means the shown data no longer belongs here, so it is withdrawn, not kept. */
	withdraws(reason: F): boolean;
	/** The reason given when no answer arrives in time. */
	readonly timeout: F;
}

/**
 * One page's data as it last confirmed it. While the page is visible it follows the
 * source's observation, or reads once without one. Only the newest explicit read may
 * apply, a slow answer says so, no answer becomes a failure, and a failed refresh keeps
 * what was already shown unless the failure means the data no longer belongs here.
 */
export class PageRead<D, F extends string, R = unknown> extends Disposable {
	private readonly changeEmitter = this._register(new Emitter<void>());
	/** The data or the read state changed. */
	readonly onDidChange: Event<void> = this.changeEmitter.event;
	private readonly readEmitter = this._register(new Emitter<void>());
	/** A read succeeded, whether or not the data changed. */
	readonly onDidRead: Event<void> = this.readEmitter.event;

	private readonly observation = this._register(new MutableDisposable());
	private currentData: D | undefined;
	private currentState: PageReadState<F> = { kind: 'loading' };
	private sequence = 0;
	private readonly timers = this._register(new MutableDisposable());

	constructor(private readonly options: PageReadOptions<R, D, F>) {
		super();
		this._register(toDisposable(() => this.sequence++));
	}

	get data(): D | undefined {
		return this.currentData;
	}

	get state(): PageReadState<F> {
		return this.currentState;
	}

	setActive(active: boolean): void {
		if (!active) {
			this.observation.clear();
			return;
		}
		if (this.observation.value !== undefined) return;
		const subscription = this.options.source.observe((response) => {
			if (!this._store.isDisposed) this.apply(response);
		});
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
		const response = await this.options.source.request();
		if (this._store.isDisposed || sequence !== this.sequence) return false;
		return this.apply(response);
	}

	/** Marks the wait as slow, then ends it as a failure, unless an answer arrives first. */
	private startDeadline(): void {
		const slow = setTimeout(() => {
			if (this.currentState.kind === 'loading')
				this.setState({ kind: 'loading', slow: true });
		}, PAGE_READ_SLOW_MS);
		const deadline = setTimeout(() => {
			if (this.currentState.kind === 'loading')
				this.setState({ kind: 'failed', reason: this.options.timeout });
		}, PAGE_READ_DEADLINE_MS);
		this.timers.value = toDisposable(() => {
			clearTimeout(slow);
			clearTimeout(deadline);
		});
	}

	private apply(response: R): boolean {
		this.timers.clear();
		const result = this.options.interpret(response);
		if (result.kind === 'data') {
			const changed = JSON.stringify(result.data) !== JSON.stringify(this.currentData);
			this.currentData = result.data;
			if (changed || this.currentState.kind !== 'ready') {
				this.currentState = { kind: 'ready' };
				this.changeEmitter.fire();
			}
			this.readEmitter.fire();
			return true;
		}
		if (this.options.withdraws(result.reason)) this.currentData = undefined;
		this.setState(
			this.currentData === undefined
				? { kind: 'failed', reason: result.reason }
				: { kind: 'stale', reason: result.reason }
		);
		return false;
	}

	private setState(state: PageReadState<F>): void {
		this.currentState = state;
		this.changeEmitter.fire();
	}
}
