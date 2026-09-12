import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePreviewImage } from '../../../../src/prctr/workbench/services/resourcePreview/common/imageDimensions.js';
import { MarkdownItEngine } from '../../../../src/prctr/workbench/services/resourcePreview/browser/markdown/src/markdownEngine.js';
import { githubSlugifier } from '../../../../src/prctr/workbench/services/resourcePreview/browser/markdown/src/slugify.js';
import { defaultMarkdownConfiguration } from '../../../../src/prctr/workbench/services/resourcePreview/browser/markdownTypes.js';
import { URI } from '../../../../src/prctr/base/common/uri.js';

void test('image header validation rejects decoded allocation attacks before decoding', () => {
	const bytes = new Uint8Array(24);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x89504e47);
	view.setUint32(4, 0x0d0a1a0a);
	bytes.set([73, 72, 68, 82], 12);
	view.setUint32(16, 2);
	view.setUint32(20, 3);
	assert.deepEqual(validatePreviewImage(bytes, 'image/png'), { width: 2, height: 3 });
	view.setUint32(16, 0xffffffff);
	assert.throws(() => validatePreviewImage(bytes, 'image/png'), /dimensions/);
	assert.throws(() => validatePreviewImage(bytes, 'image/svg+xml'), /type/);
	assert.throws(() => validatePreviewImage(bytes, 'application/octet-stream'), /Unsupported/);
	assert.throws(() => validatePreviewImage(bytes.subarray(0, 3), 'image/png'), /size/);
});

void test('upstream Markdown renderer preserves tables source lines slugs highlighting and frontmatter', async () => {
	const engine = new MarkdownItEngine(() => defaultMarkdownConfiguration, githubSlugifier);
	const result = await engine.render(
		'---\ntitle: Example\n---\n# A title\n# A title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```jsonc\n{"a": true}\n```'
	);
	assert.match(result.html, /class="frontmatter"/);
	assert.match(result.html, /id="a-title"/);
	assert.match(result.html, /id="a-title-1"/);
	assert.match(result.html, /data-line="3"/);
	assert.match(result.html, /<table/);
	assert.match(result.html, /hljs-attr/);
});

void test('asset scope changes re-resolve cached Markdown tokens and unsafe schemes are rejected', async () => {
	const engine = new MarkdownItEngine(() => defaultMarkdownConfiguration, githubSlugifier);
	const document = {
		uri: URI.parse('prctr-workspace://attempt/readme.md'),
		version: 1,
		getText: () => '![chart](chart.png) [bad](command:open) [also bad](javascript:alert)'
	};
	const first = await engine.render(document, { resolve: () => 'blob:first' });
	const second = await engine.render(document, { resolve: () => 'blob:second' });
	assert.match(first.html, /src="blob:first"/);
	assert.match(second.html, /src="blob:second"/);
	assert.doesNotMatch(second.html, /href="(?:command|javascript):/);
	assert.deepEqual([...second.containingImages], ['chart.png']);
});

void test('typographer changes invalidate source token cache', async () => {
	let configuration = defaultMarkdownConfiguration;
	const engine = new MarkdownItEngine(() => configuration, githubSlugifier);
	const document = {
		uri: URI.parse('prctr-workspace://attempt/readme.md'),
		version: 1,
		getText: () => '(c)'
	};
	assert.match((await engine.render(document)).html, /\(c\)/);
	configuration = { ...configuration, typographer: true };
	assert.match((await engine.render(document)).html, /©/);
});

void test('the full upstream image selector admits bounded animation vector bitmap icon and AVIF metadata', () => {
	const gif = Uint8Array.from([71, 73, 70, 56, 57, 97, 2, 0, 3, 0]);
	assert.deepEqual(validatePreviewImage(gif, 'image/gif'), { width: 2, height: 3 });
	const svg = new TextEncoder().encode(
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 30"><rect width="20" height="30"/></svg>'
	);
	assert.deepEqual(validatePreviewImage(svg, 'image/svg+xml'), { width: 20, height: 30 });
	const bmp = new Uint8Array(26);
	bmp.set([66, 77]);
	new DataView(bmp.buffer).setUint32(18, 2, true);
	new DataView(bmp.buffer).setInt32(22, -3, true);
	assert.deepEqual(validatePreviewImage(bmp, 'image/bmp'), { width: 2, height: 3 });
	const ico = new Uint8Array(22);
	ico.set([0, 0, 1, 0, 1, 0, 16, 24]);
	assert.deepEqual(validatePreviewImage(ico, 'image/x-icon'), { width: 16, height: 24 });
	const webp = new Uint8Array(30);
	webp.set(new TextEncoder().encode('RIFF'), 0);
	webp.set(new TextEncoder().encode('WEBPVP8X'), 8);
	webp[20] = 2; // The animation flag is supported, unlike the previous static-only guard.
	webp[24] = 1;
	webp[27] = 2;
	assert.deepEqual(validatePreviewImage(webp, 'image/webp'), { width: 2, height: 3 });
	const box = (kind: string, content: Uint8Array): Uint8Array => {
		const value = new Uint8Array(content.length + 8);
		new DataView(value.buffer).setUint32(0, value.length);
		value.set(new TextEncoder().encode(kind), 4);
		value.set(content, 8);
		return value;
	};
	const size = new Uint8Array(12);
	new DataView(size.buffer).setUint32(4, 20);
	new DataView(size.buffer).setUint32(8, 30);
	const properties = box('iprp', box('ipco', box('ispe', size)));
	const metadata = new Uint8Array(properties.length + 4);
	metadata.set(properties, 4);
	const avif = new Uint8Array([
		...box('ftyp', new TextEncoder().encode('avif')),
		...box('meta', metadata)
	]);
	assert.deepEqual(validatePreviewImage(avif, 'image/avif'), { width: 20, height: 30 });
});
