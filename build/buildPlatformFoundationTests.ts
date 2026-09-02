import { buildNodeTests } from './lib/nodeTests.ts';

await buildNodeTests(
	'platform',
	'platform-foundation-tests',
	'build/tsconfig.platform-foundation-test.json'
);
