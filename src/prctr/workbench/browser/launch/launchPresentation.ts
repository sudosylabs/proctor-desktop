/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	LocalizationContext,
	LocalizationValue,
	MessageDescriptor
} from '../../../base/common/localization.js';
import type { DesktopSessionOutcome } from '../../../platform/identity/common/desktopSessionOutcome.js';
import type {
	LaunchBuild,
	LaunchIdentityProjection,
	LaunchState
} from '../../../platform/identity/common/launchIdentity.js';
import {
	checklistMessages as checks,
	launchMessages as labels,
	sessionMessages as session,
	statusMessages as status
} from './launchMessages.js';

/** Text the view formats: a localized message, or a literal value from the server. */
export type LaunchText =
	| {
			readonly message: MessageDescriptor;
			readonly values?: Readonly<Record<string, LocalizationValue>>;
	  }
	| { readonly literal: string };

export function formatLaunchText(localization: LocalizationContext, text: LaunchText): string {
	return 'literal' in text ? text.literal : localization.format(text.message, text.values);
}

export type CheckStatus = 'done' | 'failed' | 'attention' | 'active' | 'pending' | 'skipped';
export type LaunchTone = 'success' | 'attention' | 'failed' | 'active';
export type LaunchActionKind = 'continue' | 'signIn' | 'retry' | 'cancel';

export interface ReadinessStep {
	readonly label: MessageDescriptor;
	readonly status: CheckStatus;
	readonly detail?: LaunchText;
}

export interface LaunchAction {
	readonly kind: LaunchActionKind;
	readonly label: LaunchText;
	readonly accessibleLabel?: LaunchText;
	readonly enabled: boolean;
}

export interface LaunchServer {
	readonly title: string;
	readonly subtitle: LaunchText;
	readonly canChange: boolean;
}

export interface LaunchStatus {
	readonly tone: LaunchTone;
	readonly head: LaunchText;
	readonly body?: LaunchText;
	readonly institutionMessage?: { readonly caption: LaunchText; readonly text: string };
	/** Local-clock projection of the server's advisory retry time. */
	readonly retryAt?: number;
	readonly canReopenBrowser: boolean;
}

export interface LaunchNotice {
	readonly tone: LaunchTone;
	readonly text: MessageDescriptor;
}

export interface LaunchViewModel {
	readonly stage: 'input' | 'server';
	readonly fieldInvalid: boolean;
	readonly development: boolean;
	readonly server?: LaunchServer;
	readonly notice?: LaunchNotice;
	readonly checklistTitle: MessageDescriptor;
	/** Always the four checks, in order: reach, institution, version, sign-in. */
	readonly steps: readonly ReadinessStep[];
	readonly status?: LaunchStatus;
	readonly secondary?: LaunchAction;
	readonly primary?: LaunchAction;
}

/** Where the readiness checks stopped, one character per check: d f a r p s. */
type Progress = `${StepCode}${StepCode}${StepCode}${StepCode}`;
type StepCode = 'd' | 'f' | 'a' | 'r' | 'p' | 's';

const stepStatus: Readonly<Record<StepCode, CheckStatus>> = {
	d: 'done',
	f: 'failed',
	a: 'attention',
	r: 'active',
	p: 'pending',
	s: 'skipped'
};

interface StateRow {
	readonly progress: Progress;
	/** Detail for the check that stopped, when it differs from its done text. */
	readonly detail?: MessageDescriptor;
	readonly tone?: LaunchTone;
	readonly head?: MessageDescriptor;
	readonly body?: MessageDescriptor;
	readonly primary?: 'retry' | 'checkAgain';
}

/** Every server state the coordinator can publish once a server is selected. */
const serverStates: Readonly<Partial<Record<LaunchState, StateRow>>> = {
	checking: { progress: 'rppp', detail: checks.connecting },
	maintenance: {
		progress: 'asss',
		detail: checks.maintenance,
		tone: 'attention',
		body: status.maintenanceBody,
		primary: 'retry'
	},
	unavailable: {
		progress: 'asss',
		detail: checks.unavailable,
		tone: 'attention',
		head: status.unavailableHead,
		body: status.unavailableBody,
		primary: 'retry'
	},
	unreachable: {
		progress: 'fsss',
		detail: checks.noConnection,
		tone: 'failed',
		head: status.unreachableHead,
		body: status.unreachableBody,
		primary: 'retry'
	},
	timedOut: {
		progress: 'fsss',
		detail: checks.noAnswer,
		tone: 'failed',
		head: status.timedOutHead,
		body: status.timedOutBody,
		primary: 'retry'
	},
	redirectBlocked: {
		progress: 'fsss',
		detail: checks.redirects,
		tone: 'failed',
		head: status.redirectHead,
		body: status.redirectBody,
		primary: 'retry'
	},
	invalidResponse: {
		progress: 'dfss',
		detail: checks.notProctor,
		tone: 'failed',
		head: status.invalidResponseHead,
		body: status.invalidResponseBody,
		primary: 'retry'
	},
	originMismatch: {
		progress: 'dfss',
		detail: checks.otherAddress,
		tone: 'failed',
		head: status.originMismatchHead,
		body: status.originMismatchBody,
		primary: 'retry'
	},
	identityChanged: {
		progress: 'dfss',
		detail: checks.identityChanged,
		tone: 'failed',
		head: status.identityChangedHead,
		body: status.identityChangedBody,
		primary: 'retry'
	},
	updateRequired: {
		progress: 'ddfs',
		detail: checks.updateRequired,
		tone: 'failed',
		head: status.updateRequiredHead,
		body: status.updateRequiredBody,
		primary: 'checkAgain'
	},
	serverIncompatible: {
		progress: 'ddfs',
		detail: checks.notCompatible,
		tone: 'failed',
		head: status.incompatibleHead,
		body: status.incompatibleBody,
		primary: 'checkAgain'
	},
	unsupportedTarget: {
		progress: 'ddfs',
		detail: checks.platformBlocked,
		tone: 'failed',
		head: status.unsupportedTargetHead,
		body: status.unsupportedTargetBody,
		primary: 'checkAgain'
	},
	authorizationDisabled: {
		progress: 'dddf',
		detail: checks.turnedOff,
		tone: 'failed',
		head: status.authorizationDisabledHead,
		body: status.authorizationDisabledBody,
		primary: 'checkAgain'
	},
	authorizationUnsupported: {
		progress: 'dddf',
		detail: checks.methodUnsupported,
		tone: 'failed',
		head: status.authorizationUnsupportedHead,
		body: status.authorizationUnsupportedBody,
		primary: 'checkAgain'
	},
	authorizing: {
		progress: 'dddr',
		detail: checks.waitingForBrowser,
		tone: 'active',
		head: status.authorizingHead,
		body: status.authorizingBody
	}
};

type AuthorizationFailure = NonNullable<LaunchIdentityProjection['authorizationFailure']>;

const signInFailures: Readonly<
	Record<
		AuthorizationFailure,
		{ detail: MessageDescriptor; head: MessageDescriptor; body: MessageDescriptor }
	>
> = {
	cancelled: { detail: checks.cancelled, head: status.cancelledHead, body: status.cancelledBody },
	timedOut: { detail: checks.expired, head: status.expiredHead, body: status.expiredBody },
	callbackInvalid: {
		detail: checks.notVerified,
		head: status.notVerifiedHead,
		body: status.notVerifiedBody
	},
	unavailable: {
		detail: checks.noConnection,
		head: status.unavailableSignInHead,
		body: status.unavailableSignInBody
	},
	rejected: { detail: checks.rejected, head: status.rejectedHead, body: status.rejectedBody },
	verificationRequired: {
		detail: checks.sessionNotVerified,
		head: status.notVerifiedHead,
		body: status.notVerifiedBody
	},
	storageUnavailable: {
		detail: checks.keyStorage,
		head: status.keyStorageHead,
		body: status.keyStorageBody
	}
};

const checkLabels = [checks.reach, checks.institution, checks.version, checks.signIn] as const;

/**
 * Describes what the LaunchWindow shows for one projection. The projection stays the
 * only authority; this only decides presentation, so it is pure and has no DOM.
 */
export function presentLaunch(projection: LaunchIdentityProjection): LaunchViewModel {
	const development = projection.developmentOrigin;
	if (projection.state === 'selectingServer' || projection.state === 'invalidServer') {
		return {
			stage: 'input',
			fieldInvalid: projection.state === 'invalidServer',
			development,
			checklistTitle: checks.titleBefore,
			steps: steps(projection, 'pppp'),
			primary: action('continue', labels.continue, true)
		};
	}
	const server = presentServer(projection);
	if (projection.sessionOutcome) return presentSessionOutcome(projection, server, development);
	if (projection.state === 'ready') return presentReady(projection, server, development);
	if (projection.state === 'authorizationFailed') {
		const failure = signInFailures[projection.authorizationFailure ?? 'unavailable'];
		return {
			stage: 'server',
			fieldInvalid: false,
			development,
			server,
			checklistTitle: checks.title,
			steps: steps(projection, 'dddf', failure.detail),
			status: {
				tone: 'failed',
				head: { message: failure.head },
				body: { message: failure.body },
				canReopenBrowser: false
			},
			primary: action('retry', labels.tryAgain, true)
		};
	}
	const row = serverStates[projection.state];
	if (row === undefined)
		throw new Error(`No presentation for LaunchWindow state ${projection.state}`);
	return {
		stage: 'server',
		fieldInvalid: false,
		development,
		server,
		checklistTitle: checks.title,
		steps: steps(projection, row.progress, row.detail),
		...(row.tone === undefined ? {} : { status: presentStatus(projection, row) }),
		...secondaryFor(projection.state),
		...primaryFor(projection, row)
	};
}

function presentReady(
	projection: LaunchIdentityProjection,
	server: LaunchServer,
	development: boolean
): LaunchViewModel {
	if (!projection.authorizationAvailable) {
		return {
			stage: 'server',
			fieldInvalid: false,
			development,
			server,
			checklistTitle: checks.title,
			steps: steps(projection, 'ddda', checks.notInThisBuild),
			status: {
				tone: 'attention',
				head: { message: status.notInBuildHead },
				body: { message: status.notInBuildBody },
				canReopenBrowser: false
			},
			primary: action('signIn', labels.signInGeneric, false)
		};
	}
	return {
		stage: 'server',
		fieldInvalid: false,
		development,
		server,
		checklistTitle: checks.title,
		steps: steps(projection, 'dddd'),
		status: {
			tone: 'success',
			head: { message: status.readyHead },
			body: { message: status.readyBody },
			canReopenBrowser: false
		},
		primary: signInAction(projection, projection.canSignIn)
	};
}

/** After sign-out or a failed refresh the window has not re-checked the server, so nothing is shown as done. */
function presentSessionOutcome(
	projection: LaunchIdentityProjection,
	server: LaunchServer,
	development: boolean
): LaunchViewModel {
	const outcome = projection.sessionOutcome!;
	const notice = presentNotice(outcome);
	const ending = outcome.authentication === 'ending';
	return {
		stage: 'server',
		fieldInvalid: false,
		development,
		server: { ...server, canChange: !ending },
		notice,
		checklistTitle: checks.title,
		steps: steps(projection, 'pppp'),
		primary: action('retry', labels.continue, !ending)
	};
}

function presentNotice(outcome: DesktopSessionOutcome): LaunchNotice {
	if (outcome.authentication === 'ending') return { tone: 'active', text: session.ending };
	if (outcome.reason === 'refreshFailed')
		return { tone: 'attention', text: session.refreshFailed };
	if (outcome.localCleanup === 'failed') {
		return {
			tone: 'attention',
			text:
				outcome.remoteRevocation === 'unconfirmed'
					? session.bothUnconfirmed
					: session.localUnconfirmed
		};
	}
	if (outcome.remoteRevocation === 'unconfirmed')
		return { tone: 'attention', text: session.remoteUnconfirmed };
	return { tone: 'success', text: session.cleared };
}

function presentServer(projection: LaunchIdentityProjection): LaunchServer {
	const address = projection.origin ?? '';
	if (projection.institutionName === undefined) {
		return {
			title: hostOf(address),
			subtitle: { message: labels.institutionUnconfirmed },
			canChange: true
		};
	}
	return { title: projection.institutionName, subtitle: { literal: address }, canChange: true };
}

function presentStatus(projection: LaunchIdentityProjection, row: StateRow): LaunchStatus {
	const institution = projection.institutionName;
	const head: LaunchText =
		projection.state === 'maintenance'
			? institution === undefined
				? { message: status.maintenanceHeadGeneric }
				: { message: status.maintenanceHead, values: { institution } }
			: { message: row.head! };
	const body: LaunchText | undefined =
		row.body === undefined
			? undefined
			: projection.state === 'unsupportedTarget'
				? { message: row.body, values: { platform: platformName(projection.build) } }
				: { message: row.body };
	return {
		tone: row.tone!,
		head,
		...(body === undefined ? {} : { body }),
		...(projection.administratorMessage === undefined
			? {}
			: {
					institutionMessage: {
						caption:
							institution === undefined
								? { message: labels.institutionMessageGeneric }
								: { message: labels.institutionMessage, values: { institution } },
						text: projection.administratorMessage
					}
				}),
		...(projection.retryAt === undefined ? {} : { retryAt: projection.retryAt }),
		canReopenBrowser: projection.state === 'authorizing'
	};
}

function secondaryFor(state: LaunchState): Pick<LaunchViewModel, 'secondary'> {
	if (state === 'checking' || state === 'authorizing')
		return { secondary: action('cancel', labels.cancel, true) };
	return {};
}

function primaryFor(
	projection: LaunchIdentityProjection,
	row: StateRow
): Pick<LaunchViewModel, 'primary'> {
	if (projection.state === 'checking') return { primary: signInAction(projection, false) };
	if (projection.state === 'authorizing')
		return { primary: action('signIn', labels.waiting, false) };
	if (row.primary === 'retry') return { primary: action('retry', labels.retry, true) };
	if (row.primary === 'checkAgain') return { primary: action('retry', labels.checkAgain, true) };
	return {};
}

function signInAction(projection: LaunchIdentityProjection, enabled: boolean): LaunchAction {
	const institution = projection.institutionName;
	if (institution === undefined) return action('signIn', labels.signInGeneric, enabled);
	return {
		kind: 'signIn',
		label: { message: labels.signIn, values: { institution } },
		enabled
	};
}

function action(kind: LaunchActionKind, label: MessageDescriptor, enabled: boolean): LaunchAction {
	return { kind, label: { message: label }, enabled };
}

/** A step that has not run shows a dash, so every row has a value in the same column. */
const QUIET_DETAIL: LaunchText = { literal: '—' };

function steps(
	projection: LaunchIdentityProjection,
	progress: Progress,
	stoppedDetail?: MessageDescriptor
): readonly ReadinessStep[] {
	return checkLabels.map((label, index) => {
		const status = stepStatus[progress[index] as StepCode];
		const detail =
			status === 'done'
				? doneDetail(projection, index)
				: status === 'pending' || status === 'skipped'
					? QUIET_DETAIL
					: stoppedDetail === undefined
						? undefined
						: ({ message: stoppedDetail } as const);
		return detail === undefined ? { label, status } : { label, status, detail };
	});
}

function doneDetail(projection: LaunchIdentityProjection, index: number): LaunchText {
	switch (index) {
		case 0:
			return { message: checks.reached };
		case 1:
			return projection.institutionName === undefined
				? { message: checks.reached }
				: { literal: projection.institutionName };
		case 2:
			// The platform alone: the window shows no version number.
			return projection.build === undefined
				? { message: checks.reached }
				: { literal: platformName(projection.build) };
		default:
			return { message: checks.opensInBrowser };
	}
}

/** Operating-system names are proper nouns and stay the same in every language. */
const platformNames: Readonly<Record<LaunchBuild['platform'], string>> = {
	macos: 'macOS',
	windows: 'Windows',
	linux: 'Linux'
};

function platformName(build: LaunchBuild | undefined): string {
	return platformNames[build?.platform ?? 'macos'];
}

/** The host and port of a validated origin, for a title before the Institution is known. */
function hostOf(origin: string): string {
	return origin.replace(/^[a-z][a-z\d+.-]*:\/\//iu, '');
}
