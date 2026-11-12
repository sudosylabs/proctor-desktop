import assert from 'node:assert';
import { test } from 'node:test';

import type {
	AccountDesktop,
	AccountHistoryEntry,
	AccountRetentionNotice,
	AccountSession,
	AccountToken
} from '../../../../../src/prctr/platform/account/common/accountProtocol.ts';
import {
	failureMessage,
	failureNeedsRead,
	failureWithdrawsData,
	groupSessions,
	groupTokens,
	initialsOf,
	noticePresentation,
	orderDesktops,
	platformKind,
	providerKind,
	foldHistory,
	historyEventGroups,
	historyQuery,
	scopeGrantable,
	scopeTitle,
	sessionUnidentified,
	signInMessage,
	tokenActions,
	tokenAreaMessage,
	tokenExpiresSoon,
	tokenExpiry,
	tokenScopeAreas,
	tokenState,
	twoStepPresentation,
	validateTokenDraft
} from '../../../../../src/prctr/workbench/contrib/account/common/accountPresentation.ts';

const NOW = new Date(2026, 10, 7, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function token(overrides: Partial<AccountToken>): AccountToken {
	return {
		id: 'f'.repeat(26),
		description: 'Script',
		scopes: ['exam.view'],
		expiresAt: NOW + DAY,
		createdAt: NOW - DAY,
		...overrides
	};
}

function desktop(overrides: Partial<AccountDesktop>): AccountDesktop {
	return {
		id: 'd'.repeat(26),
		current: false,
		name: 'Lab PC 14',
		platform: 'win32',
		release: '0.1.0',
		createdAt: NOW - DAY,
		lastUsedAt: NOW,
		revoked: false,
		...overrides
	};
}

void test('every account failure has its own message', () => {
	const reasons = [
		'unavailable',
		'sessionEnded',
		'reauthenticationRequired',
		'strongAuthenticationRequired',
		'denied',
		'notFound',
		'unconfirmed',
		'conflict',
		'invalid'
	] as const;
	assert.strictEqual(new Set(reasons.map(failureMessage)).size, reasons.length);
});

void test('unknown or changed outcomes need a fresh read before a retry', () => {
	assert.ok(failureNeedsRead('unconfirmed'));
	assert.ok(failureNeedsRead('conflict'));
	assert.ok(failureNeedsRead('notFound'));
	assert.ok(!failureNeedsRead('strongAuthenticationRequired'));
	assert.ok(!failureNeedsRead('unavailable'));
});

void test('a lost session or authority withdraws shown data instead of keeping it stale', () => {
	assert.ok(failureWithdrawsData('sessionEnded'));
	assert.ok(failureWithdrawsData('denied'));
	assert.ok(!failureWithdrawsData('unavailable'));
});

void test('initials take the first letter of the first two names', () => {
	assert.strictEqual(initialsOf('Amara Okafor'), 'AO');
	assert.strictEqual(initialsOf('  ada  '), 'A');
	assert.strictEqual(initialsOf('Émile Zola Jr'), 'ÉZ');
});

void test('retention notices name their record kind and the relevant date', () => {
	const base: AccountRetentionNotice = {
		retirementId: 'r'.repeat(26),
		examId: 'x'.repeat(26),
		examTitle: 'Algorithms final',
		examSittingId: 's'.repeat(26),
		sittingStartAt: NOW - 2 * DAY,
		sittingEndAt: NOW - 2 * DAY + 3600_000,
		submissionId: 't'.repeat(26),
		category: 'browser_activity',
		state: 'grace',
		createdAt: NOW - DAY,
		retireAfter: NOW + DAY,
		deliveryState: 'accepted'
	};
	assert.deepStrictEqual(noticePresentation(base), {
		category: 'noticeBrowserActivity',
		when: 'noticeDeletedAfter',
		date: NOW + DAY
	});
	assert.strictEqual(
		noticePresentation({ ...base, state: 'canceled', canceledAt: NOW }).when,
		'noticeDeletionCanceled'
	);
	assert.strictEqual(noticePresentation({ ...base, state: 'retired' }).date, undefined);
});

void test('two-step verification reads its state, and few recovery codes need attention', () => {
	const mfa = {
		available: true,
		enabled: true,
		pending: false,
		recoveryRequired: false,
		recoveryCodesRemaining: 3,
		recoveryCodesTotal: 10
	};
	assert.deepStrictEqual(twoStepPresentation(mfa), {
		status: 'on',
		recovery: { remaining: 3, total: 10, low: true }
	});
	assert.strictEqual(
		twoStepPresentation({ ...mfa, recoveryCodesRemaining: 8 }).recovery?.low,
		false
	);
	assert.strictEqual(twoStepPresentation(undefined).status, 'notOffered');
	assert.strictEqual(
		twoStepPresentation({ ...mfa, available: false }).status,
		'serviceUnavailable'
	);
	assert.strictEqual(
		twoStepPresentation({ ...mfa, recoveryRequired: true }).status,
		'recoveryRequired'
	);
	assert.strictEqual(twoStepPresentation({ ...mfa, enabled: false }).status, 'off');
	assert.strictEqual(
		twoStepPresentation({ ...mfa, enabled: false, pending: true }).status,
		'pending'
	);
});

void test('institution providers read as single sign-on', () => {
	assert.strictEqual(providerKind('OIDC'), 'singleSignOn');
	assert.strictEqual(providerKind('cas'), 'singleSignOn');
	assert.strictEqual(providerKind('passkey'), 'other');
});

void test('each computer appears once: sessions join their registration, the rest stay apart', () => {
	const session: AccountSession = {
		id: 'b'.repeat(26),
		current: false,
		name: 'Firefox on Windows',
		client: 'web',
		platform: '',
		method: 'password',
		authenticationStrength: 'single_factor',
		createdAt: 1,
		lastActivityAt: 1,
		expiresAt: 2
	};
	const lab = desktop({});
	const library = desktop({ id: 'e'.repeat(26), name: 'Library PC 2' });
	const removed = desktop({ id: 'g'.repeat(26), revoked: true });
	const groups = groupSessions(
		[
			session,
			{
				...session,
				id: 'c'.repeat(26),
				current: true,
				client: 'desktop',
				desktopRegistrationId: lab.id
			}
		],
		[lab, library, removed]
	);
	assert.strictEqual(groups.current?.id, 'c'.repeat(26));
	assert.deepStrictEqual(
		groups.signedIn.map((entry) => [entry.session.id, entry.desktop?.id]),
		[
			['c'.repeat(26), lab.id],
			['b'.repeat(26), undefined]
		]
	);
	// The removed registration is a record, not a computer to list.
	assert.deepStrictEqual(
		groups.registeredOnly.map((entry) => entry.id),
		[library.id]
	);
	assert.strictEqual(sessionUnidentified(session), false);
	assert.strictEqual(sessionUnidentified({ ...session, client: 'unknown' }), true);
	assert.strictEqual(signInMessage(session), 'signInPassword');
	assert.strictEqual(
		signInMessage({ ...session, method: 'oidc', authenticationStrength: 'multi_factor' }),
		'signInSingleSignOnTwoStep'
	);
});

void test('desktops list this computer first', () => {
	const ordered = orderDesktops([desktop({}), desktop({ id: 'e'.repeat(26), current: true })]);
	assert.strictEqual(ordered[0]?.current, true);
	assert.strictEqual(platformKind('darwin'), 'platformMac');
	assert.strictEqual(platformKind('beos'), 'platformOther');
});

void test('token state is revoked, then expired, then disabled, else active', () => {
	assert.strictEqual(tokenState(token({}), NOW), 'active');
	assert.strictEqual(tokenState(token({ disabledAt: NOW - 1 }), NOW), 'disabled');
	assert.strictEqual(tokenState(token({ disabledAt: NOW - 1, expiresAt: NOW }), NOW), 'expired');
	assert.strictEqual(
		tokenState(token({ revokedAt: NOW - 1, expiresAt: NOW - 2 }), NOW),
		'revoked'
	);
	const groups = groupTokens(
		[token({}), token({ id: 'g'.repeat(26), disabledAt: NOW - 1 })],
		NOW
	);
	assert.strictEqual(groups.active.length, 1);
	assert.strictEqual(groups.inactive.length, 1);
});

void test('only working and disabled tokens offer actions, and only disabled ones re-enable', () => {
	assert.deepStrictEqual(tokenActions('active'), ['disable', 'revoke']);
	assert.deepStrictEqual(tokenActions('disabled'), ['enable', 'revoke']);
	assert.deepStrictEqual(tokenActions('expired'), []);
	assert.deepStrictEqual(tokenActions('revoked'), []);
});

void test('only an active token about to expire is called out', () => {
	assert.strictEqual(tokenExpiresSoon(token({ expiresAt: NOW + 6 * DAY }), NOW), 6);
	assert.strictEqual(tokenExpiresSoon(token({ expiresAt: NOW + 2 * 60 * 60 * 1000 }), NOW), 1);
	assert.strictEqual(tokenExpiresSoon(token({ expiresAt: NOW + 30 * DAY }), NOW), undefined);
	assert.strictEqual(
		tokenExpiresSoon(token({ expiresAt: NOW + DAY, disabledAt: NOW - 1 }), NOW),
		undefined
	);
});

void test('grantable scopes become grid rows with fixed action columns', () => {
	const scope = (name: string) => ({
		name,
		title: name,
		description: '',
		institutionWide: true,
		academicUnitIds: []
	});
	const rows = tokenScopeAreas([
		scope('exam.view'),
		scope('exam.publish'),
		scope('exam.manage.override'),
		scope('submission.release'),
		scope('exam.sitting.view'),
		scope('exam.archive')
	]);
	assert.deepStrictEqual(
		rows.map((row) => [row.area, row.anyone, Object.keys(row.cells), row.other.length]),
		[
			['exam', false, ['view', 'publish'], 1],
			['exam', true, ['manage'], 0],
			['submission', false, ['publish'], 0],
			['exam.sitting', false, ['view'], 0]
		]
	);
	assert.strictEqual(tokenAreaMessage('exam.sitting'), 'tokenAreaSitting');
	assert.strictEqual(tokenAreaMessage('toString'), undefined);
});

void test('a scope is grantable where the server says, and is titled from its catalogue', () => {
	const unit = 'u'.repeat(26);
	const anywhere = {
		name: 'exam.view',
		title: 'View exams',
		description: 'Read exams.',
		institutionWide: true,
		academicUnitIds: []
	};
	const scoped = {
		...anywhere,
		name: 'class.view',
		institutionWide: false,
		academicUnitIds: [unit]
	};
	assert.strictEqual(scopeGrantable(anywhere, undefined), true);
	assert.strictEqual(scopeGrantable(anywhere, unit), true);
	assert.strictEqual(scopeGrantable(scoped, undefined), false);
	assert.strictEqual(scopeGrantable(scoped, unit), true);
	assert.strictEqual(scopeGrantable(scoped, 'v'.repeat(26)), false);
	const grantable = { scopes: [anywhere], academicUnits: [], moreAcademicUnits: false };
	assert.strictEqual(scopeTitle('exam.view', grantable), 'View exams');
	assert.strictEqual(scopeTitle('user.view', grantable), 'user.view');
	assert.strictEqual(scopeTitle('exam.view', undefined), 'exam.view');
});

void test('history filters become the server query', () => {
	assert.deepStrictEqual(
		historyQuery({ period: 'all', kind: 'all', about: 'all', order: 'desc' }, NOW),
		{}
	);
	const query = historyQuery(
		{ period: 30, kind: 'tokens', about: 'subject', order: 'asc' },
		NOW + 1234
	);
	assert.strictEqual(query.createdAfter! % 60_000, 0);
	assert.ok(query.createdAfter! <= NOW + 1234 - 30 * DAY);
	assert.deepStrictEqual(query.events, historyEventGroups.find((g) => g.id === 'tokens')!.events);
	assert.strictEqual(query.relation, 'subject');
	assert.strictEqual(query.order, 'asc');
	const failed = historyQuery(
		{ period: 7, kind: 'failed', about: 'all', order: 'desc', before: NOW },
		NOW + 99 * DAY
	);
	assert.strictEqual(failed.status, 'fail');
	assert.strictEqual(failed.events, undefined);
	// Go to a date ends the period at that day instead of now.
	assert.strictEqual(failed.createdBefore, NOW);
	assert.ok(failed.createdAfter! <= NOW - 7 * DAY && failed.createdAfter! > NOW - 8 * DAY);
});

void test('runs of the same change fold into one row, shorter runs stay apart', () => {
	const entry = (id: string, event: string): AccountHistoryEntry => ({
		id: id.repeat(26),
		createdAt: NOW,
		event,
		failed: false,
		relation: 'actor',
		actor: 'self',
		summary: event
	});
	const runs = foldHistory([
		entry('a', 'profile_picture.changed'),
		entry('b', 'profile_picture.changed'),
		entry('c', 'profile_picture.changed'),
		entry('d', 'sign_in.succeeded'),
		entry('e', 'sign_in.succeeded')
	]);
	assert.deepStrictEqual(
		runs.map((run) => run.entries.length),
		[3, 1, 1]
	);
});

void test('a token draft needs a usable name and at least one scope', () => {
	assert.deepStrictEqual(validateTokenDraft({ name: 'Export', scopes: ['exam.view'] }), {});
	assert.deepStrictEqual(validateTokenDraft({ name: '   ', scopes: [] }), {
		name: 'tokenNameRequired',
		scopes: 'tokenScopesRequired'
	});
	assert.strictEqual(
		validateTokenDraft({ name: 'x'.repeat(257), scopes: ['a'] }).name,
		'tokenNameTooLong'
	);
	assert.strictEqual(
		validateTokenDraft({ name: 'tab\there', scopes: ['a'] }).name,
		'tokenNameInvalid'
	);
	assert.strictEqual(tokenExpiry(90, NOW), NOW + 90 * DAY);
});
