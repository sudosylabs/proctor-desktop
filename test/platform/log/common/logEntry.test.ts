import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import { ForwardingLogService } from '../../../../src/prctr/platform/log/browser/forwardingLogService.ts';
import {
	MAX_LOG_MESSAGE,
	validateLogEntry,
	type LogArea,
	type LogEntryLevel
} from '../../../../src/prctr/platform/log/common/logEntry.ts';

suite('Window log entries', () => {
	test('an entry is exactly a known level, a known area and a bounded message', () => {
		assert.deepStrictEqual(
			validateLogEntry({
				level: 'info',
				area: 'administration',
				message: 'read users 120 ms'
			}),
			{ level: 'info', area: 'administration', message: 'read users 120 ms' }
		);
		for (const refused of [
			{ level: 'verbose', area: 'workbench', message: 'x' },
			{ level: 'info', area: 'anywhere', message: 'x' },
			{ level: 'info', area: 'workbench', message: '' },
			{ level: 'info', area: 'workbench', message: 'x'.repeat(MAX_LOG_MESSAGE + 1) },
			{ level: 'info', area: 'workbench', message: 'x', extra: true },
			'info: x',
			null
		])
			assert.throws(() => validateLogEntry(refused), TypeError);
	});

	test('the window logger forwards at its level and keeps only safe arguments', () => {
		const sent: [LogEntryLevel, LogArea, string][] = [];
		const log = new ForwardingLogService((level, area, message) =>
			sent.push([level, area, message])
		);
		log.debug('hidden below Info');
		log.info('read users', 120, true, { email: 'someone@example.test' }, 'free text');
		log.error(new TypeError('bad response'));
		assert.deepStrictEqual(sent, [
			['info', 'workbench', 'read users 120 true'],
			['error', 'workbench', 'TypeError: bad response']
		]);
		log.dispose();
	});
});
