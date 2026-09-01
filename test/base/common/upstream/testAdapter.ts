import {
	afterEach,
	beforeEach,
	suite as nodeSuite,
	test as nodeTest
} from 'node:test';

type Done = (error?: unknown) => void;
interface TestContext {
	skip(): void;
}
type TestBody = ((this: TestContext) => unknown) | ((this: TestContext, done: Done) => unknown);
const skippedTest = Symbol('skipped-test');

interface TestRegistration {
	(name: string, body: (this: TestContext) => unknown): void;
	(name: string, body: (this: TestContext, done: Done) => unknown): void;
	skip(name: string, body: (this: TestContext) => unknown): void;
	skip(name: string, body: (this: TestContext, done: Done) => unknown): void;
}

function adaptTestBody(body: TestBody): (context: { skip(): void }) => Promise<void> {
	if (body.length === 0) {
		return async context => {
			try {
				await (body as (this: TestContext) => unknown).call({
					skip: () => {
						context.skip();
						throw skippedTest;
					}
				});
			} catch (error) {
				if (error !== skippedTest) throw error;
			}
		};
	}

	return context => new Promise<void>((resolve, reject) => {
		let completed = false;
		const done: Done = error => {
			if (completed) {
				reject(new Error('The test completion callback was invoked more than once.'));
				return;
			}
			completed = true;
			if (error === undefined) {
				resolve();
			} else {
				reject(error);
			}
		};

		try {
			const result = (body as (this: TestContext, done: Done) => unknown).call({
				skip: () => {
					context.skip();
					throw skippedTest;
				}
			}, done);
			if (result instanceof Promise) {
				void result.catch(reject);
			}
		} catch (error) {
			if (error === skippedTest) resolve();
			else reject(error);
		}
	});
}

export const suite: typeof nodeSuite = nodeSuite;

export const test: TestRegistration = Object.assign(
	(name: string, body: TestBody) => {
		void nodeTest(name, adaptTestBody(body));
	},
	{
		skip(name: string, body: TestBody): void {
			void nodeTest.skip(name, adaptTestBody(body));
		}
	}
);

export const setup: typeof beforeEach = beforeEach;
export const teardown: typeof afterEach = afterEach;
