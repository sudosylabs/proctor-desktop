import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createMatchers,
	type MatcherWithPriority
} from '../../../../src/prctr/platform/theme/common/textMateScopeMatcher.js';
import { parse } from '../../../../src/prctr/platform/theme/common/plistParser.js';
import {
	FontStyle,
	MetadataConsts,
	StandardTokenType,
	TokenMetadata
} from '../../../../src/prctr/platform/theme/common/encodedTokenAttributes.js';
import { generateTokensCSSForFontMap } from '../../../../src/prctr/platform/theme/common/tokenization.js';

void test('TextMate selectors preserve priority, conjunction, alternatives and subtraction', () => {
	const matchers: MatcherWithPriority<string[]>[] = [];
	createMatchers(
		'L:source.json string - comment, R:(keyword | constant)',
		(names, scopes) => (names.every((name) => scopes.includes(name)) ? names.length : -1),
		matchers
	);
	assert.equal(matchers.length, 2);
	assert.equal(matchers[0]?.priority, -1);
	assert.equal(matchers[1]?.priority, 1);
	assert.ok(matchers[0]!.matcher(['source.json', 'string']) >= 0);
	assert.equal(matchers[0]!.matcher(['source.json', 'string', 'comment']), -1);
	assert.equal(matchers[0]!.matcher(['source.json']), -1);
	assert.ok(matchers[1]!.matcher(['keyword']) >= 0);
	assert.ok(matchers[1]!.matcher(['constant']) >= 0);
	assert.equal(matchers[1]!.matcher(['string']), -1);
});

void test('theme plist preserves nested settings, entities, scalar values, BOM and comments', () => {
	const value: unknown = parse(
		'\ufeff<?xml version="1.0"?><!DOCTYPE plist><plist version="1.0"><!-- theme -->' +
			'<dict><key>name</key><string>A &amp; B</string><key>settings</key><array><dict><key>scope</key><string>string</string><key>settings</key><dict><key>foreground</key><string>#123456</string></dict></dict></array>' +
			'<key>enabled</key><true/><key>count</key><integer>3</integer><key>scale</key><real>1.5</real></dict></plist>'
	);
	assert.deepEqual(value, {
		name: 'A & B',
		settings: [{ scope: 'string', settings: { foreground: '#123456' } }],
		enabled: true,
		count: 3,
		scale: 1.5
	});
	assert.throws(() => parse('<plist><dict><string>no key</string></dict></plist>'));
});

void test('token metadata preserves all font styles, token identity and composed decoration', () => {
	const metadata =
		(7 |
			(StandardTokenType.String << MetadataConsts.TOKEN_TYPE_OFFSET) |
			MetadataConsts.BALANCED_BRACKETS_MASK |
			(15 << MetadataConsts.FONT_STYLE_OFFSET) |
			(3 << MetadataConsts.FOREGROUND_OFFSET) |
			(2 << MetadataConsts.BACKGROUND_OFFSET)) >>>
		0;
	assert.equal(TokenMetadata.getLanguageId(metadata), 7);
	assert.equal(TokenMetadata.getTokenType(metadata), StandardTokenType.String);
	assert.equal(TokenMetadata.containsBalancedBrackets(metadata), true);
	assert.equal(
		TokenMetadata.getFontStyle(metadata),
		FontStyle.Bold | FontStyle.Italic | FontStyle.Underline | FontStyle.Strikethrough
	);
	assert.equal(TokenMetadata.getForeground(metadata), 3);
	assert.equal(TokenMetadata.getBackground(metadata), 2);
	assert.equal(TokenMetadata.getClassNameFromMetadata(metadata), 'mtk3 mtki mtkb mtku mtks');
	assert.match(
		TokenMetadata.getInlineStyleFromMetadata(metadata, ['', '', '', '#123456']),
		/text-decoration: underline line-through/
	);
	assert.deepEqual(TokenMetadata.getPresentationFromMetadata(metadata), {
		foreground: 3,
		bold: true,
		italic: true,
		underline: true,
		strikethrough: true
	});
});

void test('font token CSS preserves family and size rules without repeating shared classes', () => {
	const options = {
		fontFamily: 'monospace',
		fontSizeMultiplier: 1.25,
		lineHeightMultiplier: 1.5
	};
	const css = generateTokensCSSForFontMap([options, options]);
	assert.equal(css.match(/font-family: monospace/g)?.length, 1);
	assert.match(css, /font-size: calc\(var\(--editor-font-size\)\*1.25\)/);
});
