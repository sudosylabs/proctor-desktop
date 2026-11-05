import type { Check, Diagnostic, Repository } from './types.ts';
import { diagnostic } from './types.ts';
import { readJson, validatePolicies } from './policies.ts';
import type { AssurancePolicy } from './policies.ts';

const INVARIANT_PATTERN = /^\d+\.\s+`([a-z][a-z0-9.-]+)`/gm;

function activationPresent(
	repository: Repository,
	activation: NonNullable<AssurancePolicy['controls'][number]['activation']>
): boolean {
	const files = repository.files();
	switch (activation) {
		case 'source-present':
			return files.some((path) => path.startsWith('src/prctr/') && path.endsWith('.ts'));
		case 'workspace-source-present':
			return files.some(
				(path) => path.includes('/attemptWorkspace/') || path.includes('/workspace/')
			);
		case 'browser-source-present':
			return files.some((path) => path.includes('/integratedBrowser/'));
		case 'code-layer-present':
			return files.some((path) => path.startsWith('src/prctr/code/'));
		case 'css-present':
			return files.some((path) => path.startsWith('src/prctr/') && path.endsWith('.css'));
		case 'settings-registry-present':
			return repository.exists('src/prctr/platform/settings/common/settingsManifest.ts');
		case 'native-package-present':
			return files.some((path) => path.startsWith('native/') || path.endsWith('/Cargo.toml'));
		case 'packaged-target-present':
			return (
				repository.exists('forge.config.ts') ||
				repository.exists('build/policies/release-targets.json')
			);
	}
}

export const policySchemaCheck: Check = {
	id: 'policy.schemas',
	category: 'assurance',
	contractRequired: true,
	run: ({ repository }) => validatePolicies(repository)
};

export const assuranceCheck: Check = {
	id: 'assurance.coverage',
	category: 'assurance',
	contractRequired: true,
	run: ({ repository, registeredCheckIds }) => {
		const checkId = 'assurance.coverage';
		const path = 'build/policies/assurance.json';
		const diagnostics: Diagnostic[] = [];
		let policy: AssurancePolicy;
		try {
			policy = readJson<AssurancePolicy>(repository, path);
		} catch (error) {
			return [
				diagnostic(checkId, path, String(error), 'Make the assurance catalog valid JSON.')
			];
		}
		if (!repository.exists(policy.invariantSource))
			return [
				diagnostic(
					checkId,
					policy.invariantSource,
					'The invariant source does not exist.',
					'Point invariantSource at the canonical invariant document.'
				)
			];
		const invariants = [
			...repository.read(policy.invariantSource).matchAll(INVARIANT_PATTERN)
		].map((match) => match[1] as string);
		const known = new Set(invariants);
		const covered = new Set<string>();
		const controlIds = new Set<string>();
		for (const control of policy.controls) {
			if (controlIds.has(control.id))
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						`Control id ${control.id} is duplicated.`,
						'Give every assurance control a stable unique id.'
					)
				);
			controlIds.add(control.id);
			for (const invariant of control.invariants) {
				covered.add(invariant);
				if (!known.has(invariant))
					diagnostics.push(
						diagnostic(
							checkId,
							path,
							`Control ${control.id} names unknown invariant ${invariant}.`,
							'Use an invariant id declared by the numbered invariant list.'
						)
					);
			}
			if (control.status === 'active') {
				if (
					control.implementation !== undefined &&
					!registeredCheckIds.has(control.implementation)
				)
					diagnostics.push(
						diagnostic(
							checkId,
							path,
							`Active control ${control.id} names missing check ${control.implementation}.`,
							'Register the implementation or correct the control.'
						)
					);
				for (const evidence of control.evidence ?? [])
					if (!repository.exists(evidence))
						diagnostics.push(
							diagnostic(
								checkId,
								evidence,
								`Evidence for ${control.id} does not exist.`,
								'Add the evidence or correct the catalog path.'
							)
						);
			} else if (
				control.activation !== undefined &&
				activationPresent(repository, control.activation)
			) {
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						`Deferred control ${control.id} reached activation ${control.activation}.`,
						'Implement and activate the required control before landing the triggering source.'
					)
				);
			}
		}
		for (const invariant of invariants)
			if (!covered.has(invariant))
				diagnostics.push(
					diagnostic(
						checkId,
						policy.invariantSource,
						`Invariant ${invariant} has no assurance control.`,
						'Map the invariant to an active or objectively deferred control.'
					)
				);
		if (new Set(invariants).size !== invariants.length)
			diagnostics.push(
				diagnostic(
					checkId,
					policy.invariantSource,
					'Invariant ids are not unique.',
					'Give each numbered invariant one unique semantic id.'
				)
			);
		const exceptionPath = 'build/policies/exceptions.json';
		const exceptionPolicy = readJson<{
			readonly exceptions: readonly {
				readonly id: string;
				readonly check: string;
				readonly target: string;
			}[];
		}>(repository, exceptionPath);
		const exceptionIds = new Set<string>();
		for (const exception of exceptionPolicy.exceptions) {
			if (exceptionIds.has(exception.id))
				diagnostics.push(
					diagnostic(
						checkId,
						exceptionPath,
						`Exception id ${exception.id} is duplicated.`,
						'Give every exception one stable unique id.'
					)
				);
			exceptionIds.add(exception.id);
			if (!registeredCheckIds.has(exception.check))
				diagnostics.push(
					diagnostic(
						checkId,
						exceptionPath,
						`Exception ${exception.id} names unknown check ${exception.check}.`,
						'Remove the orphan exception or name a registered suppressible check.'
					)
				);
			else
				diagnostics.push(
					diagnostic(
						checkId,
						exceptionPath,
						`Exception ${exception.id} targets a check that has not opted into suppression.`,
						'Remove the exception; architecture controls are unsuppressible unless their definition explicitly permits central exceptions.'
					)
				);
			if (!repository.exists(exception.target))
				diagnostics.push(
					diagnostic(
						checkId,
						exceptionPath,
						`Exception ${exception.id} targets missing path ${exception.target}.`,
						'Remove the orphan exception or correct the exact target.'
					)
				);
		}
		return diagnostics;
	}
};

export function assuranceReport(repository: Repository): string {
	const policy = readJson<AssurancePolicy>(repository, 'build/policies/assurance.json');
	const active = policy.controls.filter((control) => control.status === 'active');
	const deferred = policy.controls.filter((control) => control.status === 'deferred');
	const lines = [
		`Assurance controls: ${active.length} active, ${deferred.length} deferred`,
		'',
		'ACTIVE'
	];
	for (const control of active)
		lines.push(
			`  ${control.id} -> ${control.implementation ?? control.evidence?.join(', ') ?? 'review'}`
		);
	lines.push('', 'DEFERRED');
	for (const control of deferred)
		lines.push(`  ${control.id} -> ${control.activation} (${control.owner})`);
	return lines.join('\n');
}
