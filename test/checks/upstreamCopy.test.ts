import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconstructCopiedSource, verifyCopiedSource } from '../../build/checks/upstreamCopy.ts';

const header = '/* Copyright and license */\n';

void test('copy reconstruction inserts only the declared marker and preserves source bytes', () => {
	const source = `${header}\nimport { Example } from './example.js';\nexport const value = Example;\n`;
	assert.equal(reconstructCopiedSource(source, 'example', []), source);
	const expected = reconstructCopiedSource(source, 'example', [
		'namespace-path-translation',
		'provenance-marker-insertion'
	]);
	assert.equal(
		expected,
		`${header}// @proctor-vscode-port example\n${source.slice(header.length)}`
	);
	const transforms = ['namespace-path-translation', 'provenance-marker-insertion'];
	assert.doesNotThrow(() => verifyCopiedSource(source, expected, 'example', transforms));
	assert.throws(
		() =>
			verifyCopiedSource(
				source,
				expected.replace('import {', 'import type {'),
				'example',
				transforms
			),
		/cannot be reconstructed/
	);
	assert.throws(
		() =>
			verifyCopiedSource(
				source,
				expected.replace('value = Example', 'value = undefined'),
				'example',
				transforms
			),
		/cannot be reconstructed/
	);
	assert.throws(
		() => verifyCopiedSource(source, expected.replace('\n\n', '\n'), 'example', transforms),
		/cannot be reconstructed/
	);
});

void test('the admitted assertion rewrite preserves surrounding formatting and comments', () => {
	const source = `${header}const stack = (<any>error).stack;\n// (<Other>comment)\nconst text = '(<Other>string)';\n(<ErrorWithCode>error).code = 1;\n`;
	assert.equal(
		reconstructCopiedSource(source, 'example', ['erasable-syntax-rewrite']),
		`${header}const stack = (error as any).stack;\n// (<Other>comment)\nconst text = '(<Other>string)';\n(error as ErrorWithCode).code = 1;\n`
	);
	assert.throws(
		() =>
			reconstructCopiedSource(`${header}const result = (<Type>call());`, 'example', [
				'erasable-syntax-rewrite'
			]),
		/Unsupported/
	);
	assert.throws(
		() =>
			reconstructCopiedSource('const value = 1;', 'example', ['provenance-marker-insertion']),
		/license header/
	);
});
