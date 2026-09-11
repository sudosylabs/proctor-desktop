import assert from 'node:assert/strict';
import test from 'node:test';
import type { IpcMainInvokeEvent } from 'electron/main';
import { SettingsNativeIpcBridge, type SettingsNativeHost } from '../../../../src/prctr/platform/settings/electron-main/settingsNativeIpc.js';
import { SETTINGS_NATIVE_CHANNEL, SETTINGS_CLIPBOARD_LIMIT, validateSettingsNativeIntent, validateSettingsCursorScreenPoint, type SettingsMenuRequest, type SettingsMenuSelection, type SettingsCursorScreenPoint } from '../../../../src/prctr/platform/settings/common/settingsNativeHost.js';

const menu: SettingsMenuRequest = { requestId: 1, items: [{ id: 0, label: 'Reset Setting' }, { id: 1, label: 'Disabled', enabled: false }], options: { x: 10, y: 20 } };
function fixture() {
	let handler!: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
	let authorized = true, text = '';
	let bytes = new Uint8Array();
	let choose!: (selection: SettingsMenuSelection) => void;
	let closed!: () => void;
	let disposals = 0, pastes = 0;
	let removed = false;
	const host: SettingsNativeHost = {
		window: { async focus() {}, async moveTop() {}, async getCursorScreenPoint() { return { point: { x: 0, y: 0 }, display: { x: 0, y: 0, width: 800, height: 600 } }; } },
		clipboard: {
			async readText() { return text; }, async writeText(value) { text = value; },
			async readFindText() { return text; }, async writeFindText(value) { text = value; },
			async readResources() { return bytes; }, async writeResources(value) { bytes = new Uint8Array(value); },
			async readImage() { return bytes; }, async hasResources() { return bytes.length > 0; }, async paste() { pastes++; }
		},
		popup(_request, selected, onClose) { choose = selected; closed = onClose; return { dispose() { disposals++; } }; }
	};
	const bridge = new SettingsNativeIpcBridge({
		handle(channel, listener) { assert.equal(channel, SETTINGS_NATIVE_CHANNEL); handler = listener; },
		removeHandler(channel) { assert.equal(channel, SETTINGS_NATIVE_CHANNEL); removed = true; }
	}, host, () => { if (!authorized) throw new Error('Unauthorized'); });
	return {
		bridge, host, invoke: (...args: unknown[]) => Promise.resolve(handler({} as IpcMainInvokeEvent, ...args)),
		revoke() { authorized = false; }, select: (id: number) => choose({ id, event: { shiftKey: true } }), close: () => closed(),
		get disposals() { return disposals; }, get pastes() { return pastes; }, get removed() { return removed; }
	};
}
void test('Settings native validation rejects executable fields, malformed trees and oversized clipboard data', () => {
	for (const value of [null, { kind: 'execute', command: 'quit' }, { kind: 'paste', targetWindowId: 1 },
		{ kind: 'readText', type: 'find' }, { kind: 'writeText', type: 'clipboard', text: 'x'.repeat(SETTINGS_CLIPBOARD_LIMIT + 1) },
		{ kind: 'writeResources', value: new Uint8Array(SETTINGS_CLIPBOARD_LIMIT + 1) },
		{ kind: 'menu', menu: { ...menu, items: [{ id: 0, role: 'quit' }] } },
		{ kind: 'menu', menu: { ...menu, items: [{ id: 0, submenu: [{ id: 0 }] }] } },
		{ kind: 'menu', menu: { ...menu, options: { x: Infinity } } }
	]) assert.throws(() => validateSettingsNativeIntent(value));
	let item: Record<string, unknown> = { id: 0 };
	for (let i = 1; i < 11; i++) item = { id: i, submenu: [item] };
	assert.throws(() => validateSettingsNativeIntent({ kind: 'menu', menu: { ...menu, items: [item] } }));
	assert.deepEqual(validateSettingsNativeIntent({ kind: 'menu', menu }), { kind: 'menu', menu });
});
void test('Settings native menus reauthorize selection and cancel exactly the owning request', async () => {
	const f = fixture();
	try {
		const first = f.invoke({ kind: 'menu', menu });
		const second = f.invoke({ kind: 'menu', menu: { ...menu, requestId: 2 } });
		assert.equal(await first, undefined);
		await f.invoke({ kind: 'cancelMenu', requestId: 1 }); assert.equal(f.disposals, 1);
		f.select(0); f.close(); assert.deepEqual(await second, { id: 0, event: { shiftKey: true } });
		assert.equal(f.disposals, 2);
		const disabled = f.invoke({ kind: 'menu', menu }); f.select(1);
		await assert.rejects(disabled, /unavailable action/);
		const revoked = f.invoke({ kind: 'menu', menu }); f.revoke(); f.select(0);
		await assert.rejects(revoked, /Unauthorized/);
		await assert.rejects(f.invoke({ kind: 'readText', type: 'clipboard' }), /Unauthorized/);
	} finally { f.bridge.dispose(); }
});
void test('Settings native teardown closes menus and cannot deliver a late selection', async () => {
	const f = fixture(); const pending = f.invoke({ kind: 'menu', menu });
	f.bridge.dispose(); f.select(0); f.close();
	assert.equal(await pending, undefined); assert.equal(f.disposals, 1); assert.equal(f.removed, true);
	await assert.rejects(f.invoke({ kind: 'paste' }), /closed/);
});
void test('Settings clipboard round trips bounded data and fences deferred paste', async () => {
	const f = fixture();
	try {
		await f.invoke({ kind: 'writeText', type: 'clipboard', text: 'settings text' });
		assert.equal(await f.invoke({ kind: 'readText', type: 'clipboard' }), 'settings text');
		await f.invoke({ kind: 'writeResources', value: new Uint8Array([1, 2]) });
		assert.deepEqual(await f.invoke({ kind: 'readResources' }), new Uint8Array([1, 2]));
		let release!: (text: string) => void;
		f.host.clipboard.readText = () => new Promise(resolve => { release = resolve; });
		const paste = f.invoke({ kind: 'paste' }); f.revoke(); release('pending');
		await assert.rejects(paste, /Unauthorized/); assert.equal(f.pastes, 0);
	} finally { f.bridge.dispose(); }
});

void test('Settings window effects target only the authorized owning window and fence late cursor responses', async () => {
	const f = fixture();
	let focused = 0, raised = 0;
	f.host.window.focus = async () => { focused++; };
	f.host.window.moveTop = async () => { raised++; };
	try {
		for (const kind of ['focusWindow', 'moveWindowTop', 'cursorScreenPoint']) {
			assert.throws(() => validateSettingsNativeIntent({ kind, windowId: 2 }));
			assert.throws(() => validateSettingsNativeIntent({ kind, targetWindowId: 2 }));
		}
		await f.invoke({ kind: 'focusWindow' });
		await f.invoke({ kind: 'moveWindowTop' });
		assert.equal(focused, 1); assert.equal(raised, 1);
		assert.deepEqual(await f.invoke({ kind: 'cursorScreenPoint' }), { point: { x: 0, y: 0 }, display: { x: 0, y: 0, width: 800, height: 600 } });
		let release!: (point: SettingsCursorScreenPoint) => void;
		f.host.window.getCursorScreenPoint = () => new Promise(resolve => { release = resolve; });
		const pending = f.invoke({ kind: 'cursorScreenPoint' });
		f.revoke();
		release({ point: { x: 1, y: 2 }, display: { x: 0, y: 0, width: 800, height: 600 } });
		await assert.rejects(pending, /Unauthorized/);
		await assert.rejects(f.invoke({ kind: 'focusWindow' }), /Unauthorized/);
		await assert.rejects(f.invoke({ kind: 'moveWindowTop' }), /Unauthorized/);
		assert.equal(focused, 1); assert.equal(raised, 1);
	} finally { f.bridge.dispose(); }
});

void test('Settings cursor responses reject malformed geometry and unexpected data', () => {
	const valid = { point: { x: -500, y: 20 }, display: { x: -1920, y: 0, width: 1920, height: 1080 } };
	assert.deepEqual(validateSettingsCursorScreenPoint(valid), valid);
	for (const value of [undefined, null, { ...valid, displayId: 7 }, { ...valid, point: { x: NaN, y: 0 } },
		{ ...valid, point: { x: 1_000_001, y: 0 } }, { ...valid, display: { ...valid.display, width: -1 } }])
		assert.throws(() => validateSettingsCursorScreenPoint(value));
});
