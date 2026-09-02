import { posix } from 'node:path';
import ts from 'typescript';
import type { Check, Diagnostic } from './types.ts';
import { diagnostic } from './types.ts';
import { resolveRepositoryPath } from './repository.ts';

export const toolingGraphCheck: Check = {
	id: 'tooling.graph',
	category: 'source',
	contractRequired: true,
	run({ repository }) {
		const files = repository
			.files()
			.filter(
				(path) => /^(?:build|scripts)\/.*\.ts$/.test(path) || path === 'eslint.config.mjs'
			);
		const diagnostics: Diagnostic[] = [];
		const graph = new Map<string, string[]>();
		for (const path of files) {
			const source = ts.createSourceFile(
				path,
				repository.read(path),
				ts.ScriptTarget.Latest,
				true
			);
			const dependencies: string[] = [];
			function visit(node: ts.Node): void {
				if (
					(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
					node.moduleSpecifier &&
					ts.isStringLiteral(node.moduleSpecifier)
				) {
					const specifier = node.moduleSpecifier.text;
					const onlyTypes = ts.isImportDeclaration(node)
						? node.importClause?.isTypeOnly
						: node.isTypeOnly;
					if (specifier.startsWith('.')) {
						const resolved = resolveRepositoryPath(path, specifier);
						const target = repository.exists(resolved)
							? resolved
							: resolved.replace(/\.js$/, '.ts');
						if (!repository.exists(target))
							diagnostics.push(
								diagnostic(
									'tooling.graph',
									path,
									`Unresolved tooling import ${specifier}.`,
									'Import an existing module with an explicit runtime extension.'
								)
							);
						if (!onlyTypes && files.includes(target)) dependencies.push(target);
						if (posix.extname(specifier) === '')
							diagnostics.push(
								diagnostic(
									'tooling.graph',
									path,
									`Extensionless tooling import ${specifier}.`,
									'Use an explicit .ts extension for Node-stripped tooling.'
								)
							);
					}
				}
				ts.forEachChild(node, visit);
			}
			visit(source);
			graph.set(path, dependencies);
		}
		const visited = new Set<string>();
		const active: string[] = [];
		function visit(path: string): void {
			if (active.includes(path)) {
				diagnostics.push(
					diagnostic(
						'tooling.graph',
						path,
						`Tooling cycle: ${[...active.slice(active.indexOf(path)), path].join(' -> ')}`,
						'Move shared mechanics below their command callers.'
					)
				);
				return;
			}
			if (visited.has(path)) return;
			active.push(path);
			for (const target of graph.get(path) ?? []) visit(target);
			active.pop();
			visited.add(path);
		}
		for (const path of files) visit(path);
		return diagnostics;
	}
};
