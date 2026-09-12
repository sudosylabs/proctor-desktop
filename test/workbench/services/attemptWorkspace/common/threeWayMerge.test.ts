import assert from 'node:assert';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import {
	decodeTextContent,
	mergeNonOverlappingText
} from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/threeWayMerge.ts';

test('three-way merge deterministically combines non-overlapping text changes', () => {
	assert.deepStrictEqual(
		mergeNonOverlappingText(
			'alpha\nbeta\ngamma\n',
			'ALPHA\nbeta\ngamma\n',
			'alpha\nbeta\nGAMMA\n'
		),
		{ kind: 'merged', value: 'ALPHA\nbeta\nGAMMA\n' }
	);
	assert.deepStrictEqual(mergeNonOverlappingText('one\ntwo\n', 'ONE\ntwo\n', 'REMOTE\ntwo\n'), {
		kind: 'overlap'
	});
	assert.deepStrictEqual(mergeNonOverlappingText('same', 'same', 'remote'), {
		kind: 'merged',
		value: 'remote'
	});
});

test('text decoding is explicit, media-aware and rejects malformed UTF-8', () => {
	assert.strictEqual(
		decodeTextContent(new TextEncoder().encode('valid'), 'text/plain; charset=utf-8'),
		'valid'
	);
	assert.strictEqual(decodeTextContent(new Uint8Array([0xff]), 'text/plain'), undefined);
	assert.strictEqual(
		decodeTextContent(new TextEncoder().encode('valid'), 'application/octet-stream'),
		undefined
	);
});
