import assert from 'node:assert';
import { test } from 'node:test';
import { SyncDescriptor } from '../../../../src/prctr/platform/instantiation/common/descriptors.ts';
import {
	getSingletonServiceDescriptors,
	InstantiationType,
	registerSingleton
} from '../../../../src/prctr/platform/instantiation/common/extensions.ts';
import { createDecorator } from '../../../../src/prctr/platform/instantiation/common/instantiation.ts';

interface IFixtureService {
	readonly _serviceBrand: undefined;
	readonly value: number;
}

const IFixtureService = createDecorator<IFixtureService>('prctr.test.fixtureService');

class FixtureService implements IFixtureService {
	declare readonly _serviceBrand: undefined;
	readonly value = 42;
}

void test('singleton registration preserves the delayed-instantiation descriptor', () => {
	const before = getSingletonServiceDescriptors().length;
	registerSingleton(IFixtureService, FixtureService, InstantiationType.Delayed);

	const descriptors = getSingletonServiceDescriptors();
	assert.strictEqual(descriptors.length, before + 1);
	assert.strictEqual(descriptors[before]?.[0], IFixtureService);
	assert.ok(descriptors[before]?.[1] instanceof SyncDescriptor);
	assert.strictEqual(descriptors[before]?.[1].supportsDelayedInstantiation, true);
});
