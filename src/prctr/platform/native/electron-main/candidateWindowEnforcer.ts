import type {
	CandidateWindowHostEvent,
	CandidateWindowState,
	PlatformFamily
} from '../common/nativeObservation.generated.js';

export type CandidateWindowContentProtection = 'enabled' | 'failed' | 'unavailable';

export interface CandidateWindowConstraintVerification {
	readonly alwaysOnTopDisabled: boolean;
	readonly closePrevented: boolean;
	readonly contentProtection: CandidateWindowContentProtection;
	readonly fullscreenPrevented: boolean;
	readonly kioskDisabled: boolean;
	readonly maximized: boolean;
	readonly maximizePrevented: boolean;
	readonly menuHidden: boolean;
	readonly minimizePrevented: boolean;
	readonly movePrevented: boolean;
	readonly nativeControlsAbsent: boolean;
	readonly resizePrevented: boolean;
}

export interface CandidateWindowEnforcementReceipt {
	readonly participationGeneration: string;
	readonly platform: PlatformFamily;
	readonly verifiedAtMonotonicMs: number;
	readonly constraints: CandidateWindowConstraintVerification;
	readonly window: CandidateWindowState;
}

export type CandidateWindowEnforcementFailure =
	'constraint_drift' | 'event_delivery_failed' | 'unexpected_window_destruction';

export type CandidateWindowEnforcementErrorCode =
	| 'already_prepared'
	| 'constraint_verification_failed'
	| 'event_delivery_unavailable'
	| 'invalid_participation_generation'
	| 'not_prepared'
	| 'prepare_failed'
	| 'release_failed'
	| 'stale_participation_generation'
	| 'window_unavailable'
	| 'window_verification_failed';

export interface CandidateWindowEnforcementHost {
	readonly platform: PlatformFamily;
	applyConstraints(): void;
	verifyConstraints(): CandidateWindowConstraintVerification;
	snapshot(): CandidateWindowState;
	isValidWindowState(value: unknown): value is CandidateWindowState;
	onEnforcementFailure(listener: () => void): { readonly dispose: () => void };
	onStateTransition(listener: () => void): { readonly dispose: () => void };
	onCloseAttempt(listener: () => void): { readonly dispose: () => void };
	onDestroyed(listener: () => void): { readonly dispose: () => void };
	releaseWindow(): void;
	completeRelease(): void;
}

export interface CandidateWindowEnforcerOptions {
	readonly host: CandidateWindowEnforcementHost;
	readonly onEvent: (event: CandidateWindowHostEvent) => void;
	readonly onFailure: (failure: CandidateWindowEnforcementFailure) => void;
	readonly monotonicNow?: () => number;
}

type EnforcerState = 'created' | 'preparing' | 'prepared' | 'blocked' | 'releasing' | 'released';

export class CandidateWindowEnforcementError extends Error {
	public readonly code: CandidateWindowEnforcementErrorCode;
	public readonly failedConstraints: readonly (keyof CandidateWindowConstraintVerification)[];

	public constructor(
		code: CandidateWindowEnforcementErrorCode,
		failedConstraints: readonly (keyof CandidateWindowConstraintVerification)[] = [],
		options?: ErrorOptions
	) {
		super(
			`candidate window enforcement failed: ${code}${
				failedConstraints.length === 0 ? '' : ` (${failedConstraints.join(', ')})`
			}`,
			options
		);
		this.name = 'CandidateWindowEnforcementError';
		this.code = code;
		this.failedConstraints = Object.freeze([...failedConstraints]);
	}
}

export class CandidateWindowEnforcer {
	readonly #host: CandidateWindowEnforcementHost;
	readonly #onEvent: (event: CandidateWindowHostEvent) => void;
	readonly #onFailure: (failure: CandidateWindowEnforcementFailure) => void;
	readonly #monotonicNow: () => number;
	readonly #disposables: { readonly dispose: () => void }[] = [];
	readonly #reportedFailures = new Set<CandidateWindowEnforcementFailure>();
	#state: EnforcerState = 'created';
	#participationGeneration: string | undefined;
	#releasedWindow: CandidateWindowState | undefined;

	public constructor(options: CandidateWindowEnforcerOptions) {
		this.#host = options.host;
		this.#onEvent = options.onEvent;
		this.#onFailure = options.onFailure;
		this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
	}

	public prepare(participationGeneration: string): CandidateWindowEnforcementReceipt {
		if (!isValidParticipationGeneration(participationGeneration)) {
			throw new CandidateWindowEnforcementError('invalid_participation_generation');
		}
		if (this.#state !== 'created') {
			throw new CandidateWindowEnforcementError('already_prepared');
		}

		this.#state = 'preparing';
		this.#participationGeneration = participationGeneration;
		try {
			this.#register(this.#host.onEnforcementFailure(() => this.#acceptEnforcementFailure()));
			this.#register(this.#host.onStateTransition(() => this.#acceptStateTransition()));
			this.#register(this.#host.onCloseAttempt(() => this.#emit({ kind: 'close_attempt' })));
			this.#register(this.#host.onDestroyed(() => this.#acceptDestroyed()));
			this.#host.applyConstraints();
			const receipt = this.#verifiedReceipt();
			if (this.#reportedFailures.size > 0) {
				throw new CandidateWindowEnforcementError('prepare_failed');
			}
			this.#state = 'prepared';
			return receipt;
		} catch (error) {
			this.#state = 'blocked';
			if (error instanceof CandidateWindowEnforcementError) throw error;
			throw new CandidateWindowEnforcementError('prepare_failed', [], { cause: error });
		}
	}

	public verify(participationGeneration: string): CandidateWindowEnforcementReceipt {
		this.#assertCurrentGeneration(participationGeneration);
		if (this.#state !== 'prepared' && this.#state !== 'blocked') {
			throw new CandidateWindowEnforcementError('not_prepared');
		}
		if (this.#reportedFailures.has('event_delivery_failed')) {
			throw new CandidateWindowEnforcementError('event_delivery_unavailable');
		}
		if (this.#reportedFailures.has('unexpected_window_destruction')) {
			throw new CandidateWindowEnforcementError('window_unavailable');
		}
		try {
			const receipt = this.#verifiedReceipt();
			if (this.#state === 'blocked') {
				this.#state = 'prepared';
				this.#reportedFailures.delete('constraint_drift');
			}
			return receipt;
		} catch (error) {
			this.#state = 'blocked';
			this.#signalFailure('constraint_drift');
			if (error instanceof CandidateWindowEnforcementError) throw error;
			throw new CandidateWindowEnforcementError('constraint_verification_failed', [], {
				cause: error
			});
		}
	}

	public release(participationGeneration: string): CandidateWindowState {
		this.#assertCurrentGeneration(participationGeneration);
		if (this.#state === 'released') return this.#releasedWindow as CandidateWindowState;
		if (this.#state !== 'prepared' && this.#state !== 'blocked') {
			throw new CandidateWindowEnforcementError('not_prepared');
		}

		this.#state = 'releasing';
		try {
			this.#host.releaseWindow();
			const releasedWindow = this.#host.snapshot();
			if (
				!this.#host.isValidWindowState(releasedWindow) ||
				!isCompleteAbsentWindow(releasedWindow)
			) {
				throw new CandidateWindowEnforcementError('release_failed');
			}
			this.#releasedWindow = releasedWindow;
			if (!this.#disposeListeners()) {
				throw new CandidateWindowEnforcementError('release_failed');
			}
			this.#host.completeRelease();
			this.#state = 'released';
			return this.#releasedWindow;
		} catch (error) {
			this.#state = 'blocked';
			if (error instanceof CandidateWindowEnforcementError) throw error;
			throw new CandidateWindowEnforcementError('release_failed', [], { cause: error });
		}
	}

	#verifiedReceipt(
		window: CandidateWindowState = this.#host.snapshot(),
		schemaValidated = false
	): CandidateWindowEnforcementReceipt {
		if (
			(!schemaValidated && !this.#host.isValidWindowState(window)) ||
			!isCompleteCandidateWindow(window)
		) {
			throw new CandidateWindowEnforcementError('window_verification_failed');
		}
		const constraints = this.#host.verifyConstraints();
		const failedConstraints = incompleteConstraints(constraints);
		if (failedConstraints.length > 0) {
			throw new CandidateWindowEnforcementError(
				'constraint_verification_failed',
				failedConstraints
			);
		}
		return Object.freeze({
			participationGeneration: this.#participationGeneration as string,
			platform: this.#host.platform,
			verifiedAtMonotonicMs: this.#monotonicNow(),
			constraints: Object.freeze({ ...constraints }),
			window
		});
	}

	#acceptStateTransition(): void {
		if (this.#state === 'released' || this.#state === 'releasing') return;
		const snapshot = this.#boundedSnapshot();
		if (!snapshot.valid) {
			this.#state = 'blocked';
			this.#signalFailure('constraint_drift');
		}
		this.#emit({ kind: 'state_transition', window: snapshot.window });
		if (!snapshot.valid) return;
		if (this.#state !== 'prepared' && this.#state !== 'blocked') return;
		try {
			this.#verifiedReceipt(snapshot.window, true);
		} catch {
			this.#state = 'blocked';
			this.#signalFailure('constraint_drift');
		}
	}

	#acceptDestroyed(): void {
		if (this.#state === 'releasing' || this.#state === 'released') return;
		this.#state = 'blocked';
		const snapshot = this.#boundedSnapshot();
		if (!snapshot.valid) this.#signalFailure('constraint_drift');
		this.#emit({ kind: 'state_transition', window: snapshot.window });
		this.#signalFailure('unexpected_window_destruction');
	}

	#acceptEnforcementFailure(): void {
		if (this.#state === 'releasing' || this.#state === 'released') return;
		this.#state = 'blocked';
		this.#signalFailure('constraint_drift');
	}

	#emit(event: CandidateWindowHostEvent): void {
		try {
			this.#onEvent(event);
		} catch {
			if (this.#state === 'prepared' || this.#state === 'preparing') this.#state = 'blocked';
			this.#signalFailure('event_delivery_failed');
		}
	}

	#signalFailure(failure: CandidateWindowEnforcementFailure): void {
		if (this.#reportedFailures.has(failure)) return;
		this.#reportedFailures.add(failure);
		try {
			this.#onFailure(failure);
		} catch {
			// Failure reporting must never escape an Electron event callback.
		}
	}

	#assertCurrentGeneration(participationGeneration: string): void {
		if (this.#participationGeneration === undefined) {
			throw new CandidateWindowEnforcementError('not_prepared');
		}
		if (participationGeneration !== this.#participationGeneration) {
			throw new CandidateWindowEnforcementError('stale_participation_generation');
		}
	}

	#register(disposable: { readonly dispose: () => void }): void {
		this.#disposables.push(disposable);
	}

	#boundedSnapshot(): { readonly valid: boolean; readonly window: CandidateWindowState } {
		try {
			const window = this.#host.snapshot();
			if (this.#host.isValidWindowState(window)) return { valid: true, window };
		} catch {
			// Invalid native data and snapshot failures share one bounded blocked projection.
		}
		return { valid: false, window: unknownWindowState() };
	}

	#disposeListeners(): boolean {
		while (this.#disposables.length > 0) {
			const disposable = this.#disposables[this.#disposables.length - 1];
			try {
				disposable?.dispose();
				this.#disposables.pop();
			} catch {
				return false;
			}
		}
		return true;
	}
}

function isCompleteCandidateWindow(window: CandidateWindowState): boolean {
	return (
		window.certainty === 'complete' &&
		window.presence === 'present' &&
		window.focus !== 'unknown' &&
		window.visibility !== 'unknown' &&
		window.placement === 'maximized' &&
		window.bounds !== undefined &&
		window.display_target_id !== undefined
	);
}

function isCompleteAbsentWindow(window: CandidateWindowState): boolean {
	return window.certainty === 'complete' && window.presence === 'absent';
}

function unknownWindowState(): CandidateWindowState {
	return Object.freeze({
		certainty: 'unknown',
		presence: 'unknown',
		focus: 'unknown',
		visibility: 'unknown',
		placement: 'unknown'
	});
}

function incompleteConstraints(
	constraints: CandidateWindowConstraintVerification
): readonly (keyof CandidateWindowConstraintVerification)[] {
	const failures: (keyof CandidateWindowConstraintVerification)[] = [];
	for (const key of [
		'alwaysOnTopDisabled',
		'closePrevented',
		'fullscreenPrevented',
		'kioskDisabled',
		'maximized',
		'maximizePrevented',
		'menuHidden',
		'minimizePrevented',
		'movePrevented',
		'nativeControlsAbsent',
		'resizePrevented'
	] as const) {
		if (!constraints[key]) failures.push(key);
	}
	if (constraints.contentProtection === 'failed') failures.push('contentProtection');
	return failures;
}

function isValidParticipationGeneration(value: string): boolean {
	return isBoundedNonEmptyString(value) && countCodePoints(value) >= 16;
}

function isBoundedNonEmptyString(value: string): boolean {
	const length = countCodePoints(value);
	return length > 0 && length <= 128;
}

function countCodePoints(value: string): number {
	let length = 0;
	for (const _codePoint of value) {
		length += 1;
		if (length > 128) return length;
	}
	return length;
}
