import { spawnSync } from 'node:child_process';

export type NativePackageTool = 'codesign' | 'security' | 'plutil' | 'lipo' | 'openssl';
export interface NativePackageCommand {
	run(
		tool: NativePackageTool,
		args: readonly string[],
		input?: string | Uint8Array
	): { stdout: string; stderr: string };
}

/** Release inspection uses fixed OS tools, bounded output, and no shell or caller environment. */
export class MacOsNativePackageCommand implements NativePackageCommand {
	public run(
		tool: NativePackageTool,
		args: readonly string[],
		input?: string | Uint8Array
	): { stdout: string; stderr: string } {
		const result = spawnSync(`/usr/bin/${tool}`, args, {
			encoding: 'utf8',
			input,
			timeout: 30_000,
			maxBuffer: 4 * 1024 * 1024,
			env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' }
		});
		if (result.error || result.status !== 0 || result.signal)
			throw new Error(`${tool} verification failed`);
		return { stdout: result.stdout, stderr: result.stderr };
	}
}
