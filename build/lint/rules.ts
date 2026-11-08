import type { Rule } from 'eslint';
import ts from 'typescript';

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

export const preferDomHelpers: Rule.RuleModule = {
	meta: {
		type: 'suggestion',
		schema: [],
		messages: {
			global: 'Build DOM with h(), $() or append() from base/browser/dom.ts, or create it from the document this code was given.'
		}
	},
	create(context) {
		return {
			"CallExpression[callee.type='MemberExpression'][callee.property.name='createElement'][callee.object.type='Identifier'][callee.object.name='document']"(
				node: Rule.Node
			) {
				const reference = context.sourceCode
					.getScope(node)
					.references.find((candidate) => candidate.identifier.name === 'document');
				// A parameter or local named document is a caller-provided Document; only the global is flagged.
				if (reference && reference.resolved === null)
					context.report({ node, messageId: 'global' });
			}
		};
	}
};

export const preferElementFactory: Rule.RuleModule = {
	meta: {
		type: 'suggestion',
		schema: [],
		messages: {
			raw: 'Create elements with createElementFactory(document) from base/browser/documentElements.ts instead of calling createElement directly.'
		}
	},
	create(context) {
		return {
			"CallExpression[callee.type='MemberExpression'][callee.property.name='createElement']"(
				node: Rule.Node
			) {
				context.report({ node, messageId: 'raw' });
			}
		};
	}
};

interface TypedParserServices {
	readonly program?: ts.Program | null;
	readonly esTreeNodeToTSNodeMap?: { get(node: unknown): ts.Node };
}

/** Whether a class's own constructor declares a parameter decorator, i.e. injected services. */
function hasInjectedConstructor(declaration: ts.Declaration): boolean {
	if (!ts.isClassDeclaration(declaration) && !ts.isClassExpression(declaration)) return false;
	const constructor = declaration.members.find(ts.isConstructorDeclaration);
	return (
		constructor?.parameters.some(
			(parameter) => (ts.getDecorators(parameter)?.length ?? 0) > 0
		) ?? false
	);
}

export const noNewInjectable: Rule.RuleModule = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			injectable:
				'{{name}} declares injected services; create it with IInstantiationService.createInstance.'
		}
	},
	create(context) {
		const services = context.sourceCode.parserServices as TypedParserServices | undefined;
		const checker = services?.program?.getTypeChecker();
		const local = new Set<string>();
		return {
			'ClassDeclaration MethodDefinition[kind="constructor"] > FunctionExpression > TSParameterProperty[decorators.length>0], ClassDeclaration MethodDefinition[kind="constructor"] > FunctionExpression > Identifier[decorators.length>0]'(
				node: Rule.Node
			) {
				const owner = context.sourceCode
					.getAncestors(node)
					.reverse()
					.find((ancestor) => ancestor.type === 'ClassDeclaration');
				if (owner?.type === 'ClassDeclaration' && owner.id) local.add(owner.id.name);
			},
			'NewExpression[callee.type="Identifier"]:exit'(node: Rule.Node) {
				if (node.type !== 'NewExpression' || node.callee.type !== 'Identifier') return;
				const name = node.callee.name;
				let injected = local.has(name);
				if (!injected && checker !== undefined && services?.esTreeNodeToTSNodeMap) {
					let symbol = checker.getSymbolAtLocation(
						services.esTreeNodeToTSNodeMap.get(node.callee)
					);
					if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
						symbol = checker.getAliasedSymbol(symbol);
					injected = (symbol?.declarations ?? []).some(hasInjectedConstructor);
				}
				if (injected) context.report({ node, messageId: 'injectable', data: { name } });
			}
		};
	}
};

export const declareServiceBrand: Rule.RuleModule = {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			brand: 'Declare the service brand as `declare readonly _serviceBrand: undefined;` so no field is emitted.'
		}
	},
	create(context) {
		return {
			'PropertyDefinition[key.name="_serviceBrand"]'(node: Rule.Node) {
				const definition = node as Rule.Node & { declare?: boolean; readonly?: boolean };
				if (definition.declare !== true || definition.readonly !== true)
					context.report({ node, messageId: 'brand' });
			}
		};
	}
};

export const rules = {
	'no-focused-tests': noFocusedTests,
	'disposable-ownership': disposableOwnership,
	'no-unsafe-double-assertion': noUnsafeDoubleAssertion,
	'no-sync-fs': noSynchronousFileSystem,
	'require-leak-checked-tests': requireLeakCheckedTests,
	'prefer-dom-helpers': preferDomHelpers,
	'prefer-element-factory': preferElementFactory,
	'no-new-injectable': noNewInjectable,
	'declare-service-brand': declareServiceBrand
};
