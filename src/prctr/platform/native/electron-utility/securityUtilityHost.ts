import {
	SECURITY_UTILITY_HEARTBEAT_INTERVAL_MS,
	SECURITY_UTILITY_MAX_UNACKNOWLEDGED_MESSAGES,
	SECURITY_UTILITY_POLL_INTERVAL_MS,
	SECURITY_UTILITY_PROTOCOL_VERSION,
	SECURITY_UTILITY_SOURCE_MANIFEST,
	SECURITY_UTILITY_SOURCE_MANIFEST_VERSION,
	SECURITY_UTILITY_STARTUP_TIMEOUT_MS,
	isNativeBaselineOpenResult,
	isNativeBridgeManifest,
	isNativeSupervisorPoll,
	isNativeSupervisorStop,
	isSecurityUtilityMainMessage,
	type NativeBaselineDriver,
	type NativeSupervisorState,
	type CandidateWindowIngressOutcome,
	type SecurityUtilityBootstrap,
	type SecurityUtilityFailureCode,
	type SecurityUtilityMainMessage,
	type SecurityUtilityShutdown
} from '../common/securityUtilityProtocol.js';
import type { SecurityUtilityPort } from '../common/securityUtilityPort.js';

export interface SecurityUtilityHostOptions {
	readonly port: SecurityUtilityPort;
	readonly driver: NativeBaselineDriver;
	readonly buildIdentity: string;
	readonly terminate: (exitCode: number) => void;
	readonly diagnostic?: (code: string) => void;
}

export class SecurityUtilityHost {
	readonly #port: SecurityUtilityPort;
	readonly #driver: NativeBaselineDriver;
	readonly #buildIdentity: string;
	readonly #terminate: (exitCode: number) => void;
	readonly #diagnostic: ((code: string) => void) | undefined;
	readonly #disposables: { readonly dispose: () => void }[] = [];
	#startupTimer: ReturnType<typeof setTimeout> | undefined;
	#pollTimer: ReturnType<typeof setInterval> | undefined;
	#heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	#bootstrap: SecurityUtilityBootstrap | undefined;
	#nextIncomingSequence = 1;
	#nextOutgoingSequence = 1;
	#lastAcknowledgedOutgoingSequence = -1;
	#lastSupervisorState: NativeSupervisorState | undefined;
	#terminal = false;

	public constructor(options: SecurityUtilityHostOptions) {
		this.#port = options.port;
		this.#driver = options.driver;
		this.#buildIdentity = options.buildIdentity;
		this.#terminate = options.terminate;
		this.#diagnostic = options.diagnostic;
	}

	public start(): void {
		if (this.#startupTimer !== undefined || this.#terminal) {
			throw new Error('security utility host can start only once');
		}
		try {
			this.#disposables.push(this.#port.onMessage((message) => this.#accept(message)));
			this.#disposables.push(
				this.#port.onClose(() => this.#terminateWithoutRelease('port-closed'))
			);
			this.#port.start();
			this.#startupTimer = setTimeout(
				() => this.#terminateWithoutRelease('bootstrap-timeout'),
				SECURITY_UTILITY_STARTUP_TIMEOUT_MS
			);
		} catch {
			this.#terminateWithoutRelease('port-start-failed');
		}
	}

	#accept(value: unknown): void {
		if (this.#terminal) return;
		if (!isSecurityUtilityMainMessage(value)) {
			this.#fail('malformed_message');
			return;
		}
		if (this.#bootstrap === undefined) {
			if (value.kind !== 'bootstrap') {
				this.#terminateWithoutRelease('message-before-bootstrap');
				return;
			}
			this.#open(value);
			return;
		}
		if (value.kind === 'bootstrap') {
			this.#fail('duplicate_bootstrap');
			return;
		}
		if (value.participation_generation !== this.#bootstrap.participation_generation) {
			this.#fail('stale_generation');
			return;
		}
		if (value.message_sequence !== this.#nextIncomingSequence) {
			this.#fail('out_of_order_message');
			return;
		}
		this.#nextIncomingSequence += 1;
		this.#handleActiveMessage(value);
	}

	#open(bootstrap: SecurityUtilityBootstrap): void {
		if (
			bootstrap.build_identity !== this.#buildIdentity ||
			bootstrap.source_manifest_version !== SECURITY_UTILITY_SOURCE_MANIFEST_VERSION
		) {
			this.#terminateWithoutRelease('build-identity-mismatch');
			return;
		}
		let manifest: unknown;
		let opened: unknown;
		try {
			manifest = this.#driver.manifest();
			if (!isNativeBridgeManifest(manifest)) {
				this.#terminateWithoutRelease('native-bridge-manifest-invalid');
				return;
			}
			opened = this.#driver.openBaseline({
				collection_session_id: bootstrap.collection_session_id,
				queue_capacity: bootstrap.queue_capacity,
				selected_sources: bootstrap.selected_sources,
				selected_source_categories: bootstrap.selected_source_categories,
				initial_candidate_window: bootstrap.initial_candidate_window
			});
		} catch {
			this.#terminateWithoutRelease('native-open-failed');
			return;
		}
		if (!isNativeBaselineOpenResult(opened, bootstrap.selected_sources)) {
			this.#terminateWithoutRelease('native-open-result-invalid');
			return;
		}
		this.#bootstrap = bootstrap;
		if (this.#startupTimer !== undefined) clearTimeout(this.#startupTimer);
		this.#startupTimer = undefined;
		this.#post({
			kind: 'ready',
			protocol_version: SECURITY_UTILITY_PROTOCOL_VERSION,
			message_sequence: 0,
			challenge_response: bootstrap.challenge,
			build_identity: this.#buildIdentity,
			source_manifest_version: SECURITY_UTILITY_SOURCE_MANIFEST_VERSION,
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
			selected_sources: bootstrap.selected_sources,
			selected_source_categories: bootstrap.selected_source_categories,
			participation_generation: bootstrap.participation_generation,
			delivered_at_wall_time_unix_ms: Date.now(),
			snapshots: opened.snapshots
		});
		this.#pollTimer = setInterval(() => this.#poll(), SECURITY_UTILITY_POLL_INTERVAL_MS);
		this.#heartbeatTimer = setInterval(
			() => this.#heartbeat(),
			SECURITY_UTILITY_HEARTBEAT_INTERVAL_MS
		);
	}

	#handleActiveMessage(
		message: Exclude<SecurityUtilityMainMessage, SecurityUtilityBootstrap>
	): void {
		const bootstrap = this.#bootstrap;
		if (bootstrap === undefined) return;
		if (message.kind === 'acknowledge') {
			const lastSentSequence = this.#nextOutgoingSequence - 1;
			if (
				message.acknowledged_sequence <= this.#lastAcknowledgedOutgoingSequence ||
				message.acknowledged_sequence > lastSentSequence
			) {
				this.#fail('out_of_order_message');
				return;
			}
			this.#lastAcknowledgedOutgoingSequence = message.acknowledged_sequence;
			return;
		}
		if (
			message.kind === 'candidate_window_event' ||
			message.kind === 'candidate_window_events_lost'
		) {
			let outcome: unknown;
			try {
				outcome =
					message.kind === 'candidate_window_event'
						? this.#driver.candidateWindowEvent(message.event)
						: this.#driver.candidateWindowEventsLost(message.lost_count);
			} catch {
				this.#fail('native_ingress_overflow');
				return;
			}
			if (!isCandidateWindowIngressOutcome(outcome)) {
				this.#fail('native_ingress_overflow');
				return;
			}
			if (!this.#hasOutboundCapacity()) {
				this.#fail('outbound_backpressure');
				return;
			}
			this.#post({
				kind: 'candidate_window_ingress_result',
				protocol_version: SECURITY_UTILITY_PROTOCOL_VERSION,
				message_sequence: this.#takeOutgoingSequence(),
				participation_generation: bootstrap.participation_generation,
				input_sequence: message.message_sequence,
				outcome
			});
			return;
		}
		this.#shutdown(message.final_candidate_window);
	}

	#poll(): void {
		if (this.#terminal || this.#bootstrap === undefined) return;
		let poll: unknown;
		try {
			poll = this.#driver.pollBaseline();
		} catch {
			this.#fail('native_poll_failed');
			return;
		}
		if (!isNativeSupervisorPoll(poll)) {
			this.#fail('native_poll_failed');
			return;
		}
		const stateChanged = poll.state !== this.#lastSupervisorState;
		this.#lastSupervisorState = poll.state;
		if (
			!stateChanged &&
			poll.opened_snapshots.length === 0 &&
			poll.final_snapshots.length === 0 &&
			poll.batches.length === 0 &&
			poll.transitions.length === 0
		)
			return;
		if (!this.#hasOutboundCapacity()) {
			this.#fail('outbound_backpressure');
			return;
		}
		this.#post({
			kind: 'native_poll',
			protocol_version: SECURITY_UTILITY_PROTOCOL_VERSION,
			message_sequence: this.#takeOutgoingSequence(),
			participation_generation: this.#bootstrap.participation_generation,
			delivered_at_wall_time_unix_ms: Date.now(),
			poll
		});
	}

	#heartbeat(): void {
		if (this.#terminal || this.#bootstrap === undefined) return;
		if (!this.#hasOutboundCapacity()) {
			this.#fail('outbound_backpressure');
			return;
		}
		this.#post({
			kind: 'heartbeat',
			protocol_version: SECURITY_UTILITY_PROTOCOL_VERSION,
			message_sequence: this.#takeOutgoingSequence(),
			participation_generation: this.#bootstrap.participation_generation,
			monotonic_time_ms: Math.floor(performance.now())
		});
	}

	#shutdown(finalCandidateWindow: SecurityUtilityShutdown['final_candidate_window']): void {
		if (this.#bootstrap === undefined) return;
		this.#stopTimers();
		let result: unknown;
		try {
			result = this.#driver.stopBaseline(finalCandidateWindow);
		} catch {
			this.#fail('native_stop_failed');
			return;
		}
		if (!isNativeSupervisorStop(result)) {
			this.#fail('native_stop_failed');
			return;
		}
		this.#terminal = true;
		this.#post({
			kind: 'stopped',
			protocol_version: SECURITY_UTILITY_PROTOCOL_VERSION,
			message_sequence: this.#takeOutgoingSequence(),
			participation_generation: this.#bootstrap.participation_generation,
			result
		});
		this.#disposePortLater(0);
	}

	#fail(code: SecurityUtilityFailureCode): void {
		if (this.#terminal) return;
		this.#terminal = true;
		this.#stopTimers();
		if (this.#bootstrap !== undefined) {
			this.#post({
				kind: 'fatal',
				protocol_version: SECURITY_UTILITY_PROTOCOL_VERSION,
				message_sequence: this.#takeOutgoingSequence(),
				participation_generation: this.#bootstrap.participation_generation,
				code
			});
		}
		this.#disposePortLater(70);
	}

	#terminateWithoutRelease(code: string): void {
		if (this.#terminal) return;
		this.#terminal = true;
		this.#stopTimers();
		this.#diagnostic?.(code);
		this.#disposePortLater(70);
	}

	#post(message: unknown): void {
		try {
			this.#port.postMessage(message);
		} catch {
			this.#terminateWithoutRelease('port-send-failed');
		}
	}

	#takeOutgoingSequence(): number {
		const sequence = this.#nextOutgoingSequence;
		this.#nextOutgoingSequence += 1;
		return sequence;
	}

	#hasOutboundCapacity(): boolean {
		const outstanding = this.#nextOutgoingSequence - 1 - this.#lastAcknowledgedOutgoingSequence;
		return outstanding < SECURITY_UTILITY_MAX_UNACKNOWLEDGED_MESSAGES;
	}

	#stopTimers(): void {
		if (this.#startupTimer !== undefined) clearTimeout(this.#startupTimer);
		if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
		if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
		this.#startupTimer = undefined;
		this.#pollTimer = undefined;
		this.#heartbeatTimer = undefined;
	}

	#disposePortLater(exitCode: number): void {
		setTimeout(() => {
			try {
				for (const disposable of this.#disposables.splice(0)) {
					try {
						disposable.dispose();
					} catch {
						// Process termination remains the final ownership fence.
					}
				}
			} finally {
				try {
					this.#port.close();
				} finally {
					this.#terminate(exitCode);
				}
			}
		}, 0);
	}
}

function isCandidateWindowIngressOutcome(value: unknown): value is CandidateWindowIngressOutcome {
	return value === 'accepted' || value === 'dropped' || value === 'stopped';
}
