import assert from 'node:assert';
import { test } from '../../../base/common/upstream/testAdapter.ts';
import { createLocalization } from '../../../../src/prctr/base/common/localization.ts';
import type { DesktopSessionOutcome } from '../../../../src/prctr/platform/identity/common/desktopSessionOutcome.ts';
import {
	launchStates,
	type LaunchIdentityProjection
} from '../../../../src/prctr/platform/identity/common/launchIdentity.ts';
import { allLaunchMessages } from '../../../../src/prctr/workbench/browser/launch/launchMessages.ts';
import {
	formatLaunchText,
	presentLaunch,
	type LaunchViewModel
} from '../../../../src/prctr/workbench/browser/launch/launchPresentation.ts';

const localization = createLocalization({ requestedLocale: 'en', messages: allLaunchMessages });
const origin = 'https://exams.northfield.edu';
const institutionName = 'Northfield University';

function projection(
	state: LaunchIdentityProjection['state'],
	extra: Partial<LaunchIdentityProjection> = {}
): LaunchIdentityProjection {
	return {
		revision: 1,
		state,
		developmentOrigin: false,
		canSignIn: false,
		authorizationAvailable: true,
		build: { release: '0.1.0', platform: 'macos' },
		...(state === 'selectingServer' || state === 'invalidServer'
			? {}
			: { origin, institutionName }),
		...extra
	};
}

function progress(model: LaunchViewModel): string {
	const codes = {
		done: 'd',
		failed: 'f',
		attention: 'a',
		active: 'r',
		pending: 'p',
		skipped: 's'
	};
	return model.steps.map((step) => codes[step.status]).join('');
}

function text(value: Parameters<typeof formatLaunchText>[1] | undefined): string | undefined {
	return value === undefined ? undefined : formatLaunchText(localization, value);
}

test('every launch state has a presentation with exactly four checks', () => {
	for (const state of launchStates) {
		const model = presentLaunch(projection(state));
		assert.strictEqual(model.steps.length, 4, state);
		assert.ok(model.primary !== undefined, `${state} offers a primary action`);
	}
});

test('server selection previews the checks without running them', () => {
	const model = presentLaunch(projection('selectingServer'));
	assert.strictEqual(model.stage, 'input');
	assert.strictEqual(model.fieldInvalid, false);
	assert.strictEqual(progress(model), 'pppp');
	assert.strictEqual(
		text({ message: model.checklistTitle }),
		'Before you sign in, Proctor checks'
	);
	assert.strictEqual(model.primary?.kind, 'continue');
	assert.strictEqual(presentLaunch(projection('invalidServer')).fieldInvalid, true);
});

test('checks stop at the step that failed and skip the rest', () => {
	const cases: Partial<Record<LaunchIdentityProjection['state'], string>> = {
		checking: 'rppp',
		maintenance: 'asss',
		unavailable: 'asss',
		unreachable: 'fsss',
		timedOut: 'fsss',
		redirectBlocked: 'fsss',
		invalidResponse: 'dfss',
		originMismatch: 'dfss',
		identityChanged: 'dfss',
		updateRequired: 'ddfs',
		serverIncompatible: 'ddfs',
		unsupportedTarget: 'ddfs',
		authorizationDisabled: 'dddf',
		authorizationUnsupported: 'dddf',
		authorizing: 'dddr',
		authorizationFailed: 'dddf'
	};
	for (const [state, expected] of Object.entries(cases))
		assert.strictEqual(
			progress(presentLaunch(projection(state as LaunchIdentityProjection['state']))),
			expected,
			state
		);
});

test('ready names the Institution, the platform and the browser hand-off', () => {
	const model = presentLaunch(projection('ready', { canSignIn: true }));
	assert.strictEqual(progress(model), 'dddd');
	assert.deepStrictEqual(
		model.steps.map((step) => text(step.detail)),
		['Reached', institutionName, 'macOS', 'Opens in your browser']
	);
	assert.strictEqual(model.server?.title, institutionName);
	assert.strictEqual(text(model.server?.subtitle), origin);
	assert.strictEqual(text(model.status?.head), 'Ready to sign in');
	assert.strictEqual(text(model.primary?.label), 'Sign in to Northfield University');
	assert.strictEqual(model.primary?.enabled, true);
	const windows = presentLaunch(
		projection('ready', { canSignIn: true, build: { release: '0.1.0', platform: 'windows' } })
	);
	assert.strictEqual(text(windows.steps[2]?.detail), 'Windows');
});

test('a build without sign-in says so instead of offering a dead button as ready', () => {
	const model = presentLaunch(projection('ready', { authorizationAvailable: false }));
	assert.strictEqual(progress(model), 'ddda');
	assert.strictEqual(text(model.status?.head), 'Sign-in isn’t available in this build');
	assert.strictEqual(model.primary?.enabled, false);
});

test('an unconfirmed Institution is never named', () => {
	const model = presentLaunch(projection('unreachable', { institutionName: undefined }));
	assert.strictEqual(model.server?.title, 'exams.northfield.edu');
	assert.strictEqual(text(model.server?.subtitle), 'Institution not confirmed');
	assert.strictEqual(text(model.status?.head), 'Couldn’t reach this server');
	assert.strictEqual(model.primary?.kind, 'retry');
});

test('maintenance carries the Institution message and the advisory retry time', () => {
	const model = presentLaunch(
		projection('maintenance', { administratorMessage: 'Back at 14:30.', retryAt: 1_000 })
	);
	assert.strictEqual(model.status?.tone, 'attention');
	assert.strictEqual(text(model.status?.head), 'Northfield University is under maintenance');
	assert.strictEqual(
		text(model.status?.institutionMessage?.caption),
		'Message from Northfield University'
	);
	assert.strictEqual(model.status?.institutionMessage?.text, 'Back at 14:30.');
	assert.strictEqual(model.status?.retryAt, 1_000);
	assert.strictEqual(text(model.steps[0]?.detail), 'Under maintenance');
});

test('checking and browser sign-in can be cancelled, and only sign-in can reopen the page', () => {
	const checking = presentLaunch(projection('checking', { institutionName: undefined }));
	assert.strictEqual(checking.secondary?.kind, 'cancel');
	assert.strictEqual(checking.primary?.enabled, false);
	const authorizing = presentLaunch(projection('authorizing'));
	assert.strictEqual(authorizing.secondary?.kind, 'cancel');
	assert.strictEqual(authorizing.status?.canReopenBrowser, true);
	assert.strictEqual(text(authorizing.primary?.label), 'Waiting…');
	assert.strictEqual(
		presentLaunch(projection('ready', { canSignIn: true })).status?.canReopenBrowser,
		false
	);
});

test('each sign-in failure explains itself and offers to try again', () => {
	const failures = {
		cancelled: 'Sign-in was cancelled',
		timedOut: 'Sign-in took too long',
		callbackInvalid: 'Proctor couldn’t verify the sign-in',
		unavailable: 'Sign-in is unavailable',
		rejected: 'The server couldn’t complete sign-in',
		storageUnavailable: 'Proctor couldn’t use secure key storage'
	} as const;
	for (const [failure, head] of Object.entries(failures)) {
		const model = presentLaunch(
			projection('authorizationFailed', {
				authorizationFailure: failure as keyof typeof failures
			})
		);
		assert.strictEqual(text(model.status?.head), head, failure);
		assert.strictEqual(model.primary?.kind, 'retry');
		assert.strictEqual(text(model.primary?.label), 'Try again');
	}
});

test('session outcomes show a notice and leave the server unchecked', () => {
	const outcome = (extra: Partial<DesktopSessionOutcome>): DesktopSessionOutcome => ({
		sequence: 1,
		origin,
		institutionName,
		authentication: 'signedOut',
		sessionValidity: 'revoked',
		credentialReadiness: 'locked',
		reason: 'signOut',
		localCleanup: 'cleared',
		remoteRevocation: 'confirmed',
		...extra
	});
	const present = (extra: Partial<DesktopSessionOutcome>) =>
		presentLaunch(
			projection('authorizationFailed', {
				authorizationFailure: 'verificationRequired',
				sessionOutcome: outcome(extra)
			})
		);
	const cleared = present({});
	assert.strictEqual(text({ message: cleared.notice!.text }), 'Signed out.');
	assert.strictEqual(progress(cleared), 'pppp');
	assert.strictEqual(cleared.status, undefined);
	assert.strictEqual(
		text({ message: present({ remoteRevocation: 'unconfirmed' }).notice!.text }),
		'Signed out on this computer. Proctor couldn’t confirm sign-out with the server.'
	);
	const ending = present({ authentication: 'ending', localCleanup: 'pending' });
	assert.strictEqual(ending.notice?.tone, 'active');
	assert.strictEqual(ending.primary?.enabled, false);
	assert.strictEqual(ending.server?.canChange, false);
});

test('the development strip follows the projection, never the address text', () => {
	assert.strictEqual(
		presentLaunch(projection('ready', { developmentOrigin: true })).development,
		true
	);
	assert.strictEqual(presentLaunch(projection('ready')).development, false);
});
