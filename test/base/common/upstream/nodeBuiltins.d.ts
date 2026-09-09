declare module 'node:assert' {
	function assert(value: unknown, message?: string | Error): asserts value;
	namespace assert {
		function deepEqual(...arguments_: any[]): void;
		function deepStrictEqual(...arguments_: any[]): void;
		function equal(...arguments_: any[]): void;
		function doesNotThrow(...arguments_: any[]): void;
		function fail(...arguments_: any[]): never;
		function notStrictEqual(...arguments_: any[]): void;
		function ok(value: unknown, message?: string | Error): asserts value;
		function rejects(...arguments_: any[]): Promise<void>;
		function strictEqual<T>(
			actual: unknown,
			expected: T,
			message?: string | Error
		): asserts actual is T;
		function throws(...arguments_: any[]): void;
	}
	export = assert;
}

declare module 'node:test' {
	export const after: (...arguments_: any[]) => any;
	export const before: (...arguments_: any[]) => any;
	export const afterEach: (...arguments_: any[]) => any;
	export const beforeEach: (...arguments_: any[]) => any;
	export const suite: any;
	export const test: any;
}

declare const process: {
	on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
	off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

declare function setImmediate(handler: () => void): unknown;
declare function clearImmediate(handle: unknown): void;
