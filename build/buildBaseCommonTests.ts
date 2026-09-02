import { buildNodeTests } from './lib/nodeTests.ts';

await buildNodeTests('base', 'base-common-tests', 'build/tsconfig.base-common-test.json');
