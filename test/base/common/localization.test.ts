import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	createLocalization,
	defineMessage,
	getMessagePlaceholders
} from '../../../src/prctr/base/common/localization.ts';
import {
	configureVSCodeNls,
	localize,
	localize2
} from '../../../src/prctr/base/common/vscodeNls.ts';

const greeting = defineMessage({
	id: 'test.localization.greeting',
	defaultMessage: 'Hello, {name}. You have {count} tasks. Use {{ and }} for braces.',
	description: 'Greets a person and reports their task count.'
});

void test('named localization validates values and preserves escaped braces', () => {
	const localization = createLocalization({ requestedLocale: 'en-US', messages: [greeting] });
	assert.equal(
		localization.format(greeting, { name: 'Amina', count: 2 }),
		'Hello, Amina. You have 2 tasks. Use { and } for braces.'
	);
	assert.deepEqual(greeting.placeholders, ['name', 'count']);
	assert.throws(
		() => localization.format(greeting, { name: 'Amina' }),
		/missing placeholder: count/u
	);
	assert.throws(
		() => localization.format(greeting, { name: 'Amina', count: 2, extra: true }),
		/unknown placeholder: extra/u
	);
});

void test('catalog resolution falls back by locale and owns text direction', () => {
	const localization = createLocalization({
		requestedLocale: 'ar-EG',
		messages: [greeting],
		catalogs: [
			{
				locale: 'ar',
				direction: 'rtl',
				messages: {
					'test.localization.greeting':
						'مرحبًا، {name}. لديك {count} مهام. استخدم {{ و }} للأقواس.'
				}
			}
		]
	});
	assert.equal(localization.locale, 'ar');
	assert.equal(localization.direction, 'rtl');
	assert.equal(
		localization.format(greeting, { name: 'أمينة', count: 2 }),
		'مرحبًا، أمينة. لديك 2 مهام. استخدم { و } للأقواس.'
	);
});

void test('catalogs reject unknown messages and placeholder drift', () => {
	assert.throws(
		() =>
			createLocalization({
				requestedLocale: 'fr',
				messages: [greeting],
				catalogs: [{ locale: 'fr', direction: 'ltr', messages: { unknown: 'Inconnu' } }]
			}),
		/unknown message: unknown/u
	);
	assert.throws(
		() =>
			createLocalization({
				requestedLocale: 'fr',
				messages: [greeting],
				catalogs: [
					{
						locale: 'fr',
						direction: 'ltr',
						messages: { 'test.localization.greeting': 'Bonjour, {person}.' }
					}
				]
			}),
		/different placeholders/u
	);
});

void test('pseudo localization expands the formatted result without mutable global state', () => {
	const localization = createLocalization({ requestedLocale: 'pseudo', messages: [greeting] });
	const value = localization.format(greeting, { name: 'Ada', count: 1 });
	assert.equal(localization.locale, 'pseudo');
	assert.equal(localization.direction, 'ltr');
	assert.match(value, /^［.*］$/u);
	assert.match(value, /Adaa/u);
	assert.ok(Object.isFrozen(localization));
});

void test('message declarations reject malformed identifiers, braces, and placeholder names', () => {
	assert.throws(
		() =>
			defineMessage({
				id: 'Not Stable',
				defaultMessage: 'Message',
				description: 'Invalid identifier.'
			}),
		/Invalid localization message identifier/u
	);
	assert.throws(() => getMessagePlaceholders('Bad {name'), /unmatched opening brace/u);
	assert.throws(() => getMessagePlaceholders('Bad {0}'), /invalid placeholder/u);
});

void test('VS Code compatibility preserves positional formatting and localize2 originals', () => {
	const args = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11'];
	assert.equal(localize('key', '{0} {1} {9} {10} {11}', ...args), 'a0 a1 a9 a10 a11');
	assert.equal(localize('key', '{0} {1}', 'a', {} as unknown as string), 'a {1}');
	assert.deepEqual(localize2('key', '{10}', ...args), { original: 'a10', value: 'a10' });
	configureVSCodeNls({ language: 'fr', messages: ['Traduit {0}'] });
	assert.equal(
		(localize as unknown as (index: number, fallback: string, value: string) => string)(
			0,
			'Fallback {0}',
			'ici'
		),
		'Traduit ici'
	);
	assert.deepEqual(
		(
			localize2 as unknown as (
				index: number,
				fallback: string,
				value: string
			) => { original: string; value: string }
		)(0, 'Fallback {0}', 'ici'),
		{ original: 'Fallback ici', value: 'Traduit ici' }
	);
	assert.throws(() => configureVSCodeNls({ language: 'en' }), /already configured/u);
});
