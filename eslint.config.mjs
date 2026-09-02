import tseslint from 'typescript-eslint';
import { readFileSync } from 'node:fs';
import { rules } from './build/lint/rules.ts';
import { FileSystemRepository } from './build/checks/repository.ts';
import { transferredFiles } from './build/lib/formatOwnership.ts';
import { upstreamDirectives } from './build/lint/upstreamDirectives.ts';

const solution = JSON.parse(readFileSync(new URL('./tsconfig.json', import.meta.url), 'utf8'));
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
	{ files: ['test/**/*.ts'], rules: { 'proctor/no-focused-tests': 'error' } }
];
