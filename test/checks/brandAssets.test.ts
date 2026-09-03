import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pngDimensions } from '../../build/generators/brandAssets.ts';
import { repositoryPath } from '../../build/lib/paths.ts';

const windowsSizes = [16, 20, 24, 32, 40, 48, 64, 256];
const macosChunks = [
	['icp4', 16],
	['icp5', 32],
	['icp6', 64],
	['ic07', 128],
	['ic08', 256],
	['ic09', 512],
	['ic10', 1024]
] as const;

void test('generated Windows icon contains every exact PNG layer', () => {
	const icon = readFileSync(repositoryPath('resources/branding/platform/win32/proctor.ico'));
	const view = new DataView(icon.buffer, icon.byteOffset, icon.byteLength);
	assert.equal(view.getUint16(0, true), 0);
	assert.equal(view.getUint16(2, true), 1);
	assert.equal(view.getUint16(4, true), windowsSizes.length);
	for (const [index, size] of windowsSizes.entries()) {
		const entry = 6 + index * 16;
		assert.equal(icon[entry], size === 256 ? 0 : size);
		assert.equal(icon[entry + 1], size === 256 ? 0 : size);
		assert.equal(view.getUint16(entry + 4, true), 1);
		assert.equal(view.getUint16(entry + 6, true), 32);
		const length = view.getUint32(entry + 8, true);
		const offset = view.getUint32(entry + 12, true);
		assert.deepEqual(pngDimensions(icon.subarray(offset, offset + length)), {
			width: size,
			height: size
		});
	}
});

void test('generated macOS icon contains every accepted ICNS representation', () => {
	const icon = readFileSync(repositoryPath('resources/branding/platform/darwin/proctor.icns'));
	const view = new DataView(icon.buffer, icon.byteOffset, icon.byteLength);
	assert.equal(icon.subarray(0, 4).toString('ascii'), 'icns');
	assert.equal(view.getUint32(4, false), icon.byteLength);
	let offset = 8;
	for (const [type, size] of macosChunks) {
		assert.equal(icon.subarray(offset, offset + 4).toString('ascii'), type);
		const length = view.getUint32(offset + 4, false);
		assert.deepEqual(pngDimensions(icon.subarray(offset + 8, offset + length)), {
			width: size,
			height: size
		});
		offset += length;
	}
	assert.equal(offset, icon.byteLength);
});

void test('Linux icon and generated manifest describe the reviewed package inputs', () => {
	const icon = readFileSync(repositoryPath('resources/branding/platform/linux/proctor.png'));
	assert.deepEqual(pngDimensions(icon), { width: 512, height: 512 });
	const manifest = JSON.parse(
		readFileSync(repositoryPath('resources/branding/generated/manifest.json'), 'utf8')
	) as { readonly generatedBy: string; readonly outputs: readonly { readonly path: string }[] };
	assert.equal(manifest.generatedBy, 'brand.assets');
	assert.deepEqual(
		manifest.outputs.slice(-3).map((output) => output.path),
		[
			'resources/branding/platform/win32/proctor.ico',
			'resources/branding/platform/darwin/proctor.icns',
			'resources/branding/platform/linux/proctor.png'
		]
	);
});
