/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';

import { test } from '../../../base/common/upstream/testAdapter.ts';
import {
	attachEvent,
	hostEvent,
	PRINT_BLOCKED
} from '../../../../src/prctr/platform/native/electron-main/candidateHostEvents.ts';

test('the attach event carries the native window identity from the media source ID', () => {
	assert.deepStrictEqual(attachEvent('window:123456:0'), { attach: { window: '123456' } });
	assert.strictEqual(attachEvent('screen:1:0'), undefined);
	assert.strictEqual(attachEvent('window:abc:0'), undefined);
});

test('window state maps onto the agent vocabulary and an unknown presence fails closed', () => {
	assert.deepStrictEqual(
		hostEvent({
			kind: 'state_transition',
			window: {
				certainty: 'complete',
				presence: 'present',
				focus: 'focused',
				visibility: 'not_visible',
				placement: 'maximized'
			}
		}),
		{
			state: {
				presence: 'present',
				focus: 'focused',
				visibility: 'hidden',
				placement: 'maximized'
			}
		}
	);
	const unknown = hostEvent({
		kind: 'state_refresh',
		window: {
			certainty: 'unknown',
			presence: 'unknown',
			focus: 'unknown',
			visibility: 'unknown',
			placement: 'unknown'
		}
	});
	assert.strictEqual(
		unknown !== undefined && 'state' in unknown ? unknown.state.presence : '',
		'absent'
	);
	assert.deepStrictEqual(hostEvent({ kind: 'close_attempt' }), { close_attempted: {} });
	assert.deepStrictEqual(PRINT_BLOCKED, { print_blocked: {} });
});
