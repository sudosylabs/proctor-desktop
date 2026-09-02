import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repositoryPath, repositoryRoot } from './paths.ts';
import { electronExecutable } from './electron.ts';

export interface EnvironmentFact {
	readonly name: string;
	readonly ok: boolean;
	readonly detail: string;
}

function version(command: string, arguments_: readonly string[]): string {
	const result = spawnSync(command, [...arguments_], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		timeout: 10_000
	});
	if (result.error || result.status !== 0) return 'unavailable';
	return result.stdout.trim();
}

export function inspectEnvironment(includeElectron = true): EnvironmentFact[] {
	const manifest = JSON.parse(readFileSync(repositoryPath('package.json'), 'utf8')) as {
		engines: { node: string; npm: string };
		devDependencies: Record<string, string>;
		dependencies: Record<string, string>;
	};
	const expectedRust = /channel\s*=\s*"([^"]+)"/.exec(
		readFileSync(repositoryPath('rust-toolchain.toml'), 'utf8')
	)?.[1];
	const npmCli =
		process.env.npm_execpath ??
		join(
			dirname(process.execPath),
			process.platform === 'win32'
				? 'node_modules/npm/bin/npm-cli.js'
				: '../lib/node_modules/npm/bin/npm-cli.js'
		);
	const npmVersion = version(process.execPath, [npmCli, '--version']);
	const rust = version('rustup', ['run', expectedRust ?? '', 'rustc', '--version']);
	const components = version('rustup', [
		'component',
		'list',
		'--toolchain',
		expectedRust ?? '',
		'--installed'
	]);
	const facts: EnvironmentFact[] = [
		{
			name: 'Node',
			ok: process.versions.node === manifest.engines.node,
			detail: `${process.versions.node}; expected ${manifest.engines.node}`
		},
		{
			name: 'npm',
			ok: npmVersion === manifest.engines.npm,
			detail: `${npmVersion}; expected ${manifest.engines.npm}`
		},
		{
			name: 'Rust',
			ok: rust.startsWith(`rustc ${expectedRust} `),
			detail: `${rust}; expected installed toolchain ${expectedRust}`
		},
		{
			name: 'Rust components',
			ok: ['clippy', 'rustfmt', 'rust-analyzer'].every((name) =>
				components.split(/\r?\n/).some((line) => line.startsWith(`${name}-`))
			),
			detail: 'The pinned Rust toolchain needs clippy, rustfmt and rust-analyzer installed.'
		},
		{
			name: 'Dependencies',
			ok: Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).every(
				([name, expected]) => {
					try {
						return (
							(
								JSON.parse(
									readFileSync(
										repositoryPath(`node_modules/${name}/package.json`),
										'utf8'
									)
								) as { version: string }
							).version === expected
						);
					} catch {
						return false;
					}
				}
			),
			detail: 'Exact declared packages must be present; run npm ci when absent or stale.'
		}
	];
	if (includeElectron) {
		try {
			facts.push({ name: 'Electron', ok: true, detail: electronExecutable() });
		} catch (error) {
			facts.push({ name: 'Electron', ok: false, detail: String(error) });
		}
	}
	if (process.platform === 'linux')
		facts.push({
			name: 'Graphical session',
			ok: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
			detail: 'Electron tests need DISPLAY/WAYLAND_DISPLAY; CI uses xvfb-run.'
		});
	if (process.platform === 'darwin')
		facts.push({
			name: 'Native compiler',
			ok: version('xcode-select', ['-p']) !== 'unavailable',
			detail: 'Xcode command-line tools are required for native builds.'
		});
	if (process.platform === 'win32') {
		const vswhere = join(
			process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
			'Microsoft Visual Studio/Installer/vswhere.exe'
		);
		const compiler = version(vswhere, [
			'-latest',
			'-products',
			'*',
			'-requires',
			'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
			'-property',
			'installationPath'
		]);
		facts.push({
			name: 'Native compiler',
			ok: compiler !== 'unavailable' && compiler.length > 0,
			detail: 'Visual Studio C++ build tools are required by the Rust MSVC target.'
		});
	}
	if (!existsSync(repositoryPath('.git')))
		facts.push({
			name: 'Git checkout',
			ok: false,
			detail: 'Repository checks require a Git checkout.'
		});
	return facts;
}
