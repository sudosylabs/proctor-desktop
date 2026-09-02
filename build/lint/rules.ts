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

export const rules = {
	'no-focused-tests': noFocusedTests,
	'disposable-ownership': disposableOwnership,
	'no-unsafe-double-assertion': noUnsafeDoubleAssertion
};
