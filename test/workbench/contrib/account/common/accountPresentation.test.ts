import assert from 'node:assert';
import { test } from 'node:test';

import type {
	AccountDesktop,
	AccountRetentionNotice,
	AccountToken
} from '../../../../../src/prctr/platform/account/common/accountProtocol.ts';
import {
	calendarDaysBefore,
	desktopShape,
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
	relativeDay,
	historyActorMessage,
	historyEventGroups,
	historyEventMessage,
	historyQuery,
	scopeGrantable,
	scopeTitle,
	tokenActions,
	tokenExpiry,
	tokenShape,
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

void test('relative days follow the local calendar, not 24-hour spans', () => {
	const lateYesterday = new Date(2026, 10, 6, 23, 30).getTime();
	assert.strictEqual(relativeDay(NOW - 60_000, NOW), 'today');
	assert.strictEqual(relativeDay(lateYesterday, NOW), 'yesterday');
	assert.strictEqual(relativeDay(NOW - 3 * DAY, NOW), 'other');
	assert.strictEqual(calendarDaysBefore(new Date(2026, 10, 1, 1).getTime(), NOW), 6);
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
		shape: 'active',
		recovery: { remaining: 3, total: 10, low: true }
	});
	assert.strictEqual(
		twoStepPresentation({ ...mfa, recoveryCodesRemaining: 8 }).recovery?.low,
		false
	);
	assert.strictEqual(twoStepPresentation(undefined).status, 'notOffered');
	assert.strictEqual(twoStepPresentation({ ...mfa, available: false }).shape, 'attention');
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

void test('sessions split into this computer and the rest', () => {
	const session = {
		id: 'b'.repeat(26),
		current: false,
		name: '',
		client: 'web',
		method: 'password',
		createdAt: 1,
		lastActivityAt: 1,
		expiresAt: 2
	};
	const groups = groupSessions([session, { ...session, id: 'c'.repeat(26), current: true }]);
	assert.strictEqual(groups.current?.id, 'c'.repeat(26));
	assert.deepStrictEqual(
		groups.others.map((item) => item.id),
		['b'.repeat(26)]
	);
});

void test('desktops list this computer first and read their state by shape', () => {
	const ordered = orderDesktops([desktop({}), desktop({ id: 'e'.repeat(26), current: true })]);
	assert.strictEqual(ordered[0]?.current, true);
	assert.strictEqual(desktopShape(desktop({ current: true })), 'active');
	assert.strictEqual(desktopShape(desktop({})), 'idle');
	assert.strictEqual(desktopShape(desktop({ revoked: true })), 'off');
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
	assert.strictEqual(tokenShape('disabled'), 'idle');
	assert.strictEqual(tokenShape('revoked'), 'off');
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

void test('history filters become the server query, and unknown events read generically', () => {
	assert.deepStrictEqual(
		historyQuery({ period: 'all', group: 'all', relation: 'all', outcome: 'all' }, NOW),
		{}
	);
	const query = historyQuery(
		{ period: 30, group: 'tokens', relation: 'subject', outcome: 'fail' },
		NOW + 1234
	);
	assert.strictEqual(query.createdAfter! % 60_000, 0);
	assert.ok(query.createdAfter! <= NOW + 1234 - 30 * DAY);
	assert.deepStrictEqual(query.events, historyEventGroups.find((g) => g.id === 'tokens')!.events);
	assert.strictEqual(query.status, 'fail');
	assert.strictEqual(query.relation, 'subject');
	assert.strictEqual(historyEventMessage('sign_in.failed'), 'historyEventSignInFailed');
	assert.strictEqual(historyEventMessage('future.event'), 'historyEventOther');
	assert.strictEqual(historyEventMessage('toString'), 'historyEventOther');
	const entry = {
		id: 'e'.repeat(26),
		createdAt: NOW,
		event: 'role.granted',
		failed: false,
		relation: 'subject' as const,
		actor: 'administrator' as const
	};
	assert.strictEqual(historyActorMessage(entry), 'historyByAdministrator');
	assert.strictEqual(historyActorMessage({ ...entry, actor: 'system' }), 'historyBySystem');
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
