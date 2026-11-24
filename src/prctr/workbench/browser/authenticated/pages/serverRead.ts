/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import type {
	IQueryObservation,
	IServerDataService,
	ServerDataCapabilities,
	ServerDataCapability,
	ServerDataValue
} from '../../../services/serverData/common/serverData.js';
import type { PageReadState } from './pageRead.js';

type Failure<C extends ServerDataCapability> = ServerDataCapabilities[C]['failure'];

/**
 * One server read as a page shows it, through the one data path: it observes while the page is
 * visible, and reports the page states (loading, slow, ready, stale, failed) and the data each
 * time either changes. `interpret` picks the page's value out of the answer, or says the answer
 * isn't the one asked for.
 */
export class ServerRead<C extends ServerDataCapability, D> extends Disposable {
	private readonly observation = this._register(
		new MutableDisposable<IQueryObservation<ServerDataValue<C>, Failure<C>>>()
	);
	private readonly reaction = this._register(new MutableDisposable());
	private readonly changeEmitter = this._register(new Emitter<void>());
	/** The state or the data changed. */
	readonly onDidChange: Event<void> = this.changeEmitter.event;
	private current: PageReadState<Failure<C> | 'invalid'> = { kind: 'loading' };
	private value: D | undefined;

	constructor(
		private readonly serverData: IServerDataService,
		private readonly capability: C,
		private readonly intent: ServerDataCapabilities[C]['intent'],
		private readonly interpret: (answer: ServerDataValue<C>) => D | undefined
	) {
		super();
	}

	get state(): PageReadState<Failure<C> | 'invalid'> {
		return this.current;
	}

	get data(): D | undefined {
		return this.value;
	}

	/** Observes while the page is visible; a hidden page lets the observation go. */
	setActive(active: boolean): void {
		if (!active) {
			this.reaction.clear();
			this.observation.clear();
			return;
		}
		if (this.observation.value !== undefined) return;
		const observation = this.serverData.observe(this.capability, this.intent);
		this.observation.value = observation;
		this.reaction.value = autorun((reader) => {
			const state = observation.state.read(reader);
			const answer = observation.data.read(reader);
			const value = answer === undefined ? undefined : this.interpret(answer);
			this.value = value;
			this.current =
				answer !== undefined && value === undefined
					? { kind: 'failed', reason: 'invalid' }
					: state.kind === 'refreshing'
						? { kind: 'ready' }
						: state.kind === 'loading'
							? { kind: 'loading', slow: state.slow }
							: state;
			this.changeEmitter.fire();
		});
	}

	refresh(): Promise<void> {
		return this.observation.value?.refresh() ?? Promise.resolve();
	}
}
