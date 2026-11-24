import { posix } from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
import type { Rule, Container, AtRule, Document as CssDocument } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import type { Check, Diagnostic, Repository } from './types.ts';
import { diagnostic } from './types.ts';
import { readJson } from './policies.ts';
import { transferredFiles } from '../lib/formatOwnership.ts';
import type { CompositionPolicy, SourcePolicy } from './policies.ts';

type Edge = {
	readonly from: string;
	readonly to: string;
	readonly typeOnly: boolean;
	readonly dynamic: boolean;
};
type Graph = {
	readonly edges: readonly Edge[];
	readonly cssOwners: ReadonlyMap<string, readonly string[]>;
	readonly diagnostics: readonly Diagnostic[];
};

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;
const STATIC_ASSET_EXTENSIONS = ['.png', '.svg', '.wasm', '.scm'] as const;

/** Resolve CSS nesting for ownership checks without changing the emitted stylesheet. */
function effectiveSelector(rule: Rule): string {
	let parent: Container | CssDocument | undefined = rule.parent;
	while (parent && parent.type !== 'rule') parent = parent.parent;
	if (!parent) return rule.selector;
	const parentSelector = effectiveSelector(parent as Rule);
	const parentNode = selectorParser().astSync(`:is(${parentSelector})`).first.nodes[0]!;
	return selectorParser((selectors) =>
		selectors.each((selector) => {
			let nested = false;
			selector.walkNesting((node) => {
				nested = true;
				node.replaceWith(parentNode.clone());
			});
			if (!nested) {
				selector.prepend(selectorParser.combinator({ value: ' ' }));
				selector.prepend(parentNode.clone());
			}
		})
	).processSync(rule.selector);
}

/** Only positive alternatives that all require the same owner establish a root. */
function selectorOwnership(
	selector: selectorParser.Selector
): { owner: string; descended: boolean } | undefined {
	let owner: string | undefined;
	let descended = false;
	for (const node of selector.nodes) {
		if (owner !== undefined) {
			if (node.type === 'combinator') {
				if (node.value.trim() === '' || node.value === '>') descended = true;
				else if (!descended) return undefined;
			}
			continue;
		}
		if (node.type === 'class') {
			if (!node.value.startsWith('prctr-')) return undefined;
			owner = node.value;
		} else if (
			node.type === 'pseudo' &&
			[':is', ':where'].includes(node.value) &&
			node.nodes?.length
		) {
			let hasClass = false;
			node.walkClasses(() => {
				hasClass = true;
			});
			if (!hasClass) continue;
			const branches = node.nodes.map((branch) =>
				branch.type === 'selector' ? selectorOwnership(branch) : undefined
			);
			const first = branches[0];
			if (!first || !branches.every((branch) => branch?.owner === first.owner))
				return undefined;
			owner = first.owner;
			descended = branches.every((branch) => branch?.descended);
		}
	}
	return owner === undefined ? undefined : { owner, descended };
}

function isInOverridesLayer(rule: Container | undefined): boolean {
	const layers: string[] = [];
	for (let node: Container | CssDocument | undefined = rule; node; node = node.parent) {
		if (node.type === 'atrule' && (node as AtRule).name === 'layer')
			layers.unshift((node as AtRule).params.trim());
	}
	return layers.length === 1 && layers[0] === 'overrides';
}
const isTs = (path: string): boolean =>
	TS_EXTENSIONS.some((extension) => path.endsWith(extension)) && !path.endsWith('.d.ts');
const isTest = (path: string, policy: SourcePolicy): boolean =>
	path.split('/').some((segment) => policy.testSegments.includes(segment)) ||
	/(?:^|\/)test\//.test(path) ||
	/\.test\.[^.]+$/.test(path);

function resolveLocal(repository: Repository, from: string, specifier: string): string | undefined {
	const joined = posix.normalize(posix.join(posix.dirname(from), specifier));
	const candidates = specifier.endsWith('.js')
		? [
				joined.slice(0, -3) + '.ts',
				joined.slice(0, -3) + '.tsx',
				joined.slice(0, -3) + '.d.ts',
				joined.slice(0, -3) + '/index.ts'
			]
		: [joined];
	return candidates.find((candidate) => repository.exists(candidate));
}

function layer(path: string, policy: SourcePolicy): number | undefined {
	const segment = path.slice(policy.sourceRoot.length + 1).split('/')[0];
	const index = policy.layers.indexOf(segment ?? '');
	return index < 0 ? undefined : index;
}

function environment(path: string, policy: SourcePolicy): string {
	const exact = policy.environmentOverrides?.[path];
	if (exact !== undefined) return exact;
	const segments = path.split('/');
	const named = Object.keys(policy.environments).find((name) => segments.includes(name));
	if (named !== undefined) return named;
	const defaults = Object.entries(policy.defaultEnvironments ?? {});
	const folder = defaults.find(([root]) => path.startsWith(`${root}/`));
	return folder?.[1] ?? 'common';
}

/**
 * Proctor-authored contributions are renderer code: no environment folder except a
 * `common/` for DOM-free modules, no imports of another contribution, and nothing in the
 * shell or services reaches into one. Transferred VS Code clusters keep upstream topology.
 */
function contributionDiagnostics(
	repository: Repository,
	policy: SourcePolicy,
	edges: readonly Edge[],
	checkId: string
): Diagnostic[] {
	const root = policy.contributionRoot;
	if (root === undefined) return [];
	const transferred = transferredFiles(repository);
	const feature = (path: string): string | undefined =>
		path.startsWith(`${root}/`) ? path.slice(root.length + 1).split('/')[0] : undefined;
	const authored = (path: string): boolean => !transferred.has(path) && !isTest(path, policy);
	const diagnostics: Diagnostic[] = [];
	const folders = Object.keys(policy.environments).filter((name) => name !== 'common');
	for (const path of repository.files()) {
		if (feature(path) === undefined || !isTs(path) || !authored(path)) continue;
		const segments = path
			.slice(root.length + 1)
			.split('/')
			.slice(1, -1);
		const folder = segments.find((segment) => folders.includes(segment));
		if (folder !== undefined)
			diagnostics.push(
				diagnostic(
					checkId,
					path,
					`Contribution source sits in a ${folder}/ environment folder.`,
					'Place contribution code in its feature folder; use common/ only for DOM-free modules that Node tests import.'
				)
			);
	}
	for (const edge of edges) {
		if (!authored(edge.from) || !authored(edge.to)) continue;
		const from = feature(edge.from);
		const to = feature(edge.to);
		if (to === undefined || from === to) continue;
		if (from !== undefined)
			diagnostics.push(
				diagnostic(
					checkId,
					edge.from,
					`Contribution ${from} imports contribution ${to}.`,
					'Share through a workbench service, registry, command or context key instead.'
				)
			);
		else if (edge.from.startsWith('src/prctr/workbench/'))
			diagnostics.push(
				diagnostic(
					checkId,
					edge.from,
					`Workbench shell or service imports contribution ${to}.`,
					'Invert the dependency: the contribution consumes a service the workbench owns, or the window composition root selects it.'
				)
			);
	}
	return diagnostics;
}

export function analyzeSource(repository: Repository): Graph {
	const checkId = 'source.graph';
	const policy = readJson<SourcePolicy>(repository, 'build/policies/source-boundaries.json');
	const diagnostics: Diagnostic[] = [];
	const edges: Edge[] = [];
	const cssOwnersMutable = new Map<string, string[]>();
	const assetImports = policy.staticAssetImports ?? [];
	const usedAssetImports = new Set<(typeof assetImports)[number]>();
	const assetKeys = new Set<string>();
	for (const admission of assetImports) {
		const key = `${admission.importer}\0${admission.resource}`;
		if (assetKeys.has(key))
			diagnostics.push(
				diagnostic(
					checkId,
					admission.importer,
					'Duplicate static asset import admission.',
					'Keep one exact importer/resource admission.'
				)
			);
		assetKeys.add(key);
		if (
			!(admission.kind === 'data'
				? admission.resource.endsWith('.json')
				: admission.resource.endsWith('.woff'))
		) {
			diagnostics.push(
				diagnostic(
					checkId,
					admission.importer,
					'Static asset kind does not match its resource suffix.',
					'Admit JSON data or WOFF fonts only; executable modules remain source graph edges.'
				)
			);
		}
	}
	const packageManifest = readJson<{
		readonly dependencies?: Readonly<Record<string, string>>;
		readonly devDependencies?: Readonly<Record<string, string>>;
	}>(repository, 'package.json');
	const productionDependencies = new Set(Object.keys(packageManifest.dependencies ?? {}));
	const developmentDependencies = new Set(Object.keys(packageManifest.devDependencies ?? {}));
	const sourceFiles = repository
		.files()
		.filter((path) => path.startsWith(`${policy.sourceRoot}/`) && isTs(path));
	for (const path of repository
		.files()
		.filter(
			(candidate) =>
				candidate.startsWith('src/') &&
				isTs(candidate) &&
				!candidate.startsWith(`${policy.sourceRoot}/`)
		))
		diagnostics.push(
			diagnostic(
				checkId,
				path,
				'Application source is outside src/prctr.',
				'Move Proctor-owned source under its accepted namespace.'
			)
		);
	for (const path of sourceFiles) {
		const text = repository.read(path);
		const source = ts.createSourceFile(
			path,
			text,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS
		);
		const imports: { specifier: string; typeOnly: boolean; dynamic: boolean; line: number }[] =
			[];
		const visit = (node: ts.Node): void => {
			if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
				const value = node.moduleSpecifier;
				if (value !== undefined && ts.isStringLiteral(value))
					imports.push({
						specifier: value.text,
						typeOnly: ts.isImportDeclaration(node)
							? (node.importClause?.isTypeOnly ?? false)
							: node.isTypeOnly,
						dynamic: false,
						line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
					});
			} else if (
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword
			) {
				const argument = node.arguments[0];
				if (argument === undefined || !ts.isStringLiteral(argument)) {
					if (
						!isTest(path, policy) &&
						!policy.productionDynamicImportAllowlist.includes(path)
					)
						diagnostics.push(
							diagnostic(
								checkId,
								path,
								'Production dynamic import is not a string literal.',
								'Use a literal packaged import or declare the exact composition-owned allowlist entry.',
								source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
							)
						);
				} else
					imports.push({
						specifier: argument.text,
						typeOnly: false,
						dynamic: true,
						line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
					});
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
		for (const imported of imports) {
			const specifier = imported.specifier;
			const exactAsset = specifier.startsWith('.')
				? assetImports.find(
						(admission) =>
							admission.importer === path &&
							admission.resource ===
								posix.normalize(posix.join(posix.dirname(path), specifier))
					)
				: undefined;
			const staticAsset =
				exactAsset !== undefined ||
				STATIC_ASSET_EXTENSIONS.some((extension) => specifier.endsWith(extension));
			if (
				specifier.startsWith('.') &&
				!specifier.endsWith('.js') &&
				!specifier.endsWith('.css') &&
				!staticAsset
			)
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						`Local import ${specifier} lacks a .js or .css suffix.`,
						'Use a NodeNext-compatible .js import, an owned .css import, or a declared static asset.',
						imported.line
					)
				);
			if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
				if (!isTest(path, policy)) {
					const packageName = specifier.startsWith('@')
						? specifier.split('/').slice(0, 2).join('/')
						: (specifier.split('/')[0] as string);
					if (
						!productionDependencies.has(packageName) &&
						!(imported.typeOnly && developmentDependencies.has(packageName))
					)
						diagnostics.push(
							diagnostic(
								checkId,
								path,
								`Production source imports undeclared runtime package ${packageName}.`,
								'Admit and declare the runtime dependency or move this use behind an existing local interface.',
								imported.line
							)
						);
				}
				continue;
			}
			if (specifier.startsWith('node:')) {
				if (['browser', 'electron-browser', 'worker'].includes(environment(path, policy)))
					diagnostics.push(
						diagnostic(
							checkId,
							path,
							`Renderer-compatible source imports ${specifier}.`,
							'Move Node access behind a privileged adapter.',
							imported.line
						)
					);
				continue;
			}
			const target = resolveLocal(repository, path, specifier);
			if (target === undefined) {
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						`Local import ${specifier} cannot be resolved.`,
						'Add the exact source or correct the relative import.',
						imported.line
					)
				);
				continue;
			}
			if (target.endsWith('.css')) {
				edges.push({ from: path, to: target, typeOnly: false, dynamic: false });
				const owners = cssOwnersMutable.get(target) ?? [];
				owners.push(path);
				cssOwnersMutable.set(target, owners);
				continue;
			}
			if (staticAsset) {
				edges.push({ from: path, to: target, typeOnly: false, dynamic: false });
				const fromEnvironment = environment(path, policy);
				if (exactAsset) usedAssetImports.add(exactAsset);
				if (
					exactAsset?.kind !== 'data' &&
					!['browser', 'electron-browser'].includes(fromEnvironment)
				)
					diagnostics.push(
						diagnostic(
							checkId,
							path,
							`${fromEnvironment} source imports renderer asset ${specifier}.`,
							'Keep renderer assets in browser-owned source and pass native package paths from composition roots.',
							imported.line
						)
					);
				continue;
			}
			edges.push({
				from: path,
				to: target,
				typeOnly: imported.typeOnly,
				dynamic: imported.dynamic
			});
			const fromLayer = layer(path, policy);
			const toLayer = layer(target, policy);
			if (fromLayer === undefined || toLayer === undefined)
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						`Import ${specifier} crosses an unknown source layer.`,
						'Place both modules in a declared layer.'
					)
				);
			else if (toLayer > fromLayer)
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						`Layer imports upward from ${policy.layers[fromLayer]} to ${policy.layers[toLayer]}.`,
						'Invert the dependency or move the contract to a lower layer.',
						imported.line
					)
				);
			const fromEnvironment = environment(path, policy);
			const toEnvironment = environment(target, policy);
			if (!(policy.environments[fromEnvironment] ?? []).includes(toEnvironment))
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						`${fromEnvironment} source imports disallowed ${toEnvironment} source.`,
						'Route the dependency through an environment-neutral contract or an allowed adapter.',
						imported.line
					)
				);
			if (!isTest(path, policy) && isTest(target, policy))
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						'Production source imports test source.',
						'Keep fixtures and test adapters unreachable from production.'
					)
				);
		}
	}
	diagnostics.push(...contributionDiagnostics(repository, policy, edges, checkId));
	for (const admission of assetImports) {
		if (!usedAssetImports.has(admission))
			diagnostics.push(
				diagnostic(
					checkId,
					admission.importer,
					'Static asset import admission is stale or unresolved.',
					'Remove the stale entry or restore its exact static import.'
				)
			);
	}

	const adjacency = new Map<string, string[]>();
	// Type-only imports are erased by TypeScript and cannot form a runtime
	// module cycle. Keep them in the architecture graph, but exclude them from
	// the executable dependency graph checked here.
	for (const edge of edges)
		if (!edge.typeOnly)
			adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const stack: string[] = [];
	const cycles = new Set<string>();
	const walk = (node: string): void => {
		if (visiting.has(node)) {
			const start = stack.indexOf(node);
			const members = stack.slice(start);
			cycles.add([...members, node].join(' -> '));
			return;
		}
		if (visited.has(node)) return;
		visiting.add(node);
		stack.push(node);
		for (const next of adjacency.get(node) ?? []) walk(next);
		stack.pop();
		visiting.delete(node);
		visited.add(node);
	};
	for (const file of sourceFiles) walk(file);
	for (const cycle of [...cycles].sort())
		diagnostics.push(
			diagnostic(
				checkId,
				cycle.split(' -> ')[0] as string,
				`Source cycle: ${cycle}`,
				'Break the cycle through a lower-layer interface.'
			)
		);
	return {
		edges,
		cssOwners: new Map([...cssOwnersMutable].map(([key, value]) => [key, value.sort()])),
		diagnostics
	};
}

export const sourceGraphCheck: Check = {
	id: 'source.graph',
	category: 'source',
	contractRequired: true,
	run: ({ repository }) => analyzeSource(repository).diagnostics
};

export const compositionCheck: Check = {
	id: 'source.compositions',
	category: 'source',
	contractRequired: true,
	run: ({ repository }) => {
		const policy = readJson<CompositionPolicy>(repository, 'build/policies/compositions.json');
		if (!repository.exists(policy.activationPath)) return [];
		const diagnostics: Diagnostic[] = [];
		if (policy.compositions.length === 0)
			diagnostics.push(
				diagnostic(
					'source.compositions',
					'build/policies/compositions.json',
					'The code layer exists without declared compositions.',
					'Declare every production entrypoint and its closed roots before adding code-layer source.'
				)
			);
		const graph = analyzeSource(repository);
		const adjacency = new Map<string, Edge[]>();
		for (const edge of graph.edges)
			adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
		const allReachable = new Set<string>();
		const entrypoints = new Set<string>();
		const ids = new Set<string>();
		for (const composition of policy.compositions) {
			if (ids.has(composition.id))
				diagnostics.push(
					diagnostic(
						'source.compositions',
						'build/policies/compositions.json',
						`Composition id ${composition.id} is duplicated.`,
						'Give every immutable composition one unique id.'
					)
				);
			ids.add(composition.id);
			if (entrypoints.has(composition.entrypoint))
				diagnostics.push(
					diagnostic(
						'source.compositions',
						composition.entrypoint,
						'Entrypoint is owned by more than one composition.',
						'Keep one composition owner per production entrypoint.'
					)
				);
			entrypoints.add(composition.entrypoint);
			if (!repository.exists(composition.entrypoint)) {
				diagnostics.push(
					diagnostic(
						'source.compositions',
						composition.entrypoint,
						`Composition ${composition.id} entrypoint does not exist.`,
						'Add the declared entrypoint or remove the stale composition.'
					)
				);
				continue;
			}
			if (composition.preload !== undefined && !repository.exists(composition.preload))
				diagnostics.push(
					diagnostic(
						'source.compositions',
						composition.preload,
						`Composition ${composition.id} preload does not exist.`,
						'Add the declared preload or correct the manifest.'
					)
				);
			const reachable = new Set<string>();
			const queue = [
				composition.entrypoint,
				...(composition.preload === undefined ? [] : [composition.preload])
			];
			while (queue.length > 0) {
				const current = queue.pop() as string;
				if (reachable.has(current)) continue;
				reachable.add(current);
				allReachable.add(current);
				for (const edge of adjacency.get(current) ?? []) {
					if (
						edge.dynamic &&
						!composition.allowedDynamicImports.some(
							(root) => edge.to === root || edge.to.startsWith(`${root}/`)
						)
					)
						diagnostics.push(
							diagnostic(
								'source.compositions',
								edge.from,
								`Composition ${composition.id} reaches undeclared dynamic target ${edge.to}.`,
								'Declare the exact packaged dynamic root or make the import static.'
							)
						);
					queue.push(edge.to);
				}
			}
			for (const required of composition.required)
				if (
					![...reachable].some(
						(path) => path === required || path.startsWith(`${required}/`)
					)
				)
					diagnostics.push(
						diagnostic(
							'source.compositions',
							composition.entrypoint,
							`Composition ${composition.id} cannot reach required root ${required}.`,
							'Import the packaged contribution through the declared composition.'
						)
					);
			for (const forbidden of composition.forbidden)
				if (
					[...reachable].some(
						(path) => path === forbidden || path.startsWith(`${forbidden}/`)
					)
				)
					diagnostics.push(
						diagnostic(
							'source.compositions',
							composition.entrypoint,
							`Composition ${composition.id} reaches forbidden root ${forbidden}.`,
							'Remove the capability from this immutable composition.'
						)
					);
		}
		const sourcePolicy = readJson<SourcePolicy>(
			repository,
			'build/policies/source-boundaries.json'
		);
		for (const path of repository
			.files()
			.filter(
				(candidate) =>
					candidate.startsWith(`${policy.activationPath}/`) &&
					isTs(candidate) &&
					!isTest(candidate, sourcePolicy)
			))
			if (!allReachable.has(path))
				diagnostics.push(
					diagnostic(
						'source.compositions',
						path,
						'Production code-layer source is unreachable from every declared composition.',
						'Reach it from exactly the intended composition or remove the undeclared production entrypoint.'
					)
				);
		return diagnostics;
	}
};

const CASCADE = ['reset', 'theme', 'base', 'controls', 'workbench', 'contributions', 'overrides'];
const DOCUMENT_RESET_PATH = 'src/prctr/workbench/browser/documentLayout.css';
/** A hex, rgb() or hsl() colour written into a declaration instead of a token. */
const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/iu;
const DOCUMENT_RESET_SELECTORS = new Set(['html', 'body']);
export const cssCheck: Check = {
	id: 'source.css',
	category: 'source',
	contractRequired: true,
	run: ({ repository }) => {
		const graph = analyzeSource(repository);
		const diagnostics: Diagnostic[] = [];
		const policy = readJson<SourcePolicy>(repository, 'build/policies/source-boundaries.json');
		const importantOverrides = policy.cssImportantOverrides ?? [];
		const usedImportantOverrides = new Set<number>();
		const transferred = transferredFiles(repository);
		const rawColorStylesheets = new Set(policy.rawColorStylesheets ?? []);
		const usedRawColorStylesheets = new Set<string>();
		for (const path of repository
			.files()
			.filter(
				(candidate) => candidate.startsWith('src/prctr/') && candidate.endsWith('.css')
			)) {
			const owners = graph.cssOwners.get(path) ?? [];
			if (owners.length !== 1)
				diagnostics.push(
					diagnostic(
						'source.css',
						path,
						`Stylesheet has ${owners.length} TypeScript owners; exactly one is required.`,
						'Import the stylesheet from the single module that owns its DOM.'
					)
				);
			let root;
			try {
				root = postcss.parse(repository.read(path), { from: path });
			} catch (error) {
				diagnostics.push(
					diagnostic('source.css', path, String(error), 'Fix the CSS syntax.')
				);
				continue;
			}
			const seenLayers: number[] = [];
			const roots = new Set<string>();
			root.walkAtRules('layer', (rule) => {
				const name = rule.params.trim();
				// The document reset alone states the whole order, ahead of every other stylesheet.
				if (
					rule.nodes === undefined &&
					path === DOCUMENT_RESET_PATH &&
					name === CASCADE.join(', ')
				)
					return;
				const index = CASCADE.indexOf(name);
				if (index < 0)
					diagnostics.push(
						diagnostic(
							'source.css',
							path,
							`Unknown cascade layer ${name}.`,
							`Use one of ${CASCADE.join(', ')}.`
						)
					);
				else seenLayers.push(index);
			});
			for (let index = 1; index < seenLayers.length; index++)
				if ((seenLayers[index] as number) < (seenLayers[index - 1] as number))
					diagnostics.push(
						diagnostic(
							'source.css',
							path,
							'Cascade layers occur out of accepted order.',
							`Order layers as ${CASCADE.join(', ')}.`
						)
					);
			root.walkDecls((declaration) => {
				if (declaration.important) {
					const selector =
						declaration.parent?.type === 'rule'
							? declaration.parent.selector
							: undefined;
					const overrideIndex = importantOverrides.findIndex(
						(override) =>
							override.path === path &&
							override.selector === selector &&
							override.property === declaration.prop
					);
					const inOverrideLayer = isInOverridesLayer(declaration.parent);
					if (overrideIndex < 0 || !inOverrideLayer)
						diagnostics.push(
							diagnostic(
								'source.css',
								path,
								'!important is not backed by a structured override-layer exception.',
								'Use ordinary cascade ownership or add reviewed exception evidence in the overrides layer.'
							)
						);
					else usedImportantOverrides.add(overrideIndex);
				}
				// Proctor-authored stylesheets take colour from tokens, so themes and high contrast reach it.
				if (!transferred.has(path) && RAW_COLOR.test(declaration.value)) {
					if (rawColorStylesheets.has(path)) usedRawColorStylesheets.add(path);
					else
						diagnostics.push(
							diagnostic(
								'source.css',
								path,
								`${declaration.prop} uses a raw colour (${declaration.value}).`,
								'Use a --prctr-* colour token.'
							)
						);
				}
				for (const token of declaration.toString().matchAll(/--([A-Za-z0-9_-]+)/g))
					if (!(token[1] as string).startsWith('prctr-'))
						diagnostics.push(
							diagnostic(
								'source.css',
								path,
								`Custom property --${token[1]} is not Proctor-owned.`,
								'Use a --prctr-* semantic token.'
							)
						);
			});
			root.walkRules((rule) => {
				if (rule.parent?.type === 'atrule' && rule.parent.name.endsWith('keyframes'))
					return;
				try {
					selectorParser((selectors) =>
						selectors.each((selector) => {
							let firstClass: string | undefined;
							let hasId = false;
							let rootHas = false;
							selector.walk((node) => {
								if (node.type === 'class' && firstClass === undefined)
									firstClass = node.value;
								if (node.type === 'id') hasId = true;
								if (
									node.type === 'pseudo' &&
									node.value === ':has' &&
									firstClass === undefined
								)
									rootHas = true;
							});
							if (hasId)
								diagnostics.push(
									diagnostic(
										'source.css',
										path,
										`Selector ${selector.toString()} uses an id.`,
										'Use the owning .prctr-* root and semantic state.'
									)
								);
							if (rootHas)
								diagnostics.push(
									diagnostic(
										'source.css',
										path,
										`Selector ${selector.toString()} uses root-anchored :has().`,
										'Anchor relational matching below the owning control root.'
									)
								);
							const owner = selectorOwnership(selector)?.owner;
							if (owner === undefined) {
								const selectorText = selector.toString().trim();
								if (
									path !== DOCUMENT_RESET_PATH ||
									!DOCUMENT_RESET_SELECTORS.has(selectorText)
								)
									diagnostics.push(
										diagnostic(
											'source.css',
											path,
											`Selector ${selector.toString()} is not rooted in .prctr-*.`,
											'Give the owning control one Proctor root class or use the exact composition-owned document reset.'
										)
									);
							} else roots.add(owner);
						})
					).processSync(effectiveSelector(rule));
				} catch (error) {
					diagnostics.push(
						diagnostic('source.css', path, String(error), 'Fix the selector syntax.')
					);
				}
			});
			if (roots.size > 1)
				diagnostics.push(
					diagnostic(
						'source.css',
						path,
						`Stylesheet exposes multiple roots: ${[...roots].sort().join(', ')}.`,
						'Keep one .prctr-* DOM root per owner.'
					)
				);
		}
		for (const [index, override] of importantOverrides.entries())
			if (!usedImportantOverrides.has(index))
				diagnostics.push(
					diagnostic(
						'source.css',
						override.path,
						`CSS important override for ${override.selector} ${override.property} is stale or duplicated.`,
						'Remove stale exception evidence or restore its exact reviewed declaration.'
					)
				);
		for (const path of rawColorStylesheets)
			if (!usedRawColorStylesheets.has(path))
				diagnostics.push(
					diagnostic(
						'source.css',
						path,
						'Stylesheet is listed as holding raw colours but holds none.',
						'Remove it from rawColorStylesheets.'
					)
				);
		return diagnostics;
	}
};
