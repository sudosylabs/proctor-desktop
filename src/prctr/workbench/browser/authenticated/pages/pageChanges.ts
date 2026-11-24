/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { SignInStanding } from '../../../../platform/identity/common/signInStanding.js';
import type { ReauthenticationPort } from './confirmItsYouDialog.js';
import type { PageChangeResult, PageChangeWording } from './pageConfirmation.js';
import { SignInCheck, type SignInCheckPort, type SignInRequirement } from './signInCheck.js';

/** A capability's errors as the page sees them. */
type ErrorOf<R> = Extract<R, { readonly kind: 'error' }>;

/** What a capability lends the change runner: its changes, its sign-in steps and its words. */
export interface PageChangePort<I, R extends { readonly kind: string }> {
	change(intent: I): Promise<PageChangeResult<R>>;
	/** The sign-in a refused change asks for, if it asks for one. */
	requirement(error: ErrorOf<R>): SignInRequirement | undefined;
	/** The reply that ends a change the person stopped at Confirm it's you. */
	cancelled(): R;
	/** Confirms it is the person, through the capability's browser reauthentication. */
	reauthenticate(): Promise<PageChangeResult<R>>;
	cancelReauthentication(): void;
	standing(): Promise<SignInStanding | undefined>;
	openSecurity(): Promise<void>;
	readonly wording: PageChangeWording<R>;
}

/**
 * Sends one page's changes. A change the institution guards with a recent sign-in, or with a
 * two-step one, goes through the shared {@link SignInCheck}: Confirm it's you, then the change is
 * sent again; stopping ends it as cancelled.
 */
export class PageChanges<I, R extends { readonly kind: string }> extends Disposable {
	private readonly signIn: SignInCheck;

	constructor(
		private readonly port: PageChangePort<I, R>,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.signIn = this._register(
			instantiationService.createInstance(SignInCheck, signInCheckPort(port))
		);
	}

	/** Sends one change; `summary` says what it does if the person must confirm it is them. */
	async send(intent: I, summary: readonly string[]): Promise<PageChangeResult<R>> {
		const result = await this.port.change(intent);
		if (result === 'busy' || result.kind !== 'error') return result;
		const requirement = this.port.requirement(result as ErrorOf<R>);
		if (requirement === undefined) return result;
		const confirmed = await this.signIn.resolve(requirement, summary);
		if (this._store.isDisposed || !confirmed) return this.port.cancelled();
		return this.port.change(intent);
	}

	/**
	 * Before a form for a change that needs a two-step sign-in: false after explaining that the
	 * account needs two-step verification first, or that this installation doesn't offer it.
	 */
	beforeTwoStep(): Promise<boolean> {
		return this.signIn.beforeTwoStep();
	}

	/** Runs the sign-in check a read was refused for; true when it is worth reading again. */
	checkSignIn(requirement: SignInRequirement, summary: readonly string[]): Promise<boolean> {
		return this.signIn.resolve(requirement, summary);
	}

	/** A failure's sentence, or the busy notice; nothing for a success. */
	describe(result: PageChangeResult<R>): string {
		if (result !== 'busy' && result.kind !== 'error') return '';
		return this.port.wording.sentence(result);
	}
}

/** Confirm it's you through a capability: its reply read as confirmed, stopped or failed. */
export function reauthenticationPort<I, R extends { readonly kind: string }>(
	port: Pick<PageChangePort<I, R>, 'reauthenticate' | 'cancelReauthentication' | 'wording'>
): ReauthenticationPort {
	return {
		async confirm() {
			const result = await port.reauthenticate();
			if (result !== 'busy' && result.kind === 'success') return { kind: 'confirmed' };
			const text = port.wording.describe(result);
			return text === undefined ? { kind: 'cancelled' } : { kind: 'failed', text };
		},
		cancel: () => port.cancelReauthentication()
	};
}

function signInCheckPort<I, R extends { readonly kind: string }>(
	port: PageChangePort<I, R>
): SignInCheckPort {
	return {
		...reauthenticationPort(port),
		standing: () => port.standing(),
		openSecurity: () => port.openSecurity()
	};
}
