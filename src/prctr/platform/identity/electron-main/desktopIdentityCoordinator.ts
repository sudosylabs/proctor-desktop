import {
	validateDesktopSessionOutcome,
	type DesktopSessionOutcome
} from '../common/desktopSessionOutcome.js';
import { DesktopAuthorizationError } from '../node/desktopAuthorizationError.js';
import type { ServerOriginStore } from '../node/serverOriginStore.js';
import {
	CancellationTokenSource,
	type CancellationToken
} from '../../../base/common/cancellation.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import {
	validateLaunchIdentityIntent,
	validateLaunchIdentityProjection,
	type LaunchBuild,
	type LaunchIdentityProjection
} from '../common/launchIdentity.js';
import {
	evaluateServerReadiness,
	normalizeServerOrigin,
	validateDesktopReleaseTarget,
	type DesktopReleaseTarget,
	type ServerReadinessTransport,
	type VerifiedServerIdentity
} from './serverReadiness.js';

export interface DesktopIdentityCoordinatorOptions {
	readonly target: DesktopReleaseTarget;
	readonly transport: ServerReadinessTransport;
	readonly allowDevelopmentLoopback: boolean;
	/** The hosted-auth owner supplies this only when its complete privileged flow is available. */
	readonly authorization?: {
		start(identity: VerifiedServerIdentity, token: CancellationToken): Promise<void>;
		/** Opens the pending sign-in page again; does nothing when no sign-in is waiting. */
		reopenBrowser(): Promise<void>;
	};
	readonly now?: () => number;
	/**
	 * The origin last verified on this computer. LaunchWindow starts by checking it; a verified
	 * Institution replaces it and Change server forgets it.
	 */
	readonly rememberedServer?: ServerOriginStore;
}

/** Privileged owner of selected-server readiness; renderers cannot assert readiness or choose build metadata. */
export class DesktopIdentityCoordinator extends Disposable {
	readonly #changes = this._register(new Emitter<LaunchIdentityProjection>());
	readonly onDidChange = this.#changes.event;
	readonly #target: DesktopReleaseTarget;
	readonly #now: () => number;
	#projection: LaunchIdentityProjection;
	#operation: CancellationTokenSource | undefined;
	#verifiedIdentity: VerifiedServerIdentity | undefined;
	#generation = 0;
	#disposed = false;
	#signingIn = false;
	/** The last session outcome, shown until the candidate acts. */
	#sessionOutcome: DesktopSessionOutcome | undefined;

	constructor(private readonly options: DesktopIdentityCoordinatorOptions) {
		const target = validateDesktopReleaseTarget(options.target);
		super();
		this.#target = target;
		this.#now = options.now ?? Date.now;
		this.#projection = this.#makeProjection({ state: 'selectingServer' }, 0);
		const remembered = this.#rememberedOrigin();
		if (remembered !== undefined) void this.#check(remembered, false);
	}

	/** The stored origin, held to the same rules as a typed address; anything else is forgotten. */
	#rememberedOrigin(): string | undefined {
		const store = this.options.rememberedServer;
		const stored = store?.read();
		if (stored === undefined) return undefined;
		try {
			return normalizeServerOrigin(stored, this.options.allowDevelopmentLoopback);
		} catch {
			store?.clear();
			return undefined;
		}
	}

	projection(): LaunchIdentityProjection {
		return this.#projection;
	}

	acceptSessionOutcome(value: DesktopSessionOutcome): void {
		if (this.#disposed) return;
		const outcome = validateDesktopSessionOutcome(value);
		const previous = this.#sessionOutcome;
		if (previous && outcome.sequence < previous.sequence) return;
		this.#sessionOutcome = outcome;
		this.#cancel();
		if (outcome.authentication === 'ending') {
			this.#publish({
				state: 'authorizationFailed',
				origin: outcome.origin,
				institutionName: outcome.institutionName,
				authorizationFailure: 'verificationRequired'
			});
			return;
		}
		// The window shows the outcome over a fresh check, so its checks are never stale.
		void this.#check(outcome.origin, false);
	}

	async handleIntent(value: unknown): Promise<void> {
		if (this.#disposed) throw new Error('Launch identity is disposed');
		const intent = validateLaunchIdentityIntent(value);
		if (this.#projection.sessionOutcome?.authentication === 'ending') return;
		// The outcome notice stays until the candidate acts.
		this.#sessionOutcome = undefined;
		switch (intent.kind) {
			case 'changeServer':
				this.#cancel();
				this.options.rememberedServer?.clear();
				this.#publish({ state: 'selectingServer' });
				return;
			case 'selectServer': {
				this.#cancel();
				let origin: string;
				try {
					origin = normalizeServerOrigin(
						intent.address,
						this.options.allowDevelopmentLoopback
					);
				} catch {
					this.#publish({ state: 'invalidServer' });
					return;
				}
				await this.#check(origin, false);
				return;
			}
			case 'cancel':
				this.#cancelOperation();
				return;
			case 'reopenBrowser':
				if (this.#projection.state === 'authorizing')
					await this.options.authorization?.reopenBrowser();
				return;
			case 'retry':
				if (
					!this.#projection.origin ||
					this.#projection.state === 'checking' ||
					this.#signingIn
				)
					return;
				await this.#check(this.#projection.origin, false);
				return;
			case 'signIn':
				if (
					!this.#projection.canSignIn ||
					this.#signingIn ||
					!this.#projection.origin ||
					!this.options.authorization
				) {
					throw new Error('Sign-in is not available');
				}
				await this.#check(this.#projection.origin, true);
		}
	}

	async #check(origin: string, startAuthorization: boolean): Promise<void> {
		const expectedIdentity = this.#verifiedIdentity;
		this.#cancel();
		const generation = this.#generation;
		const operation = new CancellationTokenSource();
		this.#operation = operation;
		this.#signingIn = startAuthorization;
		const current = (): boolean =>
			!this.#disposed &&
			generation === this.#generation &&
			!operation.token.isCancellationRequested;
		this.#publish({ state: 'checking', origin });
		try {
			if (!current()) return;
			const probe = await this.options.transport.probe(origin, this.#target, operation.token);
			if (!current()) return;
			const evaluation = evaluateServerReadiness(origin, this.#target, probe, this.#now());
			const { identity, ...presentation } = evaluation;
			if (
				startAuthorization &&
				identity &&
				(!expectedIdentity ||
					identity.institutionId !== expectedIdentity.institutionId ||
					identity.installationId !== expectedIdentity.installationId ||
					identity.origin !== expectedIdentity.origin)
			) {
				this.#publish({ ...presentation, state: 'identityChanged', origin });
				return;
			}
			this.#verifiedIdentity = identity;
			if (identity) this.options.rememberedServer?.write(identity.origin);
			if (
				startAuthorization &&
				identity &&
				evaluation.state === 'ready' &&
				this.options.authorization
			) {
				this.#publish({ ...presentation, state: 'authorizing', origin });
				if (!current()) return;
				try {
					await this.options.authorization.start(identity, operation.token);
				} catch (error) {
					if (current())
						this.#publish({
							...presentation,
							state: 'authorizationFailed',
							origin,
							authorizationFailure:
								error instanceof DesktopAuthorizationError
									? error.reason
									: 'unavailable'
						});
					return;
				}
				if (!current()) return;
			}
			this.#signingIn = false;
			this.#publish({ ...presentation, origin });
		} catch {
			if (current()) this.#publish({ state: 'unreachable', origin });
		} finally {
			if (this.#operation === operation) {
				this.#operation = undefined;
				this.#signingIn = false;
			}
			operation.dispose();
		}
	}

	#makeProjection(
		presentation: Pick<LaunchIdentityProjection, 'state'> & Partial<LaunchIdentityProjection>,
		revision: number
	): LaunchIdentityProjection {
		return validateLaunchIdentityProjection({
			...presentation,
			...(this.#sessionOutcome === undefined ? {} : { sessionOutcome: this.#sessionOutcome }),
			revision,
			build: {
				release: this.#target.release,
				platform: launchPlatform(this.#target.platform)
			},
			developmentOrigin: presentation.origin?.startsWith('http:') ?? false,
			authorizationAvailable: this.options.authorization !== undefined,
			canSignIn:
				presentation.state === 'ready' &&
				this.options.authorization !== undefined &&
				!this.#signingIn
		});
	}
	#publish(
		presentation: Pick<LaunchIdentityProjection, 'state'> & Partial<LaunchIdentityProjection>
	): void {
		if (this.#disposed) return;
		this.#projection = this.#makeProjection(presentation, this.#projection.revision + 1);
		this.#changes.fire(this.#projection);
	}
	/**
	 * Stops the running check or browser sign-in. A cancelled check returns to server
	 * selection; a cancelled sign-in keeps the selected Institution so it can be retried.
	 */
	#cancelOperation(): void {
		const { state, origin, institutionName } = this.#projection;
		if (state === 'checking') {
			this.#cancel();
			this.#publish({ state: 'selectingServer' });
			return;
		}
		if (state === 'authorizing') {
			this.#cancel();
			this.#publish({
				state: 'authorizationFailed',
				...(origin === undefined ? {} : { origin }),
				...(institutionName === undefined ? {} : { institutionName }),
				authorizationFailure: 'cancelled'
			});
		}
	}

	#cancel(): void {
		this.#generation++;
		this.#verifiedIdentity = undefined;
		const previous = this.#operation;
		this.#operation = undefined;
		this.#signingIn = false;
		previous?.dispose(true);
	}
	override dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#cancel();
		super.dispose();
	}
}

function launchPlatform(platform: string): LaunchBuild['platform'] {
	if (platform === 'darwin') return 'macos';
	if (platform === 'win32') return 'windows';
	return 'linux';
}
