import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	operationContract,
	operationContracts,
	validateNamedSchema,
	validateSchema
} from '../../../../src/prctr/platform/serverApi/node/serverContract.js';
import { ServerApiError } from '../../../../src/prctr/platform/serverApi/common/serverApi.js';

void test('every packaged operation has executable request/response schemas, including conditional and non-JSON routes', () => {
	const operations = [...operationContracts()];
	assert.equal(operations.length, 301);
	assert.equal(new Set(operations.map((operation) => operation.path)).size, 247);
	const compiles = (operation: string, run: () => void) => {
		try {
			run();
		} catch (error) {
			assert.ok(error instanceof ServerApiError, `${operation}: ${String(error)}`);
		}
	};
	for (const operation of operations) {
		for (const parameter of operation.parameters)
			compiles(operation.id, () => validateSchema(parameter.schema, undefined));
		for (const media of Object.values(operation.requestBody?.content ?? {}))
			if (media.schema)
				compiles(operation.id, () => validateSchema(media.schema!, undefined));
		for (const response of Object.values(operation.responses))
			for (const media of Object.values(response.content ?? {}))
				if (media.schema)
					compiles(operation.id, () =>
						validateSchema(media.schema!, undefined, 'response')
					);
	}
});

void test('the runtime contract carries no prose and names strict-integer operations', () => {
	assert.equal(operationContract('appendNativeDelivery').strictIntegers, true);
	assert.equal(operationContract('getCurrentUserProfile').strictIntegers, false);
	for (const operation of operationContracts())
		assert.ok(
			!('description' in operation) && !('summary' in operation),
			`${operation.id} keeps prose`
		);
});

void test('runtime schemas retain DTO properties named like schema annotations', () => {
	validateNamedSchema('CreatePersonalAccessTokenRequest', {
		description: 'Automation',
		expires_at: new Date(Date.now() + 60000).toISOString(),
		scopes: ['exam.view']
	});
	assert.throws(
		() =>
			validateNamedSchema('CreatePersonalAccessTokenRequest', {
				description: 5,
				expires_at: new Date(Date.now() + 60000).toISOString(),
				scopes: ['exam.view']
			}),
		ServerApiError
	);
});
