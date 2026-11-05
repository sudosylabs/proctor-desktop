import { readFileSync } from 'node:fs';
import { repositoryPath } from './lib/paths.ts';

export interface Task {
	readonly group: 'verify' | 'test' | 'build' | 'develop' | 'maintain' | 'native';
	readonly description: string;
}

/** Every npm script is described here once; npm scripts stay the executable entry points. */
export const tasks: Readonly<Record<string, Task>> = {
	check: {
		group: 'verify',
		description: 'Types, lint, format, repository controls, licenses, unit tests'
	},
	'check:all': { group: 'verify', description: 'check plus real-Electron and native tests' },
	'check:assurance': { group: 'verify', description: 'Assurance coverage control only' },
	'check:dependencies': { group: 'verify', description: 'Dependency admission control only' },
	'check:docs': {
		group: 'verify',
		description: 'Documentation, hygiene and pinned-action controls'
	},
	'check:generated': { group: 'verify', description: 'Generated-artifact parity control only' },
	'check:layers': { group: 'verify', description: 'Layer dependency graph control only' },
	'check:licenses': { group: 'verify', description: 'Dependency license check' },
	'check:provenance': { group: 'verify', description: 'Upstream provenance control only' },
	'check:source': { group: 'verify', description: 'Source graph, compositions and CSS controls' },
	'check:staged': { group: 'verify', description: 'Checks for staged files (pre-commit)' },
	'check:types': { group: 'verify', description: 'TypeScript project references' },
	lint: { group: 'verify', description: 'ESLint across the repository' },
	'lint:fix': { group: 'verify', description: 'ESLint with fixes for authored files' },
	'format:check': { group: 'verify', description: 'Formatting check' },
	format: { group: 'maintain', description: 'Write formatting' },
	inspect: { group: 'verify', description: 'Print the repository-control inventory' },
	test: { group: 'test', description: 'Alias for test:unit' },
	'test:unit': { group: 'test', description: 'All Node-runtime suites' },
	'test:base': { group: 'test', description: 'Base common suite' },
	'test:platform-foundation': { group: 'test', description: 'Platform and workbench suites' },
	'test:checks': { group: 'test', description: 'Repository-control tests' },
	'test:browser': { group: 'test', description: 'Chromium renderer harness' },
	'test:electron': { group: 'test', description: 'Real-Electron suites (needs npm run setup)' },
	'test:editor': { group: 'test', description: 'Editor suites' },
	'test:native': { group: 'native', description: 'Rust native-package tests' },
	'test:security-utility': { group: 'test', description: 'Security-utility suite' },
	'test:window-skeleton': { group: 'test', description: 'Window skeleton suite' },
	'test:desktop-identity': { group: 'test', description: 'Desktop identity suite' },
	'build:security-utility': { group: 'build', description: 'Bundle the security utility' },
	'build:browser-harness': { group: 'build', description: 'Bundle the Chromium test harness' },
	'build:base-common-tests': { group: 'build', description: 'Bundle base common tests' },
	'build:platform-foundation-tests': { group: 'build', description: 'Bundle platform tests' },
	'build:editor-core-tests': { group: 'build', description: 'Bundle editor core tests' },
	'build:window-skeleton': { group: 'build', description: 'Bundle the window skeleton' },
	'stage:native-service': { group: 'native', description: 'Stage the macOS native service' },
	'verify:native-service': { group: 'native', description: 'Verify the macOS native service' },
	'inventory:native-service:windows': {
		group: 'native',
		description: 'Windows native-service inventory'
	},
	generate: { group: 'maintain', description: 'Write generated artifacts' },
	'api:sync': { group: 'maintain', description: 'Sync the server API snapshot' },
	'audit:upstream': { group: 'maintain', description: 'Audit VS Code port manifests' },
	'audit:dependencies': { group: 'maintain', description: 'npm audit at high severity' },
	doctor: { group: 'maintain', description: 'Report missing local prerequisites' },
	setup: { group: 'maintain', description: 'Provision Electron and tools' },
	'hooks:enable': { group: 'maintain', description: 'Use .githooks for this checkout' },
	'hooks:disable': { group: 'maintain', description: 'Stop using .githooks' },
	dev: { group: 'develop', description: 'Run the desktop app for development' },
	'preview:launch': { group: 'develop', description: 'Preview the launch window' },
	'preview:notifications': { group: 'develop', description: 'Preview notifications' }
};

export function packageScripts(): string[] {
	const manifest = JSON.parse(readFileSync(repositoryPath('package.json'), 'utf8')) as {
		scripts: Record<string, string>;
	};
	return Object.keys(manifest.scripts);
}

export function renderTaskIndex(): string {
	const groups = new Map<string, string[]>();
	for (const [name, task] of Object.entries(tasks))
		groups.set(task.group, [...(groups.get(task.group) ?? []), name]);
	return [...groups]
		.map(
			([group, names]) =>
				`${group}\n${names.map((name) => `  ${name.padEnd(34)}${tasks[name]!.description}`).join('\n')}`
		)
		.join('\n\n');
}

if (import.meta.main) {
	if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--list'))
		throw new Error('Usage: npm run tasks');
	console.log(renderTaskIndex());
}
