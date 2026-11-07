import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import {
	isWindowBackgroundMaterial,
	resolveWindowMaterial
} from '../../../../src/prctr/platform/windows/common/windowMaterial.ts';

const open = { reducedTransparency: false, highContrast: false };

suite('Window material', () => {
	test('prefers Liquid Glass, then vibrancy on macOS, and Mica on Windows 11', () => {
		assert.strictEqual(resolveWindowMaterial('darwin', '25.0.0', open), 'glass');
		assert.strictEqual(resolveWindowMaterial('darwin', '27.2.0', open), 'glass');
		assert.strictEqual(resolveWindowMaterial('darwin', '24.6.0', open), 'vibrancy');
		assert.strictEqual(resolveWindowMaterial('darwin', '18.0.0', open), 'vibrancy');
		assert.strictEqual(resolveWindowMaterial('darwin', '17.7.0', open), 'none');
		assert.strictEqual(resolveWindowMaterial('win32', '10.0.22621', open), 'mica');
		assert.strictEqual(resolveWindowMaterial('win32', '10.0.19045', open), 'none');
		assert.strictEqual(resolveWindowMaterial('linux', '6.8.0', open), 'none');
		assert.strictEqual(resolveWindowMaterial('darwin', 'unknown', open), 'none');
	});

	test('Reduce Transparency and Increase Contrast always make the window opaque', () => {
		for (const [platform, release] of [
			['darwin', '25.0.0'],
			['darwin', '24.0.0'],
			['win32', '10.0.22631']
		] as const) {
			assert.strictEqual(
				resolveWindowMaterial(platform, release, {
					reducedTransparency: true,
					highContrast: false
				}),
				'none'
			);
			assert.strictEqual(
				resolveWindowMaterial(platform, release, {
					reducedTransparency: false,
					highContrast: true
				}),
				'none'
			);
		}
	});

	test('only the four materials validate', () => {
		for (const value of ['none', 'vibrancy', 'glass', 'mica'])
			assert.ok(isWindowBackgroundMaterial(value));
		for (const value of ['acrylic', '', undefined, 1])
			assert.ok(!isWindowBackgroundMaterial(value));
	});
});
