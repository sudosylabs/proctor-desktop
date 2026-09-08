type Assert = {
	(value: unknown, message?: string): asserts value;
	strictEqual(actual: unknown, expected: unknown, message?: string): void;
	deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
	ok(value: unknown, message?: string): asserts value;
	doesNotThrow(body: () => unknown, message?: string): void;
	throws(body: () => unknown, expected?: string | RegExp): void;
};
function fail(message: string): never {
	throw new Error(message);
}
function stringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
const assert: Assert = ((value: unknown, message?: string): asserts value => {
	if (!value) fail(message ?? `Expected truthy value, received ${stringify(value)}`);
}) as Assert;
assert.strictEqual = (actual, expected, message) => {
	if (!Object.is(actual, expected))
		fail(message ?? `Expected ${stringify(actual)} to strictly equal ${stringify(expected)}`);
};
assert.deepStrictEqual = (actual, expected, message) => {
	if (stringify(actual) !== stringify(expected))
		fail(message ?? `Expected ${stringify(actual)} to deeply equal ${stringify(expected)}`);
};
assert.ok = assert;
assert.doesNotThrow = (body, message) => {
	try {
		body();
	} catch (error) {
		fail(message ?? `Expected no throw, received ${String(error)}`);
	}
};
export default assert;
assert.throws = (body, expected) => {
	try {
		body();
	} catch (error) {
		if (expected instanceof RegExp && !expected.test(String(error)))
			fail(`Expected ${String(error)} to match ${expected}`);
		return;
	}
	fail(typeof expected === 'string' ? expected : 'Expected the callback to throw.');
};
