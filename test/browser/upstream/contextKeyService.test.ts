/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port platform-context-conditions

import assert from './assert.ts';
import { suite, test } from './testAdapter.ts';
import { DeferredPromise } from '../../../src/prctr/base/common/async.ts';
import { ensureNoDisposablesAreLeakedInTestSuite } from './upstreamTestUtils.ts';
import { ContextKeyService } from '../../../src/prctr/platform/contextkey/browser/contextKeyService.ts';
import { ContextKeyExpr } from '../../../src/prctr/platform/contextkey/common/contextkey.ts';

suite('ContextKeyService', () => {
	const testDisposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('scoped overlays evaluate inherited scope values, including after reparenting', () => {
		const root = testDisposables.add(new ContextKeyService());
		const first = testDisposables.add(root.createScoped(document.createElement('div')));
		const second = testDisposables.add(root.createScoped(document.createElement('div')));
		first.createKey('prctr.test.parent', 'first');
		second.createKey('prctr.test.parent', 'second');
		const target = document.createElement('div');
		const child = testDisposables.add(first.createScoped(target));
		child.createKey('prctr.test.local', 'local');
		const overlay = child.createOverlay([['prctr.test.override', 'outer']]).createOverlay([['prctr.test.override', 'inner']]);
		const matches = (parent: string) => overlay.contextMatchesRules(ContextKeyExpr.and(
			ContextKeyExpr.equals('prctr.test.parent', parent),
			ContextKeyExpr.equals('prctr.test.local', 'local'),
			ContextKeyExpr.equals('prctr.test.override', 'inner')
		));
		assert.strictEqual(matches('first'), true);
		child.updateParent(second);
		assert.strictEqual(matches('second'), true);
		assert.strictEqual(overlay.getContextKeyValue('prctr.test.parent'), 'second');
		assert.strictEqual(overlay.getContext(target).getValue('prctr.test.local'), 'local');
	});

	test('duplicate DOM scopes reject before allocating a child or parent listener', () => {
		const root = testDisposables.add(new ContextKeyService());
		const target = document.createElement('div');
		const scope = testDisposables.add(root.createScoped(target));
		scope.createKey('prctr.test.owner', 'original');
		assert.throws(() => root.createScoped(target));
		assert.strictEqual(root.getContext(target).getValue('prctr.test.owner'), 'original');
	});

	test('reparenting rejects cycles and foreign roots without changing the original scope', () => {
		const root = testDisposables.add(new ContextKeyService());
		const foreignRoot = testDisposables.add(new ContextKeyService());
		const scope = testDisposables.add(root.createScoped(document.createElement('div')));
		const child = testDisposables.add(scope.createScoped(document.createElement('div')));
		scope.createKey('prctr.test.owner', 'original');
		assert.throws(() => scope.updateParent(child));
		assert.throws(() => scope.updateParent(foreignRoot));
		assert.strictEqual(child.getContextKeyValue('prctr.test.owner'), 'original');
	});

	test('invalid explicit DOM context does not fall back to the root', () => {
		const root = testDisposables.add(new ContextKeyService());
		root.createKey('prctr.test.root', true);
		const target = document.createElement('div');
		target.setAttribute('data-keybinding-context', 'invalid');
		assert.strictEqual(root.getContext(target).getValue('prctr.test.root'), undefined);
		target.setAttribute('data-keybinding-context', '');
		assert.strictEqual(root.getContext(target).getValue('prctr.test.root'), undefined);
	});

	test('context equality retains upstream signed-zero and NaN event semantics', () => {
		const root = testDisposables.add(new ContextKeyService());
		const key = root.createKey<number>('prctr.test.number', 0);
		let events = 0;
		testDisposables.add(root.onDidChangeContext(() => events++));
		key.set(-0);
		assert.strictEqual(events, 0);
		key.set(NaN);
		key.set(NaN);
		assert.strictEqual(events, 2);
	});

	test('updateParent', () => {
		const root = testDisposables.add(new ContextKeyService());
		const parent1 = testDisposables.add(root.createScoped(document.createElement('div')));
		const parent2 = testDisposables.add(root.createScoped(document.createElement('div')));

		const child = testDisposables.add(parent1.createScoped(document.createElement('div')));
		parent1.createKey('testA', 1);
		parent1.createKey('testB', 2);
		parent1.createKey('testD', 0);

		parent2.createKey('testA', 3);
		parent2.createKey('testC', 4);
		parent2.createKey('testD', 0);

		let complete: () => void;
		let reject: (err: Error) => void;
		const p = new Promise<void>((_complete, _reject) => {
			complete = _complete;
			reject = _reject;
		});
		testDisposables.add(child.onDidChangeContext(e => {
			try {
				assert.ok(e.affectsSome(new Set(['testA'])), 'testA changed');
				assert.ok(e.affectsSome(new Set(['testB'])), 'testB changed');
				assert.ok(e.affectsSome(new Set(['testC'])), 'testC changed');
				assert.ok(!e.affectsSome(new Set(['testD'])), 'testD did not change');

				assert.strictEqual(child.getContextKeyValue('testA'), 3);
				assert.strictEqual(child.getContextKeyValue('testB'), undefined);
				assert.strictEqual(child.getContextKeyValue('testC'), 4);
				assert.strictEqual(child.getContextKeyValue('testD'), 0);
			} catch (err) {
				reject(err);
				return;
			}

			complete();
		}));

		child.updateParent(parent2);

		return p;
	});

	test('updateParent to same service', () => {
		const root = testDisposables.add(new ContextKeyService());
		const parent1 = testDisposables.add(root.createScoped(document.createElement('div')));

		const child = testDisposables.add(parent1.createScoped(document.createElement('div')));
		parent1.createKey('testA', 1);
		parent1.createKey('testB', 2);
		parent1.createKey('testD', 0);

		let eventFired = false;
		testDisposables.add(child.onDidChangeContext(e => {
			eventFired = true;
		}));

		child.updateParent(parent1);

		assert.strictEqual(eventFired, false);
	});

	test('suppress update event from parent when one key is overridden by child', () => {
		const root = testDisposables.add(new ContextKeyService());
		const child = testDisposables.add(root.createScoped(document.createElement('div')));

		root.createKey('testA', 1);
		child.createKey('testA', 4);

		let fired = false;
		const event = testDisposables.add(child.onDidChangeContext(e => fired = true));
		root.setContext('testA', 10);
		assert.strictEqual(fired, false, 'Should not fire event when overridden key is updated in parent');
		event.dispose();
	});

	test('suppress update event from parent when all keys are overridden by child', () => {
		const root = testDisposables.add(new ContextKeyService());
		const child = testDisposables.add(root.createScoped(document.createElement('div')));

		root.createKey('testA', 1);
		root.createKey('testB', 2);
		root.createKey('testC', 3);

		child.createKey('testA', 4);
		child.createKey('testB', 5);
		child.createKey('testD', 6);

		let fired = false;
		const event = testDisposables.add(child.onDidChangeContext(e => fired = true));
		root.bufferChangeEvents(() => {
			root.setContext('testA', 10);
			root.setContext('testB', 20);
			root.setContext('testD', 30);
		});

		assert.strictEqual(fired, false, 'Should not fire event when overridden key is updated in parent');
		event.dispose();
	});

	test('pass through update event from parent when one key is not overridden by child', () => {
		const root = testDisposables.add(new ContextKeyService());
		const child = testDisposables.add(root.createScoped(document.createElement('div')));

		root.createKey('testA', 1);
		root.createKey('testB', 2);
		root.createKey('testC', 3);

		child.createKey('testA', 4);
		child.createKey('testB', 5);
		child.createKey('testD', 6);

		const def = new DeferredPromise();
		testDisposables.add(child.onDidChangeContext(e => {
			try {
				assert.ok(e.affectsSome(new Set(['testA'])), 'testA changed');
				assert.ok(e.affectsSome(new Set(['testB'])), 'testB changed');
				assert.ok(e.affectsSome(new Set(['testC'])), 'testC changed');
			} catch (err) {
				def.error(err);
				return;
			}

			def.complete(undefined);
		}));

		root.bufferChangeEvents(() => {
			root.setContext('testA', 10);
			root.setContext('testB', 20);
			root.setContext('testC', 30);
		});

		return def.p;
	});

	test('setting identical array values should not fire change event', () => {
		const root = testDisposables.add(new ContextKeyService());
		const key = root.createKey<string[]>('testArray', ['a', 'b', 'c']);

		let eventFired = false;
		testDisposables.add(root.onDidChangeContext(e => {
			eventFired = true;
		}));

		// Set the same array content (different reference)
		key.set(['a', 'b', 'c']);

		assert.strictEqual(eventFired, false, 'Should not fire event when setting identical array');
	});

	test('setting different array values should fire change event', () => {
		const root = testDisposables.add(new ContextKeyService());
		const key = root.createKey<string[]>('testArray', ['a', 'b', 'c']);

		let eventFired = false;
		testDisposables.add(root.onDidChangeContext(e => {
			eventFired = true;
		}));

		// Set a different array
		key.set(['a', 'b', 'd']);

		assert.strictEqual(eventFired, true, 'Should fire event when setting different array');
	});

	test('setting identical complex object should not fire change event', () => {
		const root = testDisposables.add(new ContextKeyService());
		const initialValue = { foo: 'bar', count: 42 };
		const key = root.createKey<Record<string, string | number>>('testObject', initialValue);

		let eventFired = false;
		testDisposables.add(root.onDidChangeContext(e => {
			eventFired = true;
		}));

		// Set the same object content (different reference)
		key.set({ foo: 'bar', count: 42 });

		assert.strictEqual(eventFired, false, 'Should not fire event when setting identical object');
	});

	test('setting different complex object should fire change event', () => {
		const root = testDisposables.add(new ContextKeyService());
		const initialValue = { foo: 'bar', count: 42 };
		const key = root.createKey<Record<string, string | number>>('testObject', initialValue);

		let eventFired = false;
		testDisposables.add(root.onDidChangeContext(e => {
			eventFired = true;
		}));

		// Set a different object
		key.set({ foo: 'bar', count: 43 });

		assert.strictEqual(eventFired, true, 'Should fire event when setting different object');
	});

	test('setting empty arrays should not fire change event when identical', () => {
		const root = testDisposables.add(new ContextKeyService());
		const key = root.createKey<string[]>('testArray', []);

		let eventFired = false;
		testDisposables.add(root.onDidChangeContext(e => {
			eventFired = true;
		}));

		// Set another empty array
		key.set([]);

		assert.strictEqual(eventFired, false, 'Should not fire event when setting identical empty array');
	});

	test('setting nested arrays should handle deep equality', () => {
		const root = testDisposables.add(new ContextKeyService());
		const initialValue = ['a:b', 'c:d'];
		const key = root.createKey<string[]>('testComplexArray', initialValue);

		let eventFired = false;
		testDisposables.add(root.onDidChangeContext(e => {
			eventFired = true;
		}));

		// Set the same array content with colon-separated values
		key.set(['a:b', 'c:d']);

		assert.strictEqual(eventFired, false, 'Should not fire event when setting identical array with complex values');
	});

	test('setting same primitive values should not fire change event', () => {
		const root = testDisposables.add(new ContextKeyService());
		const key = root.createKey('testString', 'hello');

		let eventFired = false;
		testDisposables.add(root.onDidChangeContext(e => {
			eventFired = true;
		}));

		// Set the same string value
		key.set('hello');

		assert.strictEqual(eventFired, false, 'Should not fire event when setting identical string');
	});

	test('setting different primitive values should fire change event', () => {
		const root = testDisposables.add(new ContextKeyService());
		const key = root.createKey<number>('testNumber', 42);

		let eventFired = false;
		testDisposables.add(root.onDidChangeContext(e => {
			eventFired = true;
		}));

		// Set a different number value
		key.set(43);

		assert.strictEqual(eventFired, true, 'Should fire event when setting different number');
	});

	test('disposeContext forwards through disposed scoped service', () => {
		const root = testDisposables.add(new ContextKeyService());
		const scoped = root.createScoped(document.createElement('div'));
		const child = scoped.createScoped(document.createElement('div'));

		// Set a value on the child so we can observe it
		child.createKey('testKey', 'value');
		assert.strictEqual(child.getContextKeyValue('testKey'), 'value');

		// Dispose the intermediate scoped service first
		scoped.dispose();

		// Now dispose the child — this should still forward to root
		// and clean up the child's context entry. Before the fix,
		// ScopedContextKeyService.disposeContext bailed out when
		// _isDisposed was true, leaking Context objects.
		child.dispose();

		// The child's context should no longer be accessible through root
		assert.strictEqual(root.getContextKeyValue('testKey'), undefined,
			'Child context should be cleaned up even when parent scoped service was disposed first');
	});
});
