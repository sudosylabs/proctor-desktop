import { validateProductWindowChromeUpdate } from '../../../../src/prctr/platform/windows/common/windowChrome.ts';
import assert from 'node:assert';
import { test } from 'node:test';
import { ColorThemeData } from '../../../../src/prctr/platform/theme/common/colorThemeData.ts';
import { normalizeColorCustomizations } from '../../../../src/prctr/platform/theme/common/colorCustomizations.ts';
import { loadPackagedTheme } from '../../../../src/prctr/platform/theme/common/packagedThemeLoader.ts';
import { getTheme } from '../../../../src/prctr/platform/theme/common/themes.ts';
import { BUNDLED_THEMES } from '../../../../src/prctr/platform/theme/common/bundledThemes.ts';
import { parseSettingsDocument } from '../../../../src/prctr/platform/settings/common/settingsDocument.ts';
import { EffectiveSettings } from '../../../../src/prctr/platform/settings/common/settingsResolution.ts';
import { Color } from '../../../../src/prctr/base/common/color.ts';

const hex = (theme: ColorThemeData, id: string) => {
	const value = theme.getColor(id);
	return value && Color.Format.CSS.formatHexA(value, true);
};

void test('theme data preserves upstream global, scoped, wildcard and default precedence', () => {
	const model = ColorThemeData.createUnloadedTheme('vs-dark', { 'button.background': '#112233' });
	model.settingsId = 'GitHub Dark Default';
	model.setCustomColors({
		'button.background': '#223344',
		'[GitHub*]': { 'button.background': '#334455' },
		'[GitHub Dark Default]': { 'button.background': '#445566' }
	});
	assert.equal(hex(model, 'button.background'), '#445566');
	model.setCustomColors({ '[Other][*Dark*]': { 'button.background': '#abcdef' } });
	assert.equal(hex(model, 'button.background'), '#abcdef');
	model.setCustomColors({ 'button.background': 'default' });
	assert.equal(model.defines('button.background'), false);
	assert.equal(model.getColor('button.background', false), undefined);
	assert.equal(
		hex(model, 'button.background'),
		Color.Format.CSS.formatHexA(model.getDefault('button.background')!, true)
	);
	model.setCustomColors({});
	assert.equal(hex(model, 'button.background'), '#112233');
});

void test('registered derived defaults resolve against overridden colors', () => {
	const model = ColorThemeData.createLoadedEmptyTheme('vs-dark', 'Test');
	model.setCustomColors({ 'button.background': '#123456' });
	assert.equal(
		hex(model, 'button.hoverBackground'),
		Color.Format.CSS.formatHexA(Color.fromHex('#123456').lighten(0.2), true)
	);
	assert.ok(model.getColor('surface.background'));
	assert.equal(model.getColor('notRegistered'), undefined);
});

void test('theme resources preserve includes and default deletion, and reject invalid or cyclic input', async () => {
	const resources: Record<string, string> = {
		'base.json': '{ "colors": { "button.background": "#123456", "foreground": "#abcdef" } }',
		'child.json':
			'{ // JSONC\n "include": "base.json", "colors": { "button.background": "default", "foreground": "#112233" }, }',
		'cycle.json': '{"include":"cycle.json"}',
		'invalid.json': '{"colors": 42}',
		'empty-array.json': '{"colors": []}'
	};
	const path = BUNDLED_THEMES[0]!.path;
	const directory = path.slice(0, path.lastIndexOf('/') + 1);
	const load = (name: string) =>
		loadPackagedTheme(BUNDLED_THEMES[0]!.name, {
			...Object.fromEntries(
				Object.entries(resources).map(([key, value]) => [directory + key, value])
			),
			[path]: JSON.stringify({ include: name })
		});
	const child = await load('child.json');
	assert.equal(child.getColor('button.background', false), undefined);
	assert.equal(hex(child, 'foreground'), '#112233');
	await assert.rejects(load('cycle.json'));
	await assert.rejects(load('invalid.json'));
	// The complete upstream loader treats an empty colors array as an empty object.
	assert.strictEqual(
		(await load('empty-array.json')).getColor('button.background', false),
		undefined
	);
	await assert.rejects(load('absent.json'));
});

void test('all GitHub palettes load with independent workbench roles and no extension host', () => {
	for (const item of BUNDLED_THEMES) {
		const theme = getTheme(item.name);
		assert.equal(theme.settingsId, item.name);
		assert.equal(theme.scheme, item.scheme);
		assert.ok(theme.colors['editor.background']);
		assert.ok(theme.colors['button.background']);
	}
	assert.equal(getTheme('dark').settingsId, 'GitHub Dark Default');
	const base = getTheme('dark');
	const changed = getTheme('dark', {
		'menu.background': '#102030',
		'notifications.background': '#203040'
	});
	assert.equal(changed.colors['menu.background'], '#102030');
	assert.equal(changed.colors['notifications.background'], '#203040');
	assert.equal(changed.colors['button.background'], base.colors['button.background']);
	assert.throws(() => getTheme('missing'));
});

void test('settings accepts immutable bounded color data and keeps overrides outside Candidate', () => {
	const source =
		'{"workbench.colorTheme":"GitHub Dark Dimmed","workbench.colorCustomizations":{"button.background":"#1234","[GitHub*]":{"menu.background":"default"}}}';
	const parsed = parseSettingsDocument(source);
	assert.equal(parsed.valid, true);
	const settings = new EffectiveSettings(parsed, { window: 'authenticated' });
	// The editor theme belongs to the exam window; sign-in and Account use the window theme.
	assert.equal(
		new EffectiveSettings(parsed, { window: 'candidate' }).get('workbench.colorTheme'),
		'GitHub Dark Dimmed'
	);
	assert.equal(settings.get('workbench.colorCustomizations')['button.background'], '#1234');
	assert.throws(() =>
		new EffectiveSettings(parsed, { window: 'candidate' }).get('workbench.colorCustomizations')
	);
	for (const bad of [
		{ 'button.background': 'url(https://example.test)' },
		{ '[X]': { '[Y]': {} } },
		JSON.parse('{"__proto__": {}}'),
		{ foreground: '#12345' },
		[]
	]) {
		assert.equal(normalizeColorCustomizations(bad), undefined);
	}
	const normalized = normalizeColorCustomizations({ '[X]': { foreground: '#fff' } })!;
	assert.ok(Object.isFrozen(normalized));
	assert.ok(Object.isFrozen(normalized['[X]']));
});

void test('native chrome accepts bounded resolved colors and rejects arbitrary styling', () => {
	const update = {
		theme: 'dark',
		titlebarHeight: 32,
		dimmed: false,
		followsSystemScheme: true,
		colors: { background: '#123456', foreground: '#abcdef80' }
	};
	assert.deepStrictEqual(validateProductWindowChromeUpdate(update), update);
	assert.ok(Object.isFrozen(validateProductWindowChromeUpdate(update).colors));
	for (const colors of [
		{ background: 'red', foreground: '#ffffff' },
		{ background: '#123456', foreground: 'url(x)' },
		{ ...update.colors, css: 'body {}' }
	])
		assert.throws(() => validateProductWindowChromeUpdate({ ...update, colors }));
	const { followsSystemScheme: _omitted, ...withoutScheme } = update;
	assert.throws(() => validateProductWindowChromeUpdate(withoutScheme));
	assert.throws(() =>
		validateProductWindowChromeUpdate({ ...update, followsSystemScheme: 'yes' })
	);
});
