import assert from 'node:assert';
import { test } from 'node:test';

import {
	AuthenticatedNavigationModel,
	type AuthenticatedLocation
} from '../../../../../src/prctr/workbench/contrib/authenticated/common/authenticatedNavigationModel.ts';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/common/upstream/upstreamTestUtils.ts';

const store = ensureNoDisposablesAreLeakedInTestSuite();

function model(areas: readonly string[], initial: string): AuthenticatedNavigationModel {
	return store.add(new AuthenticatedNavigationModel(areas, initial));
}

void test('only server-listed product areas become destinations, in rail order', () => {
	const navigation = model(
		['administration', 'account', 'student_activity', 'settings'],
		'administration'
	);
	assert.deepStrictEqual(navigation.destinations, ['activity', 'administration']);
	assert.strictEqual(navigation.location.destination, 'administration');
	assert.ok(navigation.isAvailable('account'));
	assert.ok(!navigation.isAvailable('management'));
});

void test('an unavailable initial destination falls back to the first area, then Account', () => {
	assert.strictEqual(model(['exam_management'], 'settings').location.destination, 'management');
	assert.strictEqual(model([], 'activity').location.destination, 'account');
	assert.strictEqual(model(['student_activity'], 'account').location.destination, 'account');
});

void test('navigation records history and back and forward retrace it', () => {
	const navigation = model(['student_activity', 'exam_management'], 'activity');
	const changes: AuthenticatedLocation[] = [];
	store.add(navigation.onDidChange(({ current }) => changes.push(current)));
	assert.ok(!navigation.canGoBack && !navigation.canGoForward);
	assert.ok(navigation.navigate({ activityView: 'upcoming' }));
	assert.ok(navigation.navigate({ destination: 'account', accountPage: 'sessions' }));
	assert.ok(!navigation.navigate({ destination: 'account', accountPage: 'sessions' }));
	assert.ok(navigation.back());
	assert.deepStrictEqual(navigation.location, {
		destination: 'activity',
		activityView: 'upcoming',
		accountPage: 'profile'
	});
	assert.ok(navigation.canGoForward);
	assert.ok(navigation.forward());
	assert.strictEqual(navigation.location.accountPage, 'sessions');
	assert.ok(navigation.back() && navigation.navigate({ destination: 'management' }));
	assert.ok(!navigation.canGoForward, 'a new place clears forward history');
	assert.strictEqual(changes.length, 6);
});

void test('losing an area moves away from it and history skips it', () => {
	const navigation = model(['student_activity', 'administration'], 'activity');
	navigation.navigate({ destination: 'administration' });
	navigation.navigate({ destination: 'account' });
	navigation.setAreas(['administration']);
	assert.deepStrictEqual(navigation.destinations, ['administration']);
	assert.ok(navigation.back());
	assert.strictEqual(navigation.location.destination, 'administration');
	assert.ok(!navigation.canGoBack, 'the removed Activity area is skipped');
	navigation.setAreas([]);
	assert.strictEqual(navigation.location.destination, 'account');
});
