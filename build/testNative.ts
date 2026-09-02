import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { repositoryRoot } from './lib/paths.ts';

const MANIFEST = 'native/Cargo.toml';

export type NativeTestSelection = {
	readonly package?: string;
	readonly target?: string;
	readonly help: boolean;
};

export type NativeTestCommand = {
	readonly phase: 'format' | 'lint' | 'test';
	readonly arguments: readonly string[];
};

export function parseNativeTestArguments(arguments_: readonly string[]): NativeTestSelection {
	let packageName: string | undefined;
	let target: string | undefined;
	let help = false;
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === '--help') {
			help = true;
		} else if (argument === '--package') {
			packageName = exactSelectorValue(arguments_, ++index, '--package', packageName);
		} else if (argument === '--target') {
			target = exactSelectorValue(arguments_, ++index, '--target', target);
			if (!/^[A-Za-z0-9_]+(?:-[A-Za-z0-9_.]+)+$/.test(target)) {
				throw new Error('--target requires one exact Rust target triple');
			}
		} else {
			throw new Error(`Unknown native test argument ${String(argument)}`);
		}
	}
	return {
		...(packageName === undefined ? {} : { package: packageName }),
		...(target === undefined ? {} : { target }),
		help
	};
}

export function planNativeTestCommands(
	selection: NativeTestSelection
): readonly NativeTestCommand[] {
	const packageScope =
		selection.package === undefined ? ['--workspace'] : ['--package', selection.package];
	const formatScope =
		selection.package === undefined ? ['--all'] : ['--package', selection.package];
	const targetScope = selection.target === undefined ? [] : ['--target', selection.target];
	return [
		{
			phase: 'format',
			arguments: ['fmt', '--manifest-path', MANIFEST, ...formatScope, '--', '--check']
		},
		{
			phase: 'lint',
			arguments: [
				'clippy',
				'--locked',
				'--manifest-path',
				MANIFEST,
				...packageScope,
				'--all-targets',
				...targetScope,
				'--',
				'-D',
				'warnings'
			]
		},
		{
			phase: 'test',
			arguments: [
				'test',
				'--locked',
				'--manifest-path',
				MANIFEST,
				...packageScope,
				...targetScope
			]
		}
	];
}

export function validateNativeTestSelection(
	selection: NativeTestSelection,
	availablePackages: ReadonlySet<string>,
	availableTargets: ReadonlySet<string>
): void {
	if (selection.package !== undefined && !availablePackages.has(selection.package)) {
		throw new Error(`Unknown native workspace package ${selection.package}`);
	}
	if (selection.target !== undefined && !availableTargets.has(selection.target)) {
		throw new Error(`Unknown built-in Rust target ${selection.target}`);
	}
}

function exactSelectorValue(
	arguments_: readonly string[],
	index: number,
	option: string,
	previous: string | undefined
): string {
	const value = arguments_[index];
	if (previous !== undefined) throw new Error(`${option} may be provided only once`);
	if (value === undefined || value.startsWith('-') || !/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new Error(`${option} requires one exact selector`);
	}
	return value;
}

function run(selection: NativeTestSelection): void {
	if (selection.help) {
		process.stdout.write(
			[
				'Usage: npm run test:native -- [--package <workspace-package>] [--target <rust-target>]',
				'',
				'Without selectors, verifies the complete native workspace.',
				'--package applies the same package focus to fmt, Clippy, and tests.',
				'--target applies the compilation target to Clippy and tests; formatting remains target-neutral.',
				''
			].join('\n')
		);
		return;
	}
	validateNativeTestSelection(selection, workspacePackages(), rustTargets());
	for (const command of planNativeTestCommands(selection)) cargo(command.arguments);
}

function workspacePackages(): ReadonlySet<string> {
	const output = execFileSync(
		'cargo',
		['metadata', '--locked', '--no-deps', '--format-version', '1', '--manifest-path', MANIFEST],
		{ encoding: 'utf8', cwd: repositoryRoot }
	);
	const metadata = JSON.parse(output) as {
		readonly packages?: readonly { readonly name?: unknown }[];
	};
	return new Set(
		(metadata.packages ?? [])
			.map((candidate) => candidate.name)
			.filter((name): name is string => typeof name === 'string')
	);
}

function rustTargets(): ReadonlySet<string> {
	const output = execFileSync('rustc', ['--print', 'target-list'], {
		encoding: 'utf8',
		cwd: repositoryRoot
	});
	return new Set(output.split(/\r?\n/u).filter((target) => target.length > 0));
}

function cargo(arguments_: readonly string[]): void {
	try {
		execFileSync('cargo', [...arguments_], { stdio: 'inherit', cwd: repositoryRoot });
	} catch (error) {
		throw new Error(`native test command failed: cargo ${arguments_.join(' ')}`, {
			cause: error
		});
	}
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
	run(parseNativeTestArguments(process.argv.slice(2)));
}
