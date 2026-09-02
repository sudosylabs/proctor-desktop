import { buildNodeTests } from './lib/nodeTests.ts';

await buildNodeTests('editor', 'editor-core-tests', 'build/tsconfig.editor-core-test.json');
