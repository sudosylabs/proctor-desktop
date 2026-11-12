/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IpcMain, IpcMainInvokeEvent } from 'electron/main';
import { Disposable, toDisposable, type IDisposable } from '../../../base/common/lifecycle.js';

export interface CapabilityObservationOptions<I, R> {
	/** The capability's own observation channel; answers go to `${channel}:change`. */
	readonly channel: string;
	readonly validateIntent: (value: unknown) => I;
	readonly validateResponse: (value: unknown) => R;
	/** Throws unless the sender may use the capability. Run again before every answer. */
	readonly authorize: (event: IpcMainInvokeEvent) => void;
	readonly observe: (intent: I, listener: (response: R) => void) => IDisposable;
	/** Sent when an answer cannot be delivered as data, so the renderer learns its wait ended. */
	readonly failure?: R;
	/** Concurrent observations one window may hold; defaults to 64. */
	readonly maxObservations?: number;
}
type ObservationMessage<I> =
	| { readonly kind: 'start'; readonly id: number; readonly intent: I }
	| { readonly kind: 'stop'; readonly id: number };

/**
 * The renderer side of a closed capability's observations. It never accepts an operation or URL.
 * Every answer is authorized again against the frame that started the observation and goes only
 * to that frame. A window's observations end when its web contents is destroyed, so nothing keeps
 * polling for a closed window.
 */
export class CapabilityObservationChannel<I, R> extends Disposable {
	private readonly observations = new Map<number, IDisposable>();
	private readonly maxObservations: number;
	private watchingSender = false;
	private ended = false;

	constructor(
		ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
		private readonly options: CapabilityObservationOptions<I, R>
	) {
		super();
		this.maxObservations = options.maxObservations ?? 64;
		ipc.handle(options.channel, (event, raw: unknown, ...extra: unknown[]) =>
			this.receive(event, raw, extra)
		);
		this._register(
			toDisposable(() => {
				this.ended = true;
				this.endAll();
				ipc.removeHandler(options.channel);
			})
		);
	}

	private receive(event: IpcMainInvokeEvent, raw: unknown, extra: unknown[]): void {
		// The frame that started the observation; `event.senderFrame` is a lookup, not a handle.
		const frame = event.senderFrame;
		const origin = { sender: event.sender, senderFrame: frame } as IpcMainInvokeEvent;
		this.options.authorize(origin);
		if (this.ended || extra.length) throw new TypeError('Invalid observation');
		const message = this.parse(raw);
		this.end(message.id);
		if (message.kind === 'stop') return;
		if (this.observations.size >= this.maxObservations)
			throw new TypeError('Invalid observation');
		this.watchSender(event);
		const id = message.id;
		let active = true;
		const stop = (): void => {
			active = false;
			this.end(id);
		};
		const subscription = this.options.observe(message.intent, (response) => {
			if (this.ended || !active) return;
			try {
				this.options.authorize(origin);
			} catch {
				stop();
				return;
			}
			let payload: R;
			try {
				payload = this.options.validateResponse(response);
			} catch {
				if (this.options.failure === undefined) {
					stop();
					return;
				}
				payload = this.options.failure;
			}
			try {
				frame?.send(`${this.options.channel}:change`, { id, response: payload });
			} catch {
				stop();
			}
		});
		if (!active || this.ended) {
			subscription.dispose();
			return;
		}
		this.observations.set(id, {
			dispose: () => {
				active = false;
				subscription.dispose();
			}
		});
	}

	private parse(raw: unknown): ObservationMessage<I> {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw))
			throw new TypeError('Invalid observation');
		const value = raw as Record<string, unknown>;
		const keys = Object.keys(value);
		if (
			!Number.isSafeInteger(value.id) ||
			Number(value.id) < 1 ||
			keys.some((key) => key !== 'id' && key !== 'kind' && key !== 'intent')
		)
			throw new TypeError('Invalid observation');
		if (value.kind === 'stop' && !('intent' in value))
			return { kind: 'stop', id: Number(value.id) };
		if (value.kind === 'start')
			return {
				kind: 'start',
				id: Number(value.id),
				intent: this.options.validateIntent(value.intent)
			};
		throw new TypeError('Invalid observation');
	}

	/** One window owns the channel, so its destruction ends every observation it started. */
	private watchSender(event: IpcMainInvokeEvent): void {
		if (this.watchingSender) return;
		const sender = event.sender as { once?(name: 'destroyed', listener: () => void): unknown };
		if (typeof sender?.once !== 'function') return;
		this.watchingSender = true;
		sender.once('destroyed', () => this.endAll());
	}
	private end(id: number): void {
		this.observations.get(id)?.dispose();
		this.observations.delete(id);
	}
	private endAll(): void {
		for (const observation of this.observations.values()) observation.dispose();
		this.observations.clear();
	}
}
