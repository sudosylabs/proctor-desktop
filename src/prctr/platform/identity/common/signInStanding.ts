/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	projectionFlag,
	projectionMember,
	projectionRecord
} from '../../serverApi/common/projection.js';

export const signInMethods = ['password', 'oidc', 'cas'] as const;
export type SignInMethod = (typeof signInMethods)[number];

/**
 * How the bound Session stands for changes the institution guards, as the server reports it.
 * Presentation only: the server still decides every request.
 */
export interface SignInStanding {
	/** The one method Confirm it's you accepts: the method this Session signed in with. */
	readonly method: SignInMethod;
	/** This Session passed two-step verification. */
	readonly multiFactor: boolean;
	/** This installation offers two-step verification at all. */
	readonly twoStepOffered: boolean;
	/** Two-step verification is on for the person's account. */
	readonly twoStepOn: boolean;
	/** Confirm it's you can raise this single-factor Session with the account's own code. */
	readonly canRaise: boolean;
}

/**
 * What a change that needs a two-step sign-in meets with this standing: `ready` goes on,
 * `confirm` goes through Confirm it's you (which asks for the code), `turnOn` needs two-step
 * verification on the account first, and `unavailable` can't be made on this installation.
 */
export type StrongSignInStep = 'ready' | 'confirm' | 'turnOn' | 'unavailable';

export function strongSignInStep(standing: SignInStanding): StrongSignInStep {
	if (standing.multiFactor) return 'ready';
	if (!standing.twoStepOffered) return 'unavailable';
	return standing.canRaise ? 'confirm' : 'turnOn';
}

/** Whether Confirm it's you will also ask for the authenticator code. */
export function confirmAsksForCode(standing: SignInStanding): boolean {
	return !standing.multiFactor && standing.canRaise;
}

/** Checks a standing crossing a process boundary; exact fields only. */
export function validateSignInStanding(value: unknown): SignInStanding {
	const s = projectionRecord(value);
	if (Object.keys(s).sort().join() !== 'canRaise,method,multiFactor,twoStepOffered,twoStepOn')
		throw new TypeError('Invalid sign-in standing');
	return Object.freeze({
		method: projectionMember(s.method, signInMethods),
		multiFactor: projectionFlag(s.multiFactor),
		twoStepOffered: projectionFlag(s.twoStepOffered),
		twoStepOn: projectionFlag(s.twoStepOn),
		canRaise: projectionFlag(s.canRaise)
	});
}

/** Reads the standing from the server's two-step status of the current Session. */
export function signInStandingFromServer(mfa: unknown): SignInStanding {
	const m = projectionRecord(mfa);
	return validateSignInStanding({
		method: m.authentication_method,
		multiFactor:
			projectionMember(m.authentication_strength, ['single_factor', 'multi_factor']) ===
			'multi_factor',
		twoStepOffered: m.service_enabled,
		twoStepOn: m.enabled,
		canRaise: m.can_raise_strength
	});
}
