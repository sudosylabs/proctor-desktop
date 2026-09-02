import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('the admitted Codicon package and font asset are exact', () => {
	const packageMetadata = JSON.parse(
		readFileSync('node_modules/@vscode/codicons/package.json', 'utf8')
	) as {
		readonly license?: unknown;
		readonly version?: unknown;
	};
	assert.equal(packageMetadata.version, '0.0.46-38');
	assert.equal(packageMetadata.license, 'CC-BY-4.0');
	const font = readFileSync('node_modules/@vscode/codicons/dist/codicon.ttf');
	assert.equal(
		createHash('sha256').update(font).digest('hex'),
		'a832273ce3a515050017a0ffb36b1b8cbd9c9cfa11b025cdd9dfc0d456940225'
	);
});
