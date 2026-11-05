import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { build, type BuildOptions } from 'esbuild';
import { nodeTarget, repositoryRoot, repositoryPath, resetBuildOutput } from './lib/paths.ts';

const outputDirectory = resetBuildOutput('security-utility');
const nativeOutput = join(outputDirectory, 'native_node_bridge.node');
const buildIdentity = sourceBuildIdentity();

execFileSync(
	'cargo',
	['build', '--locked', '--manifest-path', 'native/Cargo.toml', '-p', 'native-node-bridge'],
	{ stdio: 'inherit', cwd: repositoryRoot }
);
cpSync(repositoryPath(nativeLibraryPath()), nativeOutput);

const commonOptions: BuildOptions = {
	absWorkingDir: repositoryRoot,
	bundle: true,
	define: {
		__PRCTR_ALLOW_UNSIGNED_SECURITY_UTILITY_NATIVE__: 'true',
		__PRCTR_SECURITY_UTILITY_TEST_DIAGNOSTICS__: 'true',
		__PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__: JSON.stringify(buildIdentity)
	},
	external: ['electron', 'electron/main', 'electron/utility'],
	format: 'esm',
	logLevel: 'info',
	outdir: outputDirectory,
	platform: 'node',
	sourcemap: false,
	target: nodeTarget
};
await Promise.all([
	build({
		...commonOptions,
		tsconfig: 'build/tsconfig.electron-test.json',
		entryPoints: {
			main: 'src/prctr/code/electron-main/securityUtilityComposition.ts',
			'test-main': 'test/electron/securityUtilityMain.ts'
		}
	}),
	build({
		...commonOptions,
		tsconfig: 'build/tsconfig.electron-utility.json',
		entryPoints: {
			'security-utility': 'src/prctr/code/electron-utility/securityUtilityEntryPoint.ts'
		}
	})
]);
writeFileSync(
	join(outputDirectory, 'package.json'),
	`${JSON.stringify(
		{
			name: 'proctor-security-utility-test-harness',
			private: true,
			type: 'module',
			main: 'test-main.js'
		},
		null,
		2
	)}\n`,
	'utf8'
);

function nativeLibraryPath(): string {
	if (process.platform === 'win32') {
		return 'native/target/debug/native_node_bridge.dll';
	}
	const extension = process.platform === 'darwin' ? 'dylib' : 'so';
	return `native/target/debug/libnative_node_bridge.${extension}`;
}

function sourceBuildIdentity(): string {
	const hash = createHash('sha256');
	const roots = [
		'package.json',
		'package-lock.json',
		'native/Cargo.lock',
		'native/Cargo.toml',
		'native/crates',
		'native/schemas',
		'src/prctr'
	];
	for (const path of roots.flatMap(walkFiles).sort()) {
		hash.update(path);
		hash.update('\0');
		hash.update(readFileSync(repositoryPath(path)));
		hash.update('\0');
	}
	return `proctor-desktop@0.0.0-private:${hash.digest('hex')}`;
}

function walkFiles(path: string): readonly string[] {
	const stat = statSync(repositoryPath(path));
	if (stat.isFile()) return [path];
	return readdirSync(repositoryPath(path), { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === 'target' || entry.name.startsWith('.')) return [];
		return walkFiles(posix.join(path, entry.name));
	});
}
