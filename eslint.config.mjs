import tseslint from 'typescript-eslint';
import { readFileSync } from 'node:fs';
import { rules } from './build/lint/rules.ts';
import { FileSystemRepository } from './build/checks/repository.ts';
import { transferredFiles } from './build/lib/formatOwnership.ts';
import { upstreamDirectives } from './build/lint/upstreamDirectives.ts';

const solution = JSON.parse(readFileSync(new URL('./tsconfig.json', import.meta.url), 'utf8'));
const legacyElementCreation = JSON.parse(
	readFileSync(new URL('./build/lint/legacyElementCreation.json', import.meta.url), 'utf8')
);
const transferred = [...transferredFiles(new FileSystemRepository(import.meta.dirname))];

export default [
	{
		ignores: [
			'node_modules/**',
			'.build/**',
			'out/**',
			'native/**',
			'.scratch/**',
			'.generated-check/**',
			'coverage/**',
			'artifacts/**',
			'.agents/**',
			'.github/skills/**',
			'.claude/**'
		]
	},
	{
		files: ['**/*.{ts,mjs}'],
		languageOptions: { parser: tseslint.parser },
		plugins: {
			'@typescript-eslint': tseslint.plugin,
			proctor: { rules, processors: { upstream: upstreamDirectives } }
		},
		linterOptions: { reportUnusedDisableDirectives: 'error' },
		rules: {
			'constructor-super': 'error',
			'no-async-promise-executor': 'error',
			'no-debugger': 'error',
			'no-dupe-else-if': 'error',
			'no-duplicate-case': 'error',
			'no-eval': 'error',
			'no-loss-of-precision': 'error',
			'no-unsafe-finally': 'error',
			'proctor/disposable-ownership': 'error'
		}
	},
	{
		files: transferred.filter((path) => path.endsWith('.ts')),
		processor: 'proctor/upstream',
		linterOptions: { reportUnusedDisableDirectives: 'off' }
	},
	{
		files: ['**/*.ts'],
		ignores: transferred,
		languageOptions: {
			parserOptions: {
				project: solution.references.map((reference) => reference.path),
				tsconfigRootDir: import.meta.dirname
			}
		},
		rules: {
			'@typescript-eslint/no-floating-promises': [
				'error',
				{
					ignoreVoid: true,
					ignoreIIFE: false,
					allowForKnownSafeCalls: [
						{
							from: 'package',
							package: 'node',
							name: ['test', 'it', 'describe', 'suite']
						}
					]
				}
			],
			'@typescript-eslint/no-misused-promises': 'error'
		}
	},
	{
		files: ['src/**/*.ts'],
		ignores: transferred,
		rules: {
			'proctor/no-unsafe-double-assertion': 'error',
			'no-constant-binary-expression': 'error'
		}
	},
	{
		files: ['src/prctr/**/*.ts'],
		ignores: transferred,
		rules: { 'proctor/no-sync-fs': 'error' }
	},
	{
		files: ['src/prctr/**/browser/**/*.ts', 'src/prctr/workbench/**/*.ts'],
		ignores: transferred,
		rules: { 'proctor/prefer-dom-helpers': 'error' }
	},
	{
		// Ratchet: files listed in legacyElementCreation.json predate the factory and leave the list as they are touched.
		files: ['src/prctr/**/browser/**/*.ts', 'src/prctr/workbench/**/*.ts'],
		ignores: [
			...transferred,
			...legacyElementCreation,
			'src/prctr/base/browser/documentElements.ts'
		],
		rules: { 'proctor/prefer-element-factory': 'error' }
	},
	{
		// A standalone bundle for the isolated PDF page; it stays free of the workbench DOM module.
		files: ['src/prctr/workbench/services/resourcePreview/browser/pdfPreviewEntry.ts'],
		rules: { 'proctor/prefer-dom-helpers': 'off' }
	},
	{
		// Reads two small branding files once, before the loopback callback listener starts.
		files: ['src/prctr/workbench/node/desktopAuthCallbackPage.ts'],
		rules: { 'proctor/no-sync-fs': 'off' }
	},
	{ files: ['test/**/*.ts'], rules: { 'proctor/no-focused-tests': 'error' } },
	{
		// Chromium-harness and real-Electron suites run outside the Node runner; checks test build tooling.
		files: ['test/**/*.test.ts'],
		ignores: ['test/checks/**', 'test/browser/**', 'test/electron/**'],
		rules: { 'proctor/require-leak-checked-tests': 'error' }
	}
];
