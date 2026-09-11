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
	assert.equal(packageMetadata.version, '0.0.46-39');
	assert.equal(packageMetadata.license, 'CC-BY-4.0');
	const font = readFileSync('node_modules/@vscode/codicons/dist/codicon.ttf');
	assert.equal(
		createHash('sha256').update(font).digest('hex'),
		'7f8ca3f24941bbec04dc5adb0e3e65a8e50cf9a0c76ac12af5a2e74acccda3ab'
	);
});
