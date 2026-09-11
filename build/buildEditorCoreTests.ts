import { buildNodeTests } from './lib/nodeTests.ts';

// Node owns the test transport's CommonJS module and its shared JSON-RPC runtime.
// Production JSON workers are separately bundled for the browser runtime.
await buildNodeTests('editor', 'editor-core-tests', 'build/tsconfig.editor-core-test.json', [
	'vscode-languageserver',
	'@vscode/l10n'
]);
