import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isPreviewImageDimensionAllowed,
	matchesPreviewImageMediaType
} from '../../../../src/prctr/workbench/services/resourcePreview/common/imageDimensions.js';
import { MarkdownItEngine } from '../../../../src/prctr/workbench/services/resourcePreview/browser/markdown/src/markdownEngine.js';
import { githubSlugifier } from '../../../../src/prctr/workbench/services/resourcePreview/browser/markdown/src/slugify.js';
import { defaultMarkdownConfiguration } from '../../../../src/prctr/workbench/services/resourcePreview/browser/markdownTypes.js';
import { URI } from '../../../../src/prctr/base/common/uri.js';

void test('image admission matches declared container types and bounds decoded dimensions', () => {
	const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	assert.equal(matchesPreviewImageMediaType(png, 'image/png'), true);
	assert.equal(matchesPreviewImageMediaType(png, 'image/jpeg'), false);
	assert.equal(matchesPreviewImageMediaType(png, 'image/svg+xml'), false);
	assert.equal(matchesPreviewImageMediaType(png, 'application/octet-stream'), false);
	assert.equal(isPreviewImageDimensionAllowed(2, 3), true);
	assert.equal(isPreviewImageDimensionAllowed(0xffffffff, 3), false);
	assert.equal(isPreviewImageDimensionAllowed(4096, 4097), false);
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

void test('the full upstream image selector recognizes animation bitmap icon and AVIF containers', () => {
	const gif = Uint8Array.from([71, 73, 70, 56, 57, 97, 2, 0, 3, 0]);
	assert.equal(matchesPreviewImageMediaType(gif, 'image/gif'), true);
	const bmp = new Uint8Array(26);
	bmp.set([66, 77]);
	assert.equal(matchesPreviewImageMediaType(bmp, 'image/bmp'), true);
	const ico = new Uint8Array(22);
	ico.set([0, 0, 1, 0, 1, 0, 16, 24]);
	assert.equal(matchesPreviewImageMediaType(ico, 'image/x-icon'), true);
	const webp = new Uint8Array(30);
	webp.set(new TextEncoder().encode('RIFF'), 0);
	webp.set(new TextEncoder().encode('WEBPVP8X'), 8);
	assert.equal(matchesPreviewImageMediaType(webp, 'image/webp'), true);
	const avif = new Uint8Array(20);
	new DataView(avif.buffer).setUint32(0, avif.byteLength);
	avif.set(new TextEncoder().encode('ftypavif'), 4);
	assert.equal(matchesPreviewImageMediaType(avif, 'image/avif'), true);
	const avifOutsideFileType = new Uint8Array(24);
	new DataView(avifOutsideFileType.buffer).setUint32(0, 16);
	avifOutsideFileType.set(new TextEncoder().encode('ftypmif1'), 4);
	avifOutsideFileType.set(new TextEncoder().encode('avif'), 20);
	assert.equal(matchesPreviewImageMediaType(avifOutsideFileType, 'image/avif'), false);
});
