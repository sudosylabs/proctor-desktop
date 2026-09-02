import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { DependencyPolicy } from './policies.ts';

type NpmLock = {
	readonly packages: Readonly<
		Record<string, { readonly version?: string; readonly license?: string }>
	>;
};

type CargoMetadata = {
	readonly packages: readonly {
		readonly name: string;
		readonly version: string;
		readonly source: string | null;
		readonly license: string | null;
	}[];
};

const npmLock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as NpmLock;
const policy = JSON.parse(
	readFileSync('build/policies/dependencies.json', 'utf8')
) as DependencyPolicy;
const allowedLicenseExpressions = new Set(policy.allowedLicenseExpressions);
let checkedNpm = 0;
for (const [path, dependency] of Object.entries(npmLock.packages)) {
	if (path === '') continue;
	checkedNpm += 1;
	requireAllowedLicense(`npm ${path}`, dependency.license);
}

const cargoMetadata = JSON.parse(
	execFileSync(
		'cargo',
		['metadata', '--locked', '--format-version', '1', '--manifest-path', 'native/Cargo.toml'],
		{ encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
	)
) as CargoMetadata;
let checkedCargo = 0;
for (const dependency of cargoMetadata.packages) {
	if (dependency.source === null) continue;
	checkedCargo += 1;
	requireAllowedLicense(
		`Cargo ${dependency.name}@${dependency.version}`,
		dependency.license ?? undefined
	);
}

for (const admission of policy.dependencies) {
	if ((admission.ecosystem ?? 'npm') === 'npm') {
		const actual = npmLock.packages[`node_modules/${admission.package}`];
		requireExactDirectLicense('npm', admission, actual?.license, actual?.version);
		continue;
	}
	const actual = cargoMetadata.packages.find(
		(candidate) => candidate.source !== null && candidate.name === admission.package
	);
	requireExactDirectLicense('Cargo', admission, actual?.license ?? undefined, actual?.version);
}

console.log(`Checked licenses for ${checkedNpm} npm packages and ${checkedCargo} Cargo packages.`);

function requireAllowedLicense(dependency: string, license: string | undefined): void {
	if (license === undefined)
		throw new Error(`${dependency} does not declare an SPDX license expression.`);
	if (!allowedLicenseExpressions.has(license))
		throw new Error(`${dependency} uses unreviewed license expression ${license}.`);
}

function requireExactDirectLicense(
	ecosystem: string,
	admission: DependencyPolicy['dependencies'][number],
	actualLicense: string | undefined,
	actualVersion: string | undefined
): void {
	if (actualVersion !== admission.version)
		throw new Error(
			`${ecosystem} ${admission.package} resolves to ${actualVersion ?? 'nothing'}, not admitted version ${admission.version}.`
		);
	if (actualLicense !== admission.license)
		throw new Error(
			`${ecosystem} ${admission.package}@${admission.version} declares ${actualLicense ?? 'no license'}, not admitted license ${admission.license}.`
		);
}
