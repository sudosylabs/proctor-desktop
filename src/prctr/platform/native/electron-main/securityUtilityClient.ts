import {
	SECURITY_UTILITY_HEARTBEAT_TIMEOUT_MS,
	SECURITY_UTILITY_MAX_LOST_EVENT_COUNT,
	SECURITY_UTILITY_SHUTDOWN_TIMEOUT_MS,
	SECURITY_UTILITY_SOURCE_MANIFEST,
	SECURITY_UTILITY_STARTUP_TIMEOUT_MS,
	isSecurityUtilityChildMessage,
	type NativeSupervisorPoll,
	type NativeSupervisorStop,
	type NativeSourceId,
	type NativeSourceCategory,
	type SecurityUtilityBootstrap,
	type SecurityUtilityReady
} from '../common/securityUtilityProtocol.js';
import type {
	CandidateWindowHostEvent,
	CandidateWindowState
} from '../common/nativeObservation.generated.js';
import type { SecurityUtilityPort } from '../common/securityUtilityPort.js';

export type SecurityUtilityClientFailure =
	| 'startup_timeout'
	| 'heartbeat_timeout'
	| 'shutdown_timeout'
	| 'malformed_message'
	| 'unexpected_message'
	| 'stale_generation'
	| 'out_of_order_message'
	| 'utility_fatal'
	| 'poll_delivery_failed'
	| 'candidate_ingress_overflow'
	| 'candidate_ingress_stopped'
	| 'port_closed'
	| 'environment_interrupted'
	| 'process_error'
	| 'process_exit';

export interface SecurityUtilityClientOptions {
	readonly port: SecurityUtilityPort;
	readonly challenge: string;
	readonly buildIdentity: string;
	readonly participationGeneration: string;
	readonly collectionSessionId: string;
	readonly queueCapacity: number;
	readonly selectedSources: readonly NativeSourceId[];
	readonly selectedSourceCategories: readonly NativeSourceCategory[];
	readonly initialCandidateWindow: CandidateWindowState;
	readonly onPoll: (poll: NativeSupervisorPoll) => void;
	readonly onFailure: (failure: SecurityUtilityClientFailure) => void;
}

type ClientState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
type PendingCandidateIngress =
	| { readonly kind: 'event'; readonly event: CandidateWindowHostEvent }
	| { readonly kind: 'events_lost'; readonly lostCount: number };

export class SecurityUtilityClient {
	readonly #port: SecurityUtilityPort;
	readonly #bootstrap: SecurityUtilityBootstrap;
	readonly #onPoll: (poll: NativeSupervisorPoll) => void;
	readonly #onFailure: (failure: SecurityUtilityClientFailure) => void;
	readonly #candidateIngressCapacity: number;
	readonly #disposables: { readonly dispose: () => void }[] = [];
	readonly #pendingCandidateIngress: PendingCandidateIngress[] = [];
	#state: ClientState = 'created';
	#nextOutgoingSequence = 1;
	#nextIncomingSequence = 1;
	#lastHeartbeatAtMonotonicMs = 0;
	#candidateIngressInputSequence: number | undefined;
	#pendingShutdownFinalState: CandidateWindowState | undefined;
	#shutdownPosted = false;
	#startupTimer: ReturnType<typeof setTimeout> | undefined;
	#heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	#shutdownTimer: ReturnType<typeof setTimeout> | undefined;
	#startResolve: ((ready: SecurityUtilityReady) => void) | undefined;
	#startReject: ((error: Error) => void) | undefined;
	#shutdownResolve: ((result: NativeSupervisorStop) => void) | undefined;
	#shutdownReject: ((error: Error) => void) | undefined;

	public constructor(options: SecurityUtilityClientOptions) {
		this.#port = options.port;
		this.#bootstrap = {
			kind: 'bootstrap',
			challenge: options.challenge,
			build_identity: options.buildIdentity,
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
			participation_generation: options.participationGeneration,
			collection_session_id: options.collectionSessionId,
			queue_capacity: options.queueCapacity,
			selected_sources: Object.freeze([...options.selectedSources]),
			selected_source_categories: Object.freeze([...options.selectedSourceCategories]),
			initial_candidate_window: options.initialCandidateWindow
		};
		this.#onPoll = options.onPoll;
		this.#onFailure = options.onFailure;
		this.#candidateIngressCapacity = options.queueCapacity;
	}

	public start(
		startupTimeoutMs: number = SECURITY_UTILITY_STARTUP_TIMEOUT_MS
	): Promise<SecurityUtilityReady> {
		if (this.#state !== 'created')
			return Promise.reject(new Error('security utility client can start only once'));
		if (
			!Number.isSafeInteger(startupTimeoutMs) ||
			startupTimeoutMs <= 0 ||
			startupTimeoutMs > SECURITY_UTILITY_STARTUP_TIMEOUT_MS
		) {
			return Promise.reject(
				new Error('security utility startup timeout is outside its bound')
			);
		}
		this.#state = 'starting';
		const started = new Promise<SecurityUtilityReady>((resolve, reject) => {
			this.#startResolve = resolve;
			this.#startReject = reject;
		});
		try {
			this.#disposables.push(this.#port.onMessage((message) => this.#accept(message)));
			this.#disposables.push(
				this.#port.onClose(() => {
					if (this.#state !== 'stopped') this.abort('port_closed');
				})
			);
			this.#port.start();
			this.#startupTimer = setTimeout(() => this.abort('startup_timeout'), startupTimeoutMs);
			this.#port.postMessage(this.#bootstrap);
		} catch {
			this.abort('port_closed');
		}
		return started;
	}

	public sendCandidateWindowEvent(event: CandidateWindowHostEvent): void {
		if (this.#state !== 'ready') throw new Error('security utility is not ready');
		this.#enqueueCandidateWindowEvent(event);
		this.#flushCandidateIngress();
	}

	public shutdown(finalCandidateWindow: CandidateWindowState): Promise<NativeSupervisorStop> {
		if (this.#state !== 'ready')
			return Promise.reject(new Error('security utility is not ready'));
		this.#state = 'stopping';
		this.#pendingShutdownFinalState = finalCandidateWindow;
		this.#compactCandidateIngressForShutdown();
		const stopped = new Promise<NativeSupervisorStop>((resolve, reject) => {
			this.#shutdownResolve = resolve;
			this.#shutdownReject = reject;
		});
		this.#shutdownTimer = setTimeout(
			() => this.abort('shutdown_timeout'),
			SECURITY_UTILITY_SHUTDOWN_TIMEOUT_MS
		);
		this.#flushCandidateIngress();
		return stopped;
	}

	public abort(failure: SecurityUtilityClientFailure): void {
		if (this.#state === 'failed' || this.#state === 'stopped') return;
		this.#state = 'failed';
		this.#clearTimers();
		const error = new Error(`security utility failed: ${failure}`);
		this.#startReject?.(error);
		this.#shutdownReject?.(error);
		this.#startResolve = undefined;
		this.#startReject = undefined;
		this.#shutdownResolve = undefined;
		this.#shutdownReject = undefined;
		this.#disposePort();
		this.#onFailure(failure);
	}

	#accept(value: unknown): void {
		if (this.#state === 'failed' || this.#state === 'stopped') return;
		if (!isSecurityUtilityChildMessage(value)) {
			this.abort('malformed_message');
			return;
		}
		if (this.#state === 'starting') {
			if (value.kind !== 'ready') {
				this.abort('unexpected_message');
				return;
			}
			this.#acceptReady(value);
			return;
		}
		if (value.kind === 'ready') {
			this.abort('unexpected_message');
			return;
		}
		if (value.participation_generation !== this.#bootstrap.participation_generation) {
			this.abort('stale_generation');
			return;
		}
		if (value.message_sequence !== this.#nextIncomingSequence) {
			this.abort('out_of_order_message');
			return;
		}
		this.#nextIncomingSequence += 1;
		if (value.kind === 'fatal') {
			this.abort('utility_fatal');
		} else if (value.kind === 'native_poll') {
			if (this.#state !== 'ready' && this.#state !== 'stopping') {
				this.abort('unexpected_message');
			} else if (!pollMatchesSelection(value.poll, this.#bootstrap.selected_sources)) {
				this.abort('unexpected_message');
			} else {
				try {
					this.#onPoll(value.poll);
				} catch {
					this.abort('poll_delivery_failed');
					return;
				}
				this.#acknowledge(value.message_sequence);
			}
		} else if (value.kind === 'candidate_window_ingress_result') {
			if (
				(this.#state !== 'ready' && this.#state !== 'stopping') ||
				value.input_sequence !== this.#candidateIngressInputSequence
			) {
				this.abort('unexpected_message');
				return;
			}
			this.#candidateIngressInputSequence = undefined;
			if (value.outcome === 'stopped') {
				this.abort('candidate_ingress_stopped');
				return;
			}
			this.#acknowledge(value.message_sequence);
			this.#flushCandidateIngress();
		} else if (value.kind === 'stopped') {
			if (this.#state !== 'stopping') {
				this.abort('unexpected_message');
				return;
			}
			if (!stopMatchesSelection(value.result, this.#bootstrap.selected_sources)) {
				this.abort('unexpected_message');
				return;
			}
			this.#state = 'stopped';
			this.#clearTimers();
			this.#shutdownResolve?.(value.result);
			this.#shutdownResolve = undefined;
			this.#shutdownReject = undefined;
			this.#disposePort();
		} else if (this.#state !== 'ready' && this.#state !== 'stopping') {
			this.abort('unexpected_message');
		} else {
			this.#lastHeartbeatAtMonotonicMs = performance.now();
			this.#acknowledge(value.message_sequence);
		}
	}

	#acceptReady(ready: SecurityUtilityReady): void {
		if (
			ready.challenge_response !== this.#bootstrap.challenge ||
			ready.build_identity !== this.#bootstrap.build_identity ||
			ready.participation_generation !== this.#bootstrap.participation_generation ||
			!sameOrderedSelection(ready.selected_sources, this.#bootstrap.selected_sources) ||
			!sameOrderedSelection(
				ready.selected_source_categories,
				this.#bootstrap.selected_source_categories
			)
		) {
			this.abort('unexpected_message');
			return;
		}
		if (this.#startupTimer !== undefined) clearTimeout(this.#startupTimer);
		this.#startupTimer = undefined;
		this.#state = 'ready';
		this.#lastHeartbeatAtMonotonicMs = performance.now();
		this.#heartbeatTimer = setInterval(() => {
			if (
				performance.now() - this.#lastHeartbeatAtMonotonicMs >
				SECURITY_UTILITY_HEARTBEAT_TIMEOUT_MS
			) {
				this.abort('heartbeat_timeout');
			}
		}, SECURITY_UTILITY_HEARTBEAT_TIMEOUT_MS / 2);
		this.#acknowledge(ready.message_sequence);
		this.#startResolve?.(ready);
		this.#startResolve = undefined;
		this.#startReject = undefined;
	}

	#post(message: unknown): void {
		try {
			this.#port.postMessage(message);
		} catch {
			this.abort('port_closed');
		}
	}

	#enqueueCandidateWindowEvent(event: CandidateWindowHostEvent): void {
		if (this.#pendingCandidateIngress.length < this.#candidateIngressCapacity) {
			this.#pendingCandidateIngress.push({ kind: 'event', event });
			return;
		}
		const tailIndex = this.#pendingCandidateIngress.length - 1;
		const tail = this.#pendingCandidateIngress[tailIndex];
		if (tail?.kind === 'events_lost') {
			if (tail.lostCount === SECURITY_UTILITY_MAX_LOST_EVENT_COUNT) {
				this.abort('candidate_ingress_overflow');
				return;
			}
			this.#pendingCandidateIngress[tailIndex] = {
				kind: 'events_lost',
				lostCount: tail.lostCount + 1
			};
			return;
		}
		this.#pendingCandidateIngress[tailIndex] = { kind: 'events_lost', lostCount: 2 };
	}

	#flushCandidateIngress(): void {
		if (
			(this.#state !== 'ready' && this.#state !== 'stopping') ||
			this.#candidateIngressInputSequence !== undefined
		)
			return;
		const pending = this.#pendingCandidateIngress.shift();
		if (pending !== undefined) {
			const inputSequence = this.#takeOutgoingSequence();
			this.#candidateIngressInputSequence = inputSequence;
			this.#post(
				pending.kind === 'event'
					? {
							kind: 'candidate_window_event',
							participation_generation: this.#bootstrap.participation_generation,
							message_sequence: inputSequence,
							event: pending.event
						}
					: {
							kind: 'candidate_window_events_lost',
							participation_generation: this.#bootstrap.participation_generation,
							message_sequence: inputSequence,
							lost_count: pending.lostCount
						}
			);
			return;
		}
		if (
			this.#state !== 'stopping' ||
			this.#shutdownPosted ||
			this.#pendingShutdownFinalState === undefined
		)
			return;
		this.#shutdownPosted = true;
		const finalCandidateWindow = this.#pendingShutdownFinalState;
		this.#pendingShutdownFinalState = undefined;
		if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
		this.#heartbeatTimer = undefined;
		this.#post({
			kind: 'shutdown',
			participation_generation: this.#bootstrap.participation_generation,
			message_sequence: this.#takeOutgoingSequence(),
			final_candidate_window: finalCandidateWindow
		});
	}

	#compactCandidateIngressForShutdown(): void {
		let lostCount = 0;
		for (const pending of this.#pendingCandidateIngress) {
			lostCount += pending.kind === 'event' ? 1 : pending.lostCount;
		}
		this.#pendingCandidateIngress.length = 0;
		while (lostCount > 0) {
			const chunk = Math.min(lostCount, SECURITY_UTILITY_MAX_LOST_EVENT_COUNT);
			this.#pendingCandidateIngress.push({ kind: 'events_lost', lostCount: chunk });
			lostCount -= chunk;
		}
	}

	#takeOutgoingSequence(): number {
		const sequence = this.#nextOutgoingSequence;
		this.#nextOutgoingSequence += 1;
		return sequence;
	}

	#acknowledge(sequence: number): void {
		this.#post({
			kind: 'acknowledge',
			participation_generation: this.#bootstrap.participation_generation,
			message_sequence: this.#takeOutgoingSequence(),
			acknowledged_sequence: sequence
		});
	}

	#clearTimers(): void {
		if (this.#startupTimer !== undefined) clearTimeout(this.#startupTimer);
		if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
		if (this.#shutdownTimer !== undefined) clearTimeout(this.#shutdownTimer);
		this.#startupTimer = undefined;
		this.#heartbeatTimer = undefined;
		this.#shutdownTimer = undefined;
	}

	#disposePort(): void {
		for (const disposable of this.#disposables.splice(0)) {
			try {
				disposable.dispose();
			} catch {
				// Continue fencing the remaining listeners and the underlying port.
			}
		}
		try {
			this.#port.close();
		} catch {
			// The connection is already terminal and its owning utility process is
			// killed by the failure callback; a close error cannot be recovered.
		}
	}
}

function sameOrderedSelection(actual: readonly string[], expected: readonly string[]): boolean {
	return (
		actual.length === expected.length &&
		actual.every((value, index) => expected[index] === value)
	);
}

function pollMatchesSelection(
	poll: NativeSupervisorPoll,
	selectedSources: readonly NativeSourceId[]
): boolean {
	return (
		poll.opened_snapshots.every((snapshot) => selectedSources.includes(snapshot.source)) &&
		poll.final_snapshots.every((snapshot) => selectedSources.includes(snapshot.source)) &&
		poll.batches.every((batch) => selectedSources.includes(batch.source)) &&
		poll.transitions.every((transition) => selectedSources.includes(transition.source))
	);
}

function stopMatchesSelection(
	stop: NativeSupervisorStop,
	selectedSources: readonly NativeSourceId[]
): boolean {
	return (
		stop.final_snapshots.every((snapshot) => selectedSources.includes(snapshot.source)) &&
		stop.batches.every((batch) => selectedSources.includes(batch.source))
	);
}
