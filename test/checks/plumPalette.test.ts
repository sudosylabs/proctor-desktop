import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plumPalette } from '../../build/generators/plumPalette.ts';

function luminance(hex: string): number {
	const channel = (index: number) => {
		const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
function contrast(a: string, b: string): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (high + 0.05) / (low + 0.05);
}

void test('the Plum palette is deterministic, 12 steps per hue, and ordered by lightness', () => {
	assert.deepEqual(plumPalette(), plumPalette());
	for (const mode of ['light', 'dark'] as const) {
		const { neutral, accent } = plumPalette()[mode];
		assert.equal(neutral.length, 12);
		assert.equal(accent.length, 12);
		for (const hex of [...neutral, ...accent]) assert.match(hex, /^#[0-9A-F]{6}$/u);
		const lightness = neutral.map(luminance);
		for (let step = 1; step < 12; step++)
			assert.ok(
				mode === 'light'
					? lightness[step]! <= lightness[step - 1]!
					: lightness[step]! >= lightness[step - 1]!,
				`${mode} neutral step ${step + 1} keeps the order`
			);
	}
});

void test('text and marks on Plum surfaces meet their contrast', () => {
	for (const mode of ['light', 'dark'] as const) {
		const p = plumPalette()[mode];
		const n = (step: number) => p.neutral[step - 1]!;
		const a = (step: number) => p.accent[step - 1]!;
		const surfaces = mode === 'light' ? [n(1), n(2), n(3)] : [n(2), n(3), n(4)];
		for (const surface of surfaces) {
			assert.ok(contrast(n(12), surface) >= 7, `${mode} text on ${surface}`);
			assert.ok(contrast(n(11), surface) >= 4.5, `${mode} secondary text on ${surface}`);
			assert.ok(contrast(n(10), surface) >= 3, `${mode} faint text and icons on ${surface}`);
			for (const status of [p.red, p.amber, p.green])
				assert.ok(
					contrast(status, surface) >= 4.5,
					`${mode} status ${status} on ${surface}`
				);
			const link = mode === 'light' ? a(9) : a(11);
			assert.ok(contrast(link, surface) >= 4.5, `${mode} link on ${surface}`);
		}
		assert.ok(contrast('#FFFFFF', a(9)) >= 4.5, `${mode} white on the solid accent`);
		assert.ok(contrast('#FFFFFF', p.redSolid) >= 4.5, `${mode} white on the solid red`);
		assert.ok(contrast(n(9), surfaces[0]!) >= 3, `${mode} field borders`);
	}
});
