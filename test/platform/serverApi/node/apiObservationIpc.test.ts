import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IpcMainInvokeEvent } from 'electron/main';
import { ApiObservationIpc } from '../../../../src/prctr/platform/serverApi/electron-main/apiObservationIpc.js';

void test('observations reauthorize every publication and fence stopped or synchronously rejected subscriptions', () => {
	let handler!: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
	let publish!: (value: number) => void;
	let allowed = true;
	let revokeDuringStart = false;
	let disposals = 0;
	let removed = false;
	const messages: unknown[] = [];
	const event = {
		senderFrame: { send: (_channel: string, value: unknown) => messages.push(value) }
	} as unknown as IpcMainInvokeEvent;
	const bridge = new ApiObservationIpc(
		{
			handle: (_channel, listener) => {
				handler = listener;
			},
			removeHandler: () => {
				removed = true;
			}
		},
		'closed-capability:observe',
		(value) => {
			if (value !== 'read') throw new TypeError('Invalid intent');
			return value;
		},
		(value) => {
			if (typeof value !== 'number') throw new TypeError('Invalid response');
			return value;
		},
		() => {
			if (!allowed) throw new Error('Unauthorized');
		},
		(_intent, listener) => {
			publish = listener;
			if (revokeDuringStart) {
				allowed = false;
				publish(0);
			}
			return {
				dispose: () => {
					disposals++;
				}
			};
		}
	);
	try {
		assert.throws(() => handler(event, { kind: 'start', id: 1, intent: 'arbitrary-route' }));
		handler(event, { kind: 'start', id: 1, intent: 'read' });
		publish(1);
		assert.equal(messages.length, 1);
		assert.throws(() => handler(event, { kind: 'stop', id: 1 }, 'extra'));
		handler(event, { kind: 'stop', id: 1 });
		publish(2);
		assert.equal(messages.length, 1);
		assert.equal(disposals, 1);
		handler(event, { kind: 'start', id: 2, intent: 'read' });
		allowed = false;
		publish(3);
		assert.equal(messages.length, 1);
		assert.equal(disposals, 2);
		allowed = true;
		revokeDuringStart = true;
		handler(event, { kind: 'start', id: 3, intent: 'read' });
		assert.equal(disposals, 3);
	} finally {
		bridge.dispose();
	}
	assert.equal(disposals, 3);
	assert.equal(removed, true);
});

void test('observations deliver to the frame that started them and turn undeliverable answers into the failure', () => {
	let handler!: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
	let publish!: (value: unknown) => void;
	const messages: unknown[] = [];
	const frame = { send: (_channel: string, value: unknown) => messages.push(value) };
	let lookups = 0;
	// Electron resolves senderFrame on each read; later reads may not return the same frame.
	const event = {
		sender: { id: 7 },
		get senderFrame() {
			return lookups++ === 0 ? frame : null;
		}
	} as unknown as IpcMainInvokeEvent;
	const authorized: unknown[] = [];
	const bridge = new ApiObservationIpc(
		{ handle: (_channel, listener) => void (handler = listener), removeHandler: () => {} },
		'closed-capability:observe',
		(value) => value,
		(value) => {
			if (typeof value !== 'number') throw new TypeError('Invalid response');
			return value;
		},
		(candidate) => {
			authorized.push(candidate.senderFrame);
		},
		(_intent, listener) => {
			publish = listener as (value: unknown) => void;
			return { dispose: () => {} };
		},
		-1
	);
	try {
		handler(event, { kind: 'start', id: 1, intent: 'read' });
		publish(5);
		publish('not a number');
		assert.deepEqual(messages, [
			{ id: 1, response: 5 },
			{ id: 1, response: -1 }
		]);
		assert.ok(authorized.slice(1).every((value) => value === frame));
	} finally {
		bridge.dispose();
	}
});
