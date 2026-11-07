import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import {
	WindowMaterial,
	type LiquidGlassOwner
} from '../../../../src/prctr/platform/windows/electron-main/windowMaterial.ts';

class FakeTheme {
	shouldUseDarkColors = false;
	prefersReducedTransparency = false;
	shouldUseHighContrastColors = false;
	readonly listeners = new Set<() => void>();
	on(_event: string, listener: () => void): this {
		this.listeners.add(listener);
		return this;
	}
	off(_event: string, listener: () => void): this {
		this.listeners.delete(listener);
		return this;
	}
	update(): void {
		for (const listener of this.listeners) listener();
	}
}

class FakeWindow {
	readonly calls: string[] = [];
	isDestroyed(): boolean {
		return false;
	}
	setVibrancy(value: string | null): void {
		this.calls.push(`vibrancy:${value}`);
	}
	setBackgroundMaterial(value: string): void {
		this.calls.push(`material:${value}`);
	}
	setBackgroundColor(value: string): void {
		this.calls.push(`color:${value}`);
	}
	getNativeWindowHandle(): Uint8Array {
		return new Uint8Array(8);
	}
}

function glass(supported: boolean): LiquidGlassOwner & { views: number; disposed: boolean } {
	return {
		views: 0,
		disposed: false,
		isGlassSupported: () => supported,
		addView() {
			this.views++;
			return 1;
		},
		removeView() {
			this.views--;
			return true;
		},
		dispose() {
			this.disposed = true;
		}
	};
}

function create(platform: string, release: string, owner: LiquidGlassOwner | undefined) {
	const theme = new FakeTheme();
	const window = new FakeWindow();
	const material = new WindowMaterial(window, {
		platform,
		osRelease: release,
		theme,
		background: (dark) => (dark ? '#1B1C1F' : '#FBFBFA'),
		createGlass: () => owner
	});
	return { theme, window, material };
}

suite('WindowMaterial', () => {
	test('attaches glass on macOS 26 and makes the window clear', () => {
		const owner = glass(true);
		const { window, material } = create('darwin', '25.1.0', owner);
		assert.strictEqual(material.material, 'glass');
		assert.strictEqual(owner.views, 1);
		assert.deepStrictEqual(window.calls, ['vibrancy:null', 'color:#00000000']);
		material.dispose();
		assert.ok(owner.disposed);
	});

	test('falls back to vibrancy when glass cannot attach', () => {
		for (const owner of [undefined, glass(false)]) {
			const { window, material } = create('darwin', '25.1.0', owner);
			assert.strictEqual(material.material, 'vibrancy');
			assert.deepStrictEqual(window.calls, ['vibrancy:sidebar', 'color:#00000000']);
			material.dispose();
		}
	});

	test('follows Reduce Transparency and turns the material back on afterwards', () => {
		const owner = glass(true);
		const { theme, window, material } = create('darwin', '25.1.0', owner);
		const changes: string[] = [];
		material.onDidChange((value) => changes.push(value));
		theme.prefersReducedTransparency = true;
		theme.update();
		assert.strictEqual(material.material, 'none');
		assert.strictEqual(owner.views, 0);
		assert.strictEqual(window.calls.at(-1), 'color:#FBFBFA');
		theme.prefersReducedTransparency = false;
		theme.shouldUseDarkColors = true;
		theme.update();
		assert.strictEqual(material.material, 'glass');
		assert.deepStrictEqual(changes, ['none', 'glass']);
		material.dispose();
		assert.strictEqual(theme.listeners.size, 0);
	});

	test('uses Mica on Windows 11 and an opaque window before it', () => {
		const mica = create('win32', '10.0.22631', undefined);
		assert.strictEqual(mica.material.material, 'mica');
		assert.deepStrictEqual(mica.window.calls, ['material:mica', 'color:#00000000']);
		mica.material.dispose();
		const older = create('win32', '10.0.19045', undefined);
		assert.strictEqual(older.material.material, 'none');
		assert.deepStrictEqual(older.window.calls, ['color:#FBFBFA']);
		older.material.dispose();
	});
});
