import assert from 'node:assert/strict';
import test from 'node:test';
import { CancellationTokenSource, LSPErrorCodes, ResponseError } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-json-languageservice';
import { getLanguageModelCache } from '../../../../../src/prctr/editor/common/languages/json/languageModelCache.js';
import {
	runSafe,
	runSafeAsync
} from '../../../../../src/prctr/editor/common/languages/json/utils/runner.js';
import { PackagedJsonSchemas } from '../../../../../src/prctr/editor/common/languages/json/packagedJsonSchemas.js';
import { readJsonWorkerInitialization } from '../../../../../src/prctr/editor/common/languages/json/jsonWorkerProtocol.js';
import type { RuntimeEnvironment } from '../../../../../src/prctr/editor/common/languages/json/jsonServer.js';

function scheduler() {
	const work: (() => void)[] = [];
	const runtime: RuntimeEnvironment = {
		timer: {
			setImmediate(callback, ...args) {
				let active = true;
				work.push(() => {
					if (active) callback(...args);
				});
				return {
					dispose: () => {
						active = false;
					}
				};
			},
			setTimeout() {
				throw new Error('Unexpected delayed task.');
			}
		}
	};
	return {
		runtime,
		run: () => {
			for (const callback of work.splice(0)) callback();
		}
	};
}

void test('cancelled scheduled work never invokes the JSON language operation', async () => {
	const owner = scheduler();
	const token = new CancellationTokenSource();
	let calls = 0;
	const sync = runSafe(owner.runtime, () => ++calls, 0, 'test', token.token);
	const asyncResult = runSafeAsync(owner.runtime, async () => ++calls, 0, 'test', token.token);
	token.cancel();
	owner.run();
	for (const result of await Promise.all([sync, asyncResult])) {
		assert.ok(result instanceof ResponseError);
		assert.equal(result.code, LSPErrorCodes.RequestCancelled);
	}
	assert.equal(calls, 0);
	token.dispose();
});

void test('cancellation while a schema promise is pending discards the language result', async () => {
	const owner = scheduler();
	const token = new CancellationTokenSource();
	let release!: (value: number) => void;
	const operation = new Promise<number>((resolve) => {
		release = resolve;
	});
	const pending = runSafeAsync(owner.runtime, () => operation, 0, 'test', token.token);
	owner.run();
	token.cancel();
	release(42);
	const result = await pending;
	assert.ok(result instanceof ResponseError);
	assert.equal(result.code, LSPErrorCodes.RequestCancelled);
	token.dispose();
});

void test('document cache preserves version/language reuse, eviction, close and disposal', (context) => {
	context.mock.timers.enable({ apis: ['Date', 'setInterval'] });
	let parses = 0;
	const cache = getLanguageModelCache(2, 1, (document) => ({
		serial: ++parses,
		text: document.getText()
	}));
	const first = TextDocument.create('prctr-settings://a/settings.json', 'jsonc', 1, '{}');
	try {
		const model = cache.get(first);
		assert.equal(cache.get(first), model);
		const changed = TextDocument.create(first.uri, 'jsonc', 2, '{"value":1}');
		assert.notEqual(cache.get(changed), model);
		const languageChanged = TextDocument.create(first.uri, 'json', 2, changed.getText());
		const languageModel = cache.get(languageChanged);
		assert.equal(languageModel.serial, 3);
		context.mock.timers.tick(1);
		cache.get(TextDocument.create('prctr-settings://b/settings.json', 'jsonc', 1, '{}'));
		context.mock.timers.tick(1);
		cache.get(TextDocument.create('prctr-settings://c/settings.json', 'jsonc', 1, '{}'));
		assert.notEqual(cache.get(languageChanged), languageModel);
		const beforeClose = cache.get(languageChanged);
		cache.onDocumentRemoved(languageChanged);
		assert.notEqual(cache.get(languageChanged), beforeClose);
		const beforeExpiry = cache.get(languageChanged);
		context.mock.timers.tick(2000);
		assert.notEqual(cache.get(languageChanged), beforeExpiry);
		const beforeDispose = cache.get(languageChanged);
		cache.dispose();
		assert.notEqual(cache.get(languageChanged), beforeDispose);
	} finally {
		cache.dispose();
	}
});

void test('schema access is exact and snapshots the packaged catalog without granting references', () => {
	const uri = 'prctr-schema://settings/user';
	const resources = new Map([[uri, '{}']]);
	const schemas = new PackagedJsonSchemas(resources);
	resources.set(uri, '{"changed":true}');
	assert.equal(schemas.read(uri), '{}');
	for (const value of [
		'https://example.test/schema',
		new URL('unpackaged-schema.json', import.meta.url).href,
		`${uri}?extra=1`,
		'__proto__',
		undefined
	])
		assert.throws(() => schemas.read(value), /not packaged/);
	assert.throws(
		() => new PackagedJsonSchemas(new Map([['https://example.test', '{}']])),
		/identifier/
	);
	assert.throws(
		() => new PackagedJsonSchemas(new Map([[uri, 'x'.repeat(4 * 1024 * 1024 + 1)]])),
		/limit/
	);
});

void test('worker startup accepts bounded inline localization and rejects remote loading fields', () => {
	const input = {
		type: 'proctor-json-worker-initialize',
		messages: { 'Sort JSON': 'Trier JSON' }
	};
	const parsed = readJsonWorkerInitialization(input);
	input.messages['Sort JSON'] = 'changed';
	assert.equal(parsed.messages?.['Sort JSON'], 'Trier JSON');
	for (const value of [
		null,
		[],
		{},
		{ ...input, i10lLocation: 'https://example.test' },
		{ ...input, messages: { a: 1 } }
	])
		assert.throws(() => readJsonWorkerInitialization(value));
	assert.throws(
		() => readJsonWorkerInitialization({ ...input, messages: { a: 'x'.repeat(512 * 1024) } }),
		/limit/
	);
});
