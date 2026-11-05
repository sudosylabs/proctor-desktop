import {
	validateDesktopSessionOutcome,
	type DesktopSessionOutcome
} from './desktopSessionOutcome.js';
/** Public, credential-free LaunchWindow presentation. Server payloads never cross this seam. */
export const launchStates = [
	'selectingServer',
	'invalidServer',
	'checking',
	'ready',
	'maintenance',
	'unavailable',
	'unreachable',
	'timedOut',
	'invalidResponse',
	'redirectBlocked',
	'originMismatch',
	'identityChanged',
	'updateRequired',
	'serverIncompatible',
	'unsupportedTarget',
	'authorizationDisabled',
	'authorizationUnsupported',
	'authorizing',
	'authorizationFailed'
] as const;

export type LaunchState = (typeof launchStates)[number];

export interface LaunchIdentityProjection {
	readonly revision: number;
	readonly state: LaunchState;
	readonly origin?: string;
	readonly institutionName?: string;
	readonly developmentOrigin: boolean;
	readonly administratorMessage?: string;
	/** Local-clock projection of the server-relative retry time; advisory, never an admission grant. */
	readonly retryAt?: number;
	readonly compatibilityReason?:
		| 'releaseTooOld'
		| 'releaseTooNew'
		| 'realtimeTooOld'
		| 'realtimeTooNew'
		| 'buildRevoked'
		| 'buildUnrecognized'
		| 'unknown';
	readonly canSignIn: boolean;
	readonly authorizationAvailable: boolean;
	readonly sessionOutcome?: DesktopSessionOutcome;
	readonly authorizationFailure?:
		| 'cancelled'
		| 'timedOut'
		| 'callbackInvalid'
		| 'unavailable'
		| 'rejected'
		| 'verificationRequired'
		| 'storageUnavailable';
}

export type LaunchIdentityIntent =
	| { readonly kind: 'selectServer'; readonly address: string }
	| { readonly kind: 'retry' | 'changeServer' | 'signIn' };

export interface LaunchIdentityClient {
	projection(): Promise<LaunchIdentityProjection>;
	onDidChange(listener: (projection: LaunchIdentityProjection) => void): { dispose(): void };
	selectServer(address: string): Promise<void>;
	retry(): Promise<void>;
	changeServer(): Promise<void>;
	signIn(): Promise<void>;
}

export function validateLaunchIdentityIntent(value: unknown): LaunchIdentityIntent {
	if (!isRecord(value)) throw new TypeError('Invalid LaunchWindow intent');
	if (
		value.kind === 'selectServer' &&
		Object.keys(value).length === 2 &&
		typeof value.address === 'string' &&
		value.address.length <= 2048
	) {
		return Object.freeze({ kind: 'selectServer', address: value.address });
	}
	if (
		Object.keys(value).length === 1 &&
		(value.kind === 'retry' || value.kind === 'changeServer' || value.kind === 'signIn')
	) {
		return Object.freeze({ kind: value.kind });
	}
	throw new TypeError('Invalid LaunchWindow intent');
}

export function validateLaunchIdentityProjection(value: unknown): LaunchIdentityProjection {
	if (
		!isRecord(value) ||
		!Number.isSafeInteger(value.revision) ||
		(value.revision as number) < 0 ||
		!launchStates.includes(value.state as LaunchState) ||
		typeof value.developmentOrigin !== 'boolean' ||
		typeof value.canSignIn !== 'boolean' ||
		typeof value.authorizationAvailable !== 'boolean' ||
		(value.canSignIn && (value.state !== 'ready' || !value.authorizationAvailable))
	) {
		throw new TypeError('Invalid LaunchWindow projection');
	}
	if (
		value.authorizationFailure !== undefined &&
		(value.state !== 'authorizationFailed' ||
			![
				'cancelled',
				'timedOut',
				'callbackInvalid',
				'unavailable',
				'rejected',
				'verificationRequired',
				'storageUnavailable'
			].includes(value.authorizationFailure as string))
	)
		throw new TypeError('Invalid authorization failure');
	const origin = optionalText(value.origin, 2048);
	const institutionName = optionalText(value.institutionName, 512);
	const administratorMessage = optionalText(value.administratorMessage, 2048);
	if (value.canSignIn && (origin === undefined || institutionName === undefined)) {
		throw new TypeError('LaunchWindow sign-in has no verified server');
	}
	if (
		value.retryAt !== undefined &&
		(!Number.isSafeInteger(value.retryAt) ||
			(value.retryAt as number) < 0 ||
			(value.retryAt as number) > 8.64e15)
	) {
		throw new TypeError('Invalid LaunchWindow retry time');
	}
	const reasons = [
		'releaseTooOld',
		'releaseTooNew',
		'realtimeTooOld',
		'realtimeTooNew',
		'buildRevoked',
		'buildUnrecognized',
		'unknown'
	];
	if (
		value.compatibilityReason !== undefined &&
		!reasons.includes(value.compatibilityReason as string)
	) {
		throw new TypeError('Invalid LaunchWindow compatibility reason');
	}
	return Object.freeze({
		revision: value.revision as number,
		state: value.state as LaunchState,
		developmentOrigin: value.developmentOrigin,
		canSignIn: value.canSignIn,
		authorizationAvailable: value.authorizationAvailable,
		...(value.sessionOutcome === undefined
			? {}
			: { sessionOutcome: validateDesktopSessionOutcome(value.sessionOutcome) }),
		...(value.authorizationFailure === undefined
			? {}
			: {
					authorizationFailure: value.authorizationFailure as NonNullable<
						LaunchIdentityProjection['authorizationFailure']
					>
				}),
		...(origin === undefined ? {} : { origin }),
		...(institutionName === undefined ? {} : { institutionName }),
		...(administratorMessage === undefined ? {} : { administratorMessage }),
		...(value.retryAt === undefined ? {} : { retryAt: value.retryAt as number }),
		...(value.compatibilityReason === undefined
			? {}
			: {
					compatibilityReason: value.compatibilityReason as NonNullable<
						LaunchIdentityProjection['compatibilityReason']
					>
				})
	});
}

function optionalText(value: unknown, maximum: number): string | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > maximum ||
		/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
	) {
		throw new TypeError('Invalid LaunchWindow presentation text');
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
