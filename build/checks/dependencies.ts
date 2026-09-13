import type { Check, Diagnostic, Repository } from './types.ts';
import { diagnostic } from './types.ts';
import { readJson, type DependencyAdmission, type DependencyPolicy } from './policies.ts';
import { checkCargoDependencies } from './cargoDependencies.ts';
import { parse as parseYaml } from 'yaml';

type PackageManifest = {
	readonly packageManager?: string;
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly devDependencies?: Readonly<Record<string, string>>;
	readonly allowScripts?: Readonly<Record<string, boolean>>;
	readonly scripts?: Readonly<Record<string, string>>;
};

export const dependencyCheck: Check = {
	id: 'dependencies.admission',
	category: 'dependency',
	contractRequired: true,
	run: ({ repository }) => {
		const path = 'package.json';
		const diagnostics: Diagnostic[] = [];
		const manifest = readJson<PackageManifest>(repository, path);
		const policy = readJson<DependencyPolicy>(repository, 'build/policies/dependencies.json');
		const npmAdmissions = policy.dependencies.filter(
			(entry) => (entry.ecosystem ?? 'npm') === 'npm'
		);
		const admitted = new Map<string, DependencyAdmission>();
		for (const entry of npmAdmissions) {
			if (admitted.has(entry.package))
				diagnostics.push(
					diagnostic(
						'dependencies.admission',
						'build/policies/dependencies.json',
						`${entry.package} has duplicate npm admission records.`,
						'Keep exactly one reviewed admission per ecosystem and package.'
					)
				);
			else admitted.set(entry.package, entry);
		}
		const declared = new Map<string, { version: string; kind: 'development' | 'production' }>();
		for (const [name, version] of Object.entries(manifest.dependencies ?? {}))
			declared.set(name, { version, kind: 'production' });
		for (const [name, version] of Object.entries(manifest.devDependencies ?? {}))
			declared.set(name, { version, kind: 'development' });
		for (const [name, declaration] of declared) {
			const entry = admitted.get(name);
			if (entry === undefined)
				diagnostics.push(
					diagnostic(
						'dependencies.admission',
						path,
						`${name} is not admitted.`,
						'Add a complete reviewed entry to build/policies/dependencies.json.'
					)
				);
			else if (entry.version !== declaration.version || entry.kind !== declaration.kind)
				diagnostics.push(
					diagnostic(
						'dependencies.admission',
						path,
						`${name} does not match its admitted version or kind.`,
						'Update the manifest, lockfile, and admission record together.'
					)
				);
			if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(declaration.version))
				diagnostics.push(
					diagnostic(
						'dependencies.admission',
						path,
						`${name} is not pinned to an exact version.`,
						'Use an exact dependency version.'
					)
				);
		}
		for (const entry of npmAdmissions)
			if (!declared.has(entry.package))
				diagnostics.push(
					diagnostic(
						'dependencies.admission',
						'build/policies/dependencies.json',
						`${entry.package} is admitted but not declared.`,
						'Remove the orphan admission or declare the dependency.'
					)
				);
		const scripts = manifest.allowScripts ?? {};
		for (const [name, allowed] of Object.entries(scripts)) {
			const entry = admitted.get(name);
			if (entry === undefined || !declared.has(name))
				diagnostics.push(
					diagnostic(
						'dependencies.admission',
						path,
						`allowScripts contains orphan package ${name}.`,
						'Remove the orphan lifecycle-script decision.'
					)
				);
			else if ((entry.lifecycleScripts === 'allowed') !== allowed)
				diagnostics.push(
					diagnostic(
						'dependencies.admission',
						path,
						`allowScripts disagrees with the admission for ${name}.`,
						'Reconcile lifecycle-script policy and package metadata.'
					)
				);
		}
		for (const entry of npmAdmissions)
			if (entry.lifecycleScripts === 'allowed' && scripts[entry.package] !== true)
				diagnostics.push(
					diagnostic(
						'dependencies.admission',
						path,
						`${entry.package} requires an explicit allowed lifecycle-script entry.`,
						'Set allowScripts only after the admission records the reviewed script.'
					)
				);
		checkCargoDependencies(
			repository,
			policy.dependencies.filter((entry) => entry.ecosystem === 'cargo'),
			diagnostics
		);
		if (manifest.scripts?.['audit:dependencies'] !== 'npm audit --audit-level=high')
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					'npm vulnerability audit command is missing or weakened.',
					'Run the npm advisory scan at the accepted severity.'
				)
			);
		if (manifest.scripts?.['check:licenses'] !== 'node build/checks/dependencyLicenses.ts')
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					'Dependency license verification command is missing.',
					'Keep the automated npm and Cargo license gate in the active check graph.'
				)
			);
		if (manifest.scripts?.['test:native'] !== 'node build/testNative.ts')
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					'The native test command bypasses its typed selector module.',
					'Keep test:native as the thin platform-neutral build-module entrypoint.'
				)
			);
		checkVulnerabilityWorkflow(repository, diagnostics);
		if (manifest.packageManager !== 'npm@11.19.0')
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					'packageManager is not the accepted exact npm version.',
					'Set packageManager to npm@11.19.0.'
				)
			);
		return diagnostics;
	}
};

function checkVulnerabilityWorkflow(repository: Repository, diagnostics: Diagnostic[]): void {
	const path = '.github/workflows/foundation.yml';
	if (!repository.exists(path)) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				'Dependency vulnerability audit workflow is missing.',
				'Run the pinned RustSec action and npm audit in CI.'
			)
		);
		return;
	}
	let document: unknown;
	try {
		document = parseYaml(repository.read(path));
	} catch (error) {
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				`Dependency audit workflow is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
				'Use a valid workflow with exact audit steps.'
			)
		);
		return;
	}
	const foundation = requiredWorkflowJob(document, 'foundation');
	const dependencyAudit = requiredWorkflowJob(document, 'dependency-audit');
	const nativeTargets = requiredWorkflowJob(document, 'native-targets');
	for (const [name, job] of [
		['foundation', foundation],
		['native-targets', nativeTargets]
	] as const) {
		if (job === undefined || !hasSafeNpmBootstrap(job))
			diagnostics.push(
				diagnostic(
					'dependencies.admission',
					path,
					`${name} setup-node may invoke the wrong npm before the exact npm bootstrap.`,
					'Disable setup-node package-manager caching and install npm 11.19.0 from runner.temp before entering the repository package graph.'
				)
			);
	}
	const cargoAuditInstall = dependencyAudit?.steps.findIndex(
		(step) =>
			isRequiredStep(step) &&
			step.run === 'cargo install cargo-audit --version 0.22.2 --locked'
	);
	const cargoAuditAction = dependencyAudit?.steps.findIndex(
		(step) =>
			isRequiredStep(step) &&
			step.uses === 'rustsec/audit-check@858dc40f52ca2b8570b7a997c1c4e35c6fc9a432' &&
			step.with?.['working-directory'] === 'native'
	);
	const rustAudit =
		dependencyAudit !== undefined &&
		dependencyAuditJobHasRequiredPermissions(dependencyAudit) &&
		cargoAuditInstall !== undefined &&
		cargoAuditAction !== undefined &&
		cargoAuditInstall >= 0 &&
		cargoAuditAction > cargoAuditInstall;
	if (!rustAudit)
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				'The exact cargo-audit bootstrap is missing, unordered, or mis-scoped.',
				'Install cargo-audit 0.22.2 with its published lock before running the exact pinned RustSec action against native/Cargo.lock.'
			)
		);
	if (
		foundation === undefined ||
		!foundation.steps.some(
			(step) => isRequiredStep(step) && step.run === 'npm run audit:dependencies'
		)
	)
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				'The npm vulnerability audit is not executed in CI.',
				'Run the exact admitted npm audit script in the foundation job.'
			)
		);
	if (!foundationJobIsReadOnly(document))
		diagnostics.push(
			diagnostic(
				'dependencies.admission',
				path,
				'The foundation job has permissions beyond read-only contents.',
				'Keep publishing permissions isolated to a separate dependency-audit job.'
			)
		);
}

type WorkflowStep = {
	readonly uses?: string;
	readonly run?: string;
	readonly with?: Readonly<Record<string, unknown>>;
	readonly workingDirectory?: string;
	readonly if?: unknown;
	readonly continueOnError?: unknown;
};
type WorkflowJob = {
	readonly steps: readonly WorkflowStep[];
	readonly permissions?: Readonly<Record<string, unknown>>;
};

function requiredWorkflowJob(document: unknown, name: string): WorkflowJob | undefined {
	if (!isRecord(document) || !isRecord(document.jobs)) return undefined;
	const job = document.jobs[name];
	if (
		!isRecord(job) ||
		!Array.isArray(job.steps) ||
		job.if !== undefined ||
		(job['continue-on-error'] !== undefined && job['continue-on-error'] !== false)
	)
		return undefined;
	const steps: WorkflowStep[] = [];
	for (const step of job.steps) {
		if (!isRecord(step)) continue;
		steps.push({
			...(typeof step.uses === 'string' ? { uses: step.uses } : {}),
			...(typeof step.run === 'string' ? { run: step.run } : {}),
			...(isRecord(step.with) ? { with: step.with } : {}),
			...(typeof step['working-directory'] === 'string'
				? { workingDirectory: step['working-directory'] }
				: {}),
			...(step.if !== undefined ? { if: step.if } : {}),
			...(step['continue-on-error'] !== undefined
				? { continueOnError: step['continue-on-error'] }
				: {})
		});
	}
	return { steps, ...(isRecord(job.permissions) ? { permissions: job.permissions } : {}) };
}

function hasSafeNpmBootstrap(job: WorkflowJob): boolean {
	const setup = job.steps.findIndex(
		(step) =>
			isRequiredStep(step) &&
			step.uses === 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38' &&
			step.with?.['node-version-file'] === '.nvmrc' &&
			step.with?.['package-manager-cache'] === false &&
			step.with?.cache === undefined
	);
	const npm = job.steps.findIndex(
		(step) =>
			isRequiredStep(step) &&
			step.run === 'npm install --global npm@11.19.0 --ignore-scripts' &&
			step.workingDirectory === '${{ runner.temp }}'
	);
	return setup >= 0 && npm > setup;
}

function isRequiredStep(step: WorkflowStep): boolean {
	return (
		step.if === undefined &&
		(step.continueOnError === undefined || step.continueOnError === false)
	);
}

function dependencyAuditJobHasRequiredPermissions(job: WorkflowJob): boolean {
	return (
		job.permissions?.checks === 'write' &&
		job.permissions.contents === 'read' &&
		Object.keys(job.permissions).every((key) => key === 'checks' || key === 'contents')
	);
}

function foundationJobIsReadOnly(document: unknown): boolean {
	if (
		!isRecord(document) ||
		!isRecord(document.permissions) ||
		document.permissions.contents !== 'read' ||
		Object.keys(document.permissions).some((key) => key !== 'contents')
	)
		return false;
	if (!isRecord(document.jobs) || !isRecord(document.jobs.foundation)) return false;
	const permissions = document.jobs.foundation.permissions;
	return (
		permissions === undefined ||
		(isRecord(permissions) &&
			permissions.contents === 'read' &&
			Object.keys(permissions).every((key) => key === 'contents'))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
