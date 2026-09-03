import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSource } from '../../build/checks/source.ts';
import { FileSystemRepository, VirtualRepository } from '../../build/checks/repository.ts';

const real = new FileSystemRepository(process.cwd());
const policy = real.read('build/policies/source-boundaries.json');

function repository(importer: string): VirtualRepository {
	return new VirtualRepository({
		'build/policies/source-boundaries.json': policy,
		'package.json': '{"dependencies":{}}\n',
		'resources/branding/source/mark.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
		[importer]:
			"import mark from '../../../../resources/branding/source/mark.svg';\nvoid mark;\n"
	});
}

void test('browser source may statically own a packaged image asset', () => {
	const diagnostics = analyzeSource(
		repository('src/prctr/workbench/browser/assetOwner.ts')
	).diagnostics;
	assert.deepEqual(diagnostics, []);
});

void test('environment-neutral source cannot acquire a renderer asset', () => {
	const diagnostics = analyzeSource(
		repository('src/prctr/base/common/assetOwner.ts')
	).diagnostics;
	assert.ok(
		diagnostics.some((item) => /common source imports renderer asset/.test(item.problem))
	);
});
