import type {
	CandidatePrintCommandDenied,
	CandidatePrintCommandOrigin
} from '../common/candidatePrintCommandGate.js';

export type {
	CandidatePrintCommandDenied,
	CandidatePrintCommandOrigin
} from '../common/candidatePrintCommandGate.js';

export const MAX_CANDIDATE_PRINT_ATTEMPTS = Number.MAX_SAFE_INTEGER;

export type CandidatePrintCommandGateErrorCode =
	'print_gate_disposed' | 'print_sequence_exhausted' | 'print_denial_delivery_failed';

export class CandidatePrintCommandGateError extends Error {
	readonly code: CandidatePrintCommandGateErrorCode;

	constructor(code: CandidatePrintCommandGateErrorCode, options?: ErrorOptions) {
		super(code, options);
		this.name = 'CandidatePrintCommandGateError';
		this.code = code;
	}
}

/**
 * Electron-main effect for every Proctor-owned Candidate print entrypoint.
 * Callers do not receive an allow path: a registered command is denied and
 * reduced to a bounded origin plus local sequence, without content metadata.
 */
export class CandidatePrintCommandGate {
	readonly #onDenied: (attempt: CandidatePrintCommandDenied) => void;
	#sequence = 0;
	#disposed = false;

	constructor(onDenied: (attempt: CandidatePrintCommandDenied) => void) {
		this.#onDenied = onDenied;
	}

	deny(origin: CandidatePrintCommandOrigin): CandidatePrintCommandDenied {
		this.#assertActive();
		if (this.#sequence === MAX_CANDIDATE_PRINT_ATTEMPTS) {
			this.dispose();
			throw new CandidatePrintCommandGateError('print_sequence_exhausted');
		}
		const attempt = { sequence: ++this.#sequence, origin } as const;
		try {
			this.#onDenied(attempt);
		} catch (error) {
			this.dispose();
			throw new CandidatePrintCommandGateError('print_denial_delivery_failed', {
				cause: error
			});
		}
		return attempt;
	}

	dispose(): void {
		this.#disposed = true;
	}

	#assertActive(): void {
		if (this.#disposed) throw new CandidatePrintCommandGateError('print_gate_disposed');
	}
}
