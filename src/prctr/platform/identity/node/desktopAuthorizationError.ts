/** Bounded reasons only: never attach network responses, codes, proofs, or credentials. */
export class DesktopAuthorizationError extends Error {
	constructor(
		readonly reason:
			| 'cancelled'
			| 'timedOut'
			| 'callbackInvalid'
			| 'unavailable'
			| 'rejected'
			| 'verificationRequired'
			| 'storageUnavailable'
			/** The institution requires two-step verification and the person has none yet. */
			| 'twoStepSetupRequired'
	) {
		super(`Desktop authorization ${reason}`);
		this.name = 'DesktopAuthorizationError';
	}
}
