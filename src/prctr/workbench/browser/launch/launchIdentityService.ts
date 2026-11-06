/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import {
	validateLaunchIdentityProjection,
	type LaunchIdentityClient,
	type LaunchIdentityProjection
} from '../../../platform/identity/common/launchIdentity.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const ILaunchIdentityService =
	createDecorator<ILaunchIdentityService>('launchIdentityService');

/**
 * The LaunchWindow's view of the privileged launch identity coordinator. Main owns
 * readiness and sign-in; this service only relays the latest projection and the
 * candidate's intents, one at a time.
 */
export interface ILaunchIdentityService {
	readonly _serviceBrand: undefined;

	/** The newest projection, or undefined before `initialize` resolves. */
	readonly projection: LaunchIdentityProjection | undefined;
	readonly onDidChange: Event<LaunchIdentityProjection>;

	/** True while an intent is being delivered; further ordinary intents are ignored. */
	readonly isBusy: boolean;
	readonly onDidChangeBusy: Event<boolean>;

	/** Fires when an intent could not be delivered. */
	readonly onDidFailAction: Event<void>;

	initialize(): Promise<void>;
	selectServer(address: string): void;
	retry(): void;
	signIn(): void;
	reopenBrowser(): void;
	/** Always delivered, even while another intent is pending. */
	changeServer(): void;
	/** Always delivered, even while another intent is pending. */
	cancel(): void;
}

export class LaunchIdentityService extends Disposable implements ILaunchIdentityService {
	declare readonly _serviceBrand: undefined;

	private readonly changeEmitter = this._register(new Emitter<LaunchIdentityProjection>());
	readonly onDidChange = this.changeEmitter.event;

	private readonly busyEmitter = this._register(new Emitter<boolean>());
	readonly onDidChangeBusy = this.busyEmitter.event;

	private readonly failureEmitter = this._register(new Emitter<void>());
	readonly onDidFailAction = this.failureEmitter.event;

	private current: LaunchIdentityProjection | undefined;
	/** Identifies the newest intent, so an older one finishing late cannot clear its busy state. */
	private actionSequence = 0;
	private pendingAction: number | undefined;

	constructor(private readonly client: LaunchIdentityClient) {
		super();
	}

	get projection(): LaunchIdentityProjection | undefined {
		return this.current;
	}

	get isBusy(): boolean {
		return this.pendingAction !== undefined;
	}

	async initialize(): Promise<void> {
		// Subscribe before reading the snapshot, so an older reply cannot overwrite a newer event.
		this._register(this.client.onDidChange((projection) => this.accept(projection)));
		this.accept(await this.client.projection());
	}

	selectServer(address: string): void {
		void this.run(() => this.client.selectServer(address), false);
	}

	retry(): void {
		void this.run(() => this.client.retry(), false);
	}

	signIn(): void {
		void this.run(() => this.client.signIn(), false);
	}

	reopenBrowser(): void {
		void this.run(() => this.client.reopenBrowser(), false);
	}

	changeServer(): void {
		void this.run(() => this.client.changeServer(), true);
	}

	cancel(): void {
		void this.run(() => this.client.cancel(), true);
	}

	private accept(value: unknown): void {
		if (this._store.isDisposed) {
			return;
		}
		const next = validateLaunchIdentityProjection(value);
		if (this.current !== undefined && next.revision <= this.current.revision) {
			return;
		}
		this.current = next;
		this.changeEmitter.fire(next);
	}

	private async run(operation: () => Promise<void>, interrupt: boolean): Promise<void> {
		if (this._store.isDisposed || (this.pendingAction !== undefined && !interrupt)) {
			return;
		}
		const sequence = ++this.actionSequence;
		this.setPending(sequence);
		try {
			await operation();
		} catch {
			if (!this._store.isDisposed && sequence === this.actionSequence) {
				this.failureEmitter.fire();
			}
		} finally {
			if (!this._store.isDisposed && sequence === this.actionSequence) {
				this.setPending(undefined);
			}
		}
	}

	private setPending(sequence: number | undefined): void {
		const wasBusy = this.isBusy;
		this.pendingAction = sequence;
		if (wasBusy !== this.isBusy) {
			this.busyEmitter.fire(this.isBusy);
		}
	}
}
