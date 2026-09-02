import { posix } from 'node:path';
import { parse as parseToml, type TomlTable, type TomlValue } from 'smol-toml';
import type { Diagnostic, Repository } from './types.ts';
import { diagnostic } from './types.ts';

export type CargoAdmission = {
	readonly package: string;
	readonly version: string;
	readonly kind: 'development' | 'production';
	readonly declarations?: readonly CargoAdmissionDeclaration[];
};

export type CargoAdmissionDeclaration = {
	readonly manifest: string;
	readonly alias: string;
	readonly kind: 'development' | 'production';
	readonly features: readonly string[];
	readonly defaultFeatures: boolean;
	readonly optional: boolean;
	readonly targetScope: string | null;
};

type CargoDeclaration = {
	readonly alias: string;
	readonly name: string;
	readonly version: string;
	readonly kind: 'development' | 'production';
	readonly path: string;
	readonly features: readonly string[];
	readonly defaultFeatures: boolean;
	readonly optional: boolean;
	readonly targetScope: string | null;
};

const dependencyGroups = [
	['dependencies', 'production'],
	['build-dependencies', 'production'],
	['dev-dependencies', 'development']
] as const;

const admittedDeclarationKeys = new Set([
	'version',
	'package',
	'path',
	'workspace',
	'git',
	'registry',
	'registry-index',
	'branch',
	'tag',
	'rev',
	'features',
	'default-features',
	'optional'
]);

export function checkCargoDependencies(
	repository: Repository,
	admissions: readonly CargoAdmission[],
	diagnostics: Diagnostic[]
): void {
	const declared = new Map<string, CargoDeclaration[]>();
	const workspaceManifests = cargoWorkspaceManifests(repository, diagnostics);
	const cargoManifests = repository
		.files()
		.filter((candidate) => candidate === 'Cargo.toml' || candidate.endsWith('/Cargo.toml'));
	for (const path of cargoManifests) {
		if (!workspaceManifests.has(path))
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					'Cargo package manifest is outside the declared native workspace.',
					'Add the package directory to native/Cargo.toml workspace members or remove the orphan manifest.'
				)
			);
	}
	for (const path of workspaceManifests) {
		if (!repository.exists(path)) {
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					'Native Cargo workspace member has no manifest.',
					'Add its Cargo.toml or remove the stale workspace member.'
				)
			);
			continue;
		}
		const manifest = parseCargoManifest(repository.read(path), path, diagnostics);
		if (manifest === undefined) continue;
		checkCargoOverrides(manifest, path, diagnostics);
		const manifestDeclarations = cargoDeclarations(
			repository,
			manifest,
			path,
			workspaceManifests,
			diagnostics
		);
		checkCargoFeatureForwarding(manifest, path, manifestDeclarations, diagnostics);
		for (const declaration of manifestDeclarations) {
			const packageDeclarations = declared.get(declaration.name) ?? [];
			packageDeclarations.push(declaration);
			declared.set(declaration.name, packageDeclarations);
		}
	}
	checkCargoConfiguration(repository, diagnostics);
	reconcileCargoAdmissions(declared, admissions, diagnostics);
}

function cargoWorkspaceManifests(
	repository: Repository,
	diagnostics: Diagnostic[]
): ReadonlySet<string> {
	const workspacePath = 'native/Cargo.toml';
	const manifests = new Set([workspacePath]);
	if (!repository.exists(workspacePath)) return manifests;
	const manifest = parseCargoManifest(repository.read(workspacePath), workspacePath, diagnostics);
	const workspace = manifest === undefined ? undefined : asTable(manifest.workspace);
	const members = workspace?.members;
	if (!Array.isArray(members)) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				workspacePath,
				'Native Cargo workspace has no explicit members array.',
				'Declare every capability package as one exact workspace member.'
			)
		);
		return manifests;
	}
	for (const member of members) {
		if (
			typeof member !== 'string' ||
			member.length === 0 ||
			member.includes('\\') ||
			posix.isAbsolute(member) ||
			member.split('/').includes('..') ||
			/[*?\[]/.test(member)
		) {
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					workspacePath,
					`Cargo workspace member ${String(member)} is not an exact portable in-repository path.`,
					'Use one repository-relative package directory without globs or parent traversal.'
				)
			);
			continue;
		}
		manifests.add(posix.normalize(posix.join('native', member, 'Cargo.toml')));
	}
	return manifests;
}

function parseCargoManifest(
	manifest: string,
	path: string,
	diagnostics: Diagnostic[]
): TomlTable | undefined {
	try {
		return parseToml(manifest);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`Cargo manifest is not valid TOML: ${detail}`,
				'Use valid Cargo TOML in the structurally checked manifest subset.'
			)
		);
		return undefined;
	}
}

function cargoDeclarations(
	repository: Repository,
	manifest: TomlTable,
	path: string,
	workspaceManifests: ReadonlySet<string>,
	diagnostics: Diagnostic[]
): readonly CargoDeclaration[] {
	const declarations: CargoDeclaration[] = [];
	collectDependencyContainer(
		repository,
		manifest,
		path,
		workspaceManifests,
		diagnostics,
		declarations,
		null
	);
	const workspace = asTable(manifest.workspace);
	if (workspace !== undefined)
		collectDependencyContainer(
			repository,
			workspace,
			path,
			workspaceManifests,
			diagnostics,
			declarations,
			null
		);
	const targets = asTable(manifest.target);
	if (targets !== undefined) {
		for (const [selector, target] of Object.entries(targets)) {
			const targetTable = asTable(target);
			if (targetTable !== undefined)
				collectDependencyContainer(
					repository,
					targetTable,
					path,
					workspaceManifests,
					diagnostics,
					declarations,
					normalizeCargoTargetScope(selector)
				);
		}
	}
	return declarations;
}

function collectDependencyContainer(
	repository: Repository,
	container: TomlTable,
	path: string,
	workspaceManifests: ReadonlySet<string>,
	diagnostics: Diagnostic[],
	declarations: CargoDeclaration[],
	targetScope: string | null
): void {
	for (const [group, kind] of dependencyGroups) {
		if (!Object.hasOwn(container, group)) continue;
		const dependencyTable = asTable(container[group]);
		if (dependencyTable === undefined) {
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					`Cargo ${group} must be a dependency table.`,
					'Use one explicit dependency table with structurally valid declarations.'
				)
			);
			continue;
		}
		for (const [alias, value] of Object.entries(dependencyTable)) {
			const declaration = cargoDeclaration(
				repository,
				alias,
				value,
				kind,
				path,
				workspaceManifests,
				diagnostics,
				targetScope
			);
			if (declaration !== undefined) declarations.push(declaration);
		}
	}
}

function cargoDeclaration(
	repository: Repository,
	alias: string,
	value: TomlValue,
	kind: 'development' | 'production',
	path: string,
	workspaceManifests: ReadonlySet<string>,
	diagnostics: Diagnostic[],
	targetScope: string | null
): CargoDeclaration | undefined {
	if (!/^[A-Za-z0-9_-]+$/.test(alias)) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`Cargo dependency key ${alias} is unsupported.`,
				'Use a Cargo package alias containing only letters, digits, hyphens, or underscores.'
			)
		);
		return undefined;
	}
	if (typeof value === 'string')
		return registryDeclaration(
			alias,
			alias,
			value,
			kind,
			path,
			[],
			true,
			false,
			targetScope,
			diagnostics
		);
	const declaration = asTable(value);
	if (declaration === undefined) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`${alias} uses an unsupported Cargo dependency declaration.`,
				'Use an exact registry version or an explicit local path/workspace dependency.'
			)
		);
		return undefined;
	}
	const unknownKeys = Object.keys(declaration).filter((key) => !admittedDeclarationKeys.has(key));
	if (unknownKeys.length > 0) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`${alias} uses unsupported Cargo dependency properties: ${unknownKeys.join(', ')}.`,
				'Use only the structurally admitted dependency properties.'
			)
		);
		return undefined;
	}
	if (
		['git', 'registry', 'registry-index', 'branch', 'tag', 'rev'].some((key) =>
			Object.hasOwn(declaration, key)
		)
	) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`${alias} uses an unsupported alternate Cargo source.`,
				'Use the default crates.io registry with an admitted exact version, or extend the policy to model the exact source and revision.'
			)
		);
		return undefined;
	}
	if (Object.hasOwn(declaration, 'path')) {
		if (typeof declaration.path === 'string')
			validateCargoLocalPath(
				repository,
				path,
				declaration.path,
				workspaceManifests,
				diagnostics
			);
		else
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					`${alias} uses an unsupported Cargo path declaration.`,
					'Use one repository-relative string path to a declared native workspace package.'
				)
			);
		return undefined;
	}
	if (Object.hasOwn(declaration, 'workspace')) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				declaration.workspace === true
					? `${alias} uses Cargo workspace dependency inheritance, whose member scope and optionality are not admitted.`
					: `${alias} uses an unsupported Cargo workspace declaration.`,
				'Use one direct exact registry declaration in its owning package until workspace-inherited registry decisions are modeled as complete per-member tuples.'
			)
		);
		return undefined;
	}
	const packageName = Object.hasOwn(declaration, 'package') ? declaration.package : alias;
	if (typeof packageName !== 'string' || !/^[A-Za-z0-9_-]+$/.test(packageName)) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`${alias} uses an unsupported Cargo package rename.`,
				'Use a registry package name containing only letters, digits, hyphens, or underscores.'
			)
		);
		return undefined;
	}
	const features = cargoFeatures(alias, declaration.features, path, diagnostics);
	if (features === undefined) return undefined;
	const defaultFeatures = declaration['default-features'] ?? true;
	if (typeof defaultFeatures !== 'boolean') {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`${packageName} uses a non-boolean Cargo default-features decision.`,
				'Set default-features to true or false and admit that exact decision.'
			)
		);
		return undefined;
	}
	const optional = declaration.optional ?? false;
	if (typeof optional !== 'boolean') {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`${packageName} uses a non-boolean optional decision.`,
				'Set optional to true or false.'
			)
		);
		return undefined;
	}
	if (typeof declaration.version !== 'string') {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`${packageName} has no exact Cargo registry version.`,
				'Declare an exact =version or use a local path/workspace dependency.'
			)
		);
		return undefined;
	}
	return registryDeclaration(
		alias,
		packageName,
		declaration.version,
		kind,
		path,
		features,
		defaultFeatures,
		optional,
		targetScope,
		diagnostics
	);
}

function cargoFeatures(
	name: string,
	value: TomlValue | undefined,
	path: string,
	diagnostics: Diagnostic[]
): readonly string[] | undefined {
	if (value === undefined) return [];
	if (
		!Array.isArray(value) ||
		value.some((feature) => typeof feature !== 'string' || feature.length === 0)
	) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`${name} uses an invalid Cargo feature list.`,
				'Use a finite list of non-empty feature strings and admit its normalized value.'
			)
		);
		return undefined;
	}
	return [...new Set(value as string[])].sort();
}

function registryDeclaration(
	alias: string,
	name: string,
	rawVersion: string,
	kind: 'development' | 'production',
	path: string,
	features: readonly string[],
	defaultFeatures: boolean,
	optional: boolean,
	targetScope: string | null,
	diagnostics: Diagnostic[]
): CargoDeclaration | undefined {
	const match = /^=([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(rawVersion);
	const version = match?.[1];
	if (version === undefined) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`${name} is not pinned to an exact Cargo version.`,
				'Prefix the exact Cargo dependency version with =.'
			)
		);
		return undefined;
	}
	return { alias, name, version, kind, path, features, defaultFeatures, optional, targetScope };
}

function normalizeCargoTargetScope(selector: string): string {
	let normalized = '';
	let quote: 'single' | 'double' | undefined;
	let escaped = false;
	for (const character of selector.trim()) {
		if (quote !== undefined) {
			normalized += character;
			if (quote === 'double' && character === '\\' && !escaped) {
				escaped = true;
				continue;
			}
			if (
				(quote === 'single' && character === "'") ||
				(quote === 'double' && character === '"' && !escaped)
			)
				quote = undefined;
			escaped = false;
			continue;
		}
		if (/\s/u.test(character)) continue;
		normalized += character;
		if (character === "'") quote = 'single';
		else if (character === '"') quote = 'double';
	}
	return normalized;
}

function checkCargoFeatureForwarding(
	manifest: TomlTable,
	path: string,
	declarations: readonly CargoDeclaration[],
	diagnostics: Diagnostic[]
): void {
	const features = asTable(manifest.features);
	if (features === undefined) return;
	const dependenciesByAlias = new Map(
		declarations.map((declaration) => [declaration.alias, declaration])
	);
	for (const [featureName, value] of Object.entries(features)) {
		if (!Array.isArray(value)) continue;
		for (const member of value) {
			if (typeof member !== 'string') continue;
			const match = /^([A-Za-z0-9_-]+)(?:\?)?\/(.+)$/.exec(member);
			if (match === null) continue;
			const dependency = dependenciesByAlias.get(match[1] as string);
			const dependencyFeature = match[2] as string;
			if (dependency === undefined || !dependency.features.includes(dependencyFeature)) {
				diagnostics.push(
					diagnostic(
						'dependencies.admission',
						path,
						`Cargo feature ${featureName} forwards unadmitted dependency feature ${member}.`,
						'Declare the dependency feature in the exact Cargo dependency admission or remove the forwarding feature.'
					)
				);
			}
		}
	}
}

function checkCargoOverrides(manifest: TomlTable, path: string, diagnostics: Diagnostic[]): void {
	for (const key of ['patch', 'replace']) {
		if (Object.hasOwn(manifest, key))
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					`Cargo override [${key}] is not admitted.`,
					'Remove dependency patch/replace overrides, or model their exact source and revision in dependency policy.'
				)
			);
	}
}

function checkCargoConfiguration(repository: Repository, diagnostics: Diagnostic[]): void {
	for (const path of repository
		.files()
		.filter((candidate) => /(?:^|\/)\.cargo\/config(?:\.toml)?$/.test(candidate)))
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				'Tracked Cargo configuration is not admitted.',
				'Remove the configuration, or extend dependency policy to model every build and source override it permits.'
			)
		);
}

function reconcileCargoAdmissions(
	declared: ReadonlyMap<string, readonly CargoDeclaration[]>,
	admissions: readonly CargoAdmission[],
	diagnostics: Diagnostic[]
): void {
	const admitted = new Map<string, CargoAdmission>();
	for (const entry of admissions) {
		if (admitted.has(entry.package))
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					'build/policies/dependencies.json',
					`${entry.package} has duplicate Cargo admission records.`,
					'Keep exactly one reviewed admission per ecosystem and package.'
				)
			);
		else admitted.set(entry.package, entry);
	}
	for (const [name, declarations] of declared) {
		const entry = admitted.get(name);
		if (entry === undefined) {
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					declarations[0]?.path ?? 'native/Cargo.toml',
					`${name} is not admitted as a Cargo dependency.`,
					'Add a complete cargo entry to build/policies/dependencies.json.'
				)
			);
			continue;
		}
		const actualVersions = new Set(declarations.map((declaration) => declaration.version));
		const actual = declarations
			.map(normalizeCargoDeclaration)
			.sort(compareNormalizedDeclarations);
		const expected = (entry.declarations ?? [])
			.map(normalizeCargoAdmissionDeclaration)
			.sort(compareNormalizedDeclarations);
		if (
			expected.some((declaration) => declaration.kind !== entry.kind) ||
			actualVersions.size !== 1 ||
			!actualVersions.has(entry.version) ||
			actual.length !== expected.length ||
			actual.some(
				(declaration, index) =>
					declarationSignature(declaration) !== declarationSignature(expected[index])
			)
		) {
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					declarations[0]?.path ?? 'native/Cargo.toml',
					`${name} does not match its admitted Cargo version or exact per-manifest declaration tuples.`,
					'Update every Cargo manifest, the lockfile, and the complete declaration admission together.'
				)
			);
		}
	}
	for (const entry of admissions)
		if (!declared.has(entry.package))
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					'build/policies/dependencies.json',
					`${entry.package} is admitted for Cargo but not declared.`,
					'Remove the orphan admission or declare the Cargo dependency.'
				)
			);
}

type NormalizedCargoDeclaration = {
	readonly manifest: string;
	readonly alias: string;
	readonly kind: 'development' | 'production';
	readonly features: readonly string[];
	readonly defaultFeatures: boolean;
	readonly optional: boolean;
	readonly targetScope: string | null;
};

function normalizeCargoDeclaration(declaration: CargoDeclaration): NormalizedCargoDeclaration {
	return {
		manifest: declaration.path,
		alias: declaration.alias,
		kind: declaration.kind,
		features: [...declaration.features].sort(),
		defaultFeatures: declaration.defaultFeatures,
		optional: declaration.optional,
		targetScope: declaration.targetScope
	};
}

function normalizeCargoAdmissionDeclaration(
	declaration: CargoAdmissionDeclaration
): NormalizedCargoDeclaration {
	return {
		...declaration,
		features: [...declaration.features].sort(),
		targetScope:
			typeof declaration.targetScope === 'string'
				? normalizeCargoTargetScope(declaration.targetScope)
				: null
	};
}

function declarationSignature(declaration: NormalizedCargoDeclaration | undefined): string {
	return JSON.stringify(declaration);
}

function compareNormalizedDeclarations(
	left: NormalizedCargoDeclaration,
	right: NormalizedCargoDeclaration
): number {
	return declarationSignature(left).localeCompare(declarationSignature(right));
}

function validateCargoLocalPath(
	repository: Repository,
	manifestPath: string,
	dependencyPath: string,
	workspaceManifests: ReadonlySet<string>,
	diagnostics: Diagnostic[]
): void {
	const windowsAbsolute =
		/^[A-Za-z]:[\\/]/.test(dependencyPath) || dependencyPath.startsWith('\\\\');
	const target = posix.normalize(
		posix.join(posix.dirname(manifestPath), dependencyPath, 'Cargo.toml')
	);
	if (
		dependencyPath.includes('\\') ||
		posix.isAbsolute(dependencyPath) ||
		windowsAbsolute ||
		!target.startsWith('native/') ||
		!workspaceManifests.has(target) ||
		!repository.exists(target)
	)
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				manifestPath,
				`Cargo path dependency ${dependencyPath} is not a tracked member of the native workspace.`,
				'Use a portable repository-relative path to a declared native workspace package.'
			)
		);
}

function asTable(value: TomlValue | undefined): TomlTable | undefined {
	return typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		!(value instanceof Date)
		? (value as TomlTable)
		: undefined;
}
