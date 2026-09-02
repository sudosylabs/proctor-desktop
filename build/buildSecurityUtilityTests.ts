import { buildNodeTests } from './lib/nodeTests.ts';

await buildNodeTests(
	'security-utility',
	'security-utility-tests',
	'build/tsconfig.security-utility-test.json'
);
