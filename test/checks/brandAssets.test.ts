import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { globSync, lstatSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { repositoryPath, repositoryRoot } from '../../build/lib/paths.ts';

interface BrandSource {
	readonly path: string;
	readonly canonicalPath: string;
	readonly sha256: string;
}

interface BrandPlatform {
	readonly source: string;
	readonly format: string;
	readonly sizes: readonly number[];
}

const manifest = JSON.parse(
	readFileSync(repositoryPath('resources/branding/manifest.json'), 'utf8')
) as {
	readonly sourceRevision: string;
	readonly sources: Readonly<Record<string, BrandSource>>;
	readonly platforms: Readonly<Record<'windows' | 'macos' | 'linux', BrandPlatform>>;
};

void test('desktop brand copies match the accepted inventory and digests without a source checkout', () => {
	assert.match(manifest.sourceRevision, /^[a-f0-9]{40}$/);
	const paths = Object.values(manifest.sources).map(({ path }) => path);
	assert.equal(new Set(paths).size, paths.length);
	assert.deepEqual(
		globSync('resources/branding/**/*.{svg,png,ico,icns}', { cwd: repositoryRoot })
			.map((path) => path.replaceAll('\\', '/'))
			.sort(),
		[...paths].sort()
	);
	for (const source of Object.values(manifest.sources)) {
		assert.match(source.path, /^resources\/branding\/(source|platform)\//);
		assert.match(source.canonicalPath, /^brand\//);
		assert.ok(!source.canonicalPath.split('/').includes('..'));
		assert.match(source.sha256, /^[a-f0-9]{64}$/);
		const path = repositoryPath(source.path);
		assert.ok(lstatSync(path).isFile(), `${source.path} must be a regular package-local copy`);
		assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), source.sha256);
		if (source.path.endsWith('.svg')) {
			assert.match(source.canonicalPath, /^brand\/(marks|lockups)\/.*-(flat|25d)-/);
			assert.match(readFileSync(path, 'utf8'), /<svg\s/);
		}
	}
});

void test('the supplied Windows ICO retains its multiresolution PNG layers', () => {
	const icon = platformIcon('windows', 'ico');
	assert.equal(icon.readUInt16LE(0), 0);
	assert.equal(icon.readUInt16LE(2), 1);
	const count = icon.readUInt16LE(4);
	const sizes: number[] = [];
	let end = 6 + count * 16;
	for (let index = 0; index < count; index++) {
		const entry = 6 + index * 16;
		const size = icon[entry] || 256;
		assert.equal(icon[entry + 1] || 256, size);
		assert.equal(icon.readUInt16LE(entry + 4), 0);
		assert.equal(icon.readUInt16LE(entry + 6), 32);
		const length = icon.readUInt32LE(entry + 8);
		assert.equal(icon.readUInt32LE(entry + 12), end);
		assert.ok(end + length <= icon.length);
		assertPngSize(icon.subarray(end, end + length), size);
		end += length;
		sizes.push(size);
	}
	assert.equal(end, icon.length);
	assert.deepEqual(sizes, manifest.platforms.windows.sizes);
});

void test('the Apple Icon Composer ICNS retains its representations and metadata', () => {
	const icon = platformIcon('macos', 'icns');
	assert.equal(icon.subarray(0, 4).toString('ascii'), 'icns');
	assert.equal(icon.readUInt32BE(4), icon.length);
	const representations = new Map([
		['icp4', 16],
		['icp5', 32],
		['ic07', 128],
		['ic08', 256],
		['ic09', 512],
		['ic10', 1024],
		['ic11', 32],
		['ic12', 64],
		['ic13', 256],
		['ic14', 512]
	]);
	const seen = new Set<string>();
	let offset = 8;
	while (offset < icon.length) {
		const type = icon.subarray(offset, offset + 4).toString('ascii');
		const length = icon.readUInt32BE(offset + 4);
		assert.ok(length > 8 && offset + length <= icon.length);
		assert.ok(!seen.has(type), `Duplicate ICNS representation ${type}`);
		seen.add(type);
		if (type !== 'info') {
			const size = representations.get(type);
			assert.ok(size !== undefined, `Unexpected ICNS representation ${type}`);
			assertPngSize(icon.subarray(offset + 8, offset + length), size);
		}
		offset += length;
	}
	assert.equal(offset, icon.length);
	assert.deepEqual([...seen].sort(), [...representations.keys(), 'info'].sort());
	assert.deepEqual(
		[...new Set(representations.values())].sort((a, b) => a - b),
		manifest.platforms.macos.sizes
	);
});

void test('the supplied Linux icon is the accepted 512px PNG', () => {
	assert.deepEqual(manifest.platforms.linux.sizes, [512]);
	assertPngSize(platformIcon('linux', 'png'), 512);
});

function platformIcon(platform: 'windows' | 'macos' | 'linux', format: string): Buffer {
	const record = manifest.platforms[platform];
	assert.equal(record.format, format);
	const source = manifest.sources[record.source];
	assert.ok(source !== undefined);
	assert.ok(source.path.endsWith(`.${format}`));
	return readFileSync(repositoryPath(source.path));
}

function assertPngSize(png: Buffer, size: number): void {
	assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
	assert.equal(png.readUInt32BE(16), size);
	assert.equal(png.readUInt32BE(20), size);
}
