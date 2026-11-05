import type { Rule } from 'eslint';

// These are Proctor contracts, not a copy of VS Code's product-specific plugin.
export const noFocusedTests: Rule.RuleModule = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			focused: 'Focused tests omit other verification. Remove only before committing.'
		}
	},
	create(context) {
		return {
			"CallExpression[callee.type='MemberExpression'][callee.property.name='only']"(
				node: Rule.Node
			) {
				context.report({ node, messageId: 'focused' });
			},
			"CallExpression > ObjectExpression.arguments > Property[key.name='only'][value.value=true]"(
				node: Rule.Node
			) {
				context.report({ node, messageId: 'focused' });
			}
		};
	}
};

export const disposableOwnership: Rule.RuleModule = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			mutable:
				'A disposable container must have stable ownership: use const or a readonly field.'
		}
	},
	create(context) {
		return {
			"VariableDeclaration[kind!='const'] > VariableDeclarator > NewExpression[callee.name=/^(DisposableStore|MutableDisposable)$/]"(
				node: Rule.Node
			) {
				context.report({ node, messageId: 'mutable' });
			},
			'PropertyDefinition[readonly!=true] > NewExpression[callee.name=/^(DisposableStore|MutableDisposable)$/]'(
				node: Rule.Node
			) {
				context.report({ node, messageId: 'mutable' });
			}
		};
	}
};

export const noUnsafeDoubleAssertion: Rule.RuleModule = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			assertion: 'Do not erase a production type through any before asserting another type.'
		}
	},
	create(context) {
		return {
			"TSAsExpression > TSAsExpression.expression[typeAnnotation.type='TSAnyKeyword']"(
				node: Rule.Node
			) {
				context.report({ node, messageId: 'assertion' });
			}
		};
	}
};

const SYNCHRONOUS_FILE_SYSTEM_CALLS = new Set([
	'accessSync',
	'appendFileSync',
	'chmodSync',
	'copyFileSync',
	'existsSync',
	'lstatSync',
	'mkdirSync',
	'mkdtempSync',
	'openSync',
	'readFileSync',
	'readdirSync',
	'realpathSync',
	'renameSync',
	'rmSync',
	'rmdirSync',
	'statSync',
	'unlinkSync',
	'writeFileSync'
]);

export const noSynchronousFileSystem: Rule.RuleModule = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			synchronous:
				'Synchronous file-system calls block the process. Use the asynchronous form or add a reasoned exception in eslint.config.mjs.'
		}
	},
	create(context) {
		return {
			CallExpression(node) {
				const { callee } = node;
				const name =
					callee.type === 'Identifier'
						? callee.name
						: callee.type === 'MemberExpression' &&
							  callee.object.type === 'Identifier' &&
							  /^(?:fs|fsSync|nodeFs)$/.test(callee.object.name) &&
							  callee.property.type === 'Identifier'
							? callee.property.name
							: undefined;
				if (name !== undefined && SYNCHRONOUS_FILE_SYSTEM_CALLS.has(name))
					context.report({ node, messageId: 'synchronous' });
			}
		};
	}
};

const LIFECYCLE_MODULE = /(?:^|\/)base\/common\/lifecycle\.(?:ts|js)$/;

export const requireLeakCheckedTests: Rule.RuleModule = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			missing:
				'This test file imports disposable machinery but never calls ensureNoDisposablesAreLeakedInTestSuite().'
		}
	},
	create(context) {
		let importsLifecycle = false;
		let checksLeaks = false;
		return {
			ImportDeclaration(node) {
				if (
					(node as { importKind?: string }).importKind !== 'type' &&
					typeof node.source.value === 'string' &&
					LIFECYCLE_MODULE.test(node.source.value)
				)
					importsLifecycle = true;
			},
			CallExpression(node) {
				if (
					node.callee.type === 'Identifier' &&
					node.callee.name === 'ensureNoDisposablesAreLeakedInTestSuite'
				)
					checksLeaks = true;
			},
			'Program:exit'(node) {
				if (importsLifecycle && !checksLeaks)
					context.report({ node, messageId: 'missing' });
			}
		};
	}
};

export const rules = {
	'no-focused-tests': noFocusedTests,
	'disposable-ownership': disposableOwnership,
	'no-unsafe-double-assertion': noUnsafeDoubleAssertion,
	'no-sync-fs': noSynchronousFileSystem,
	'require-leak-checked-tests': requireLeakCheckedTests
};
