import { spawn } from 'node:child_process';
import { runNode } from '../build/lib/process.ts';
import { electronExecutable } from '../build/lib/electron.ts';
import { repositoryRoot } from '../build/lib/paths.ts';

const args = process.argv.slice(2);
if (args.includes('--help')) {
	console.log(
		'Usage: npm run dev -- [--release VERSION] [--build-id ID] [--allow-http-loopback]\nUses real server requests. Native signing-key custody is required. Defaults: release 0.0.0-private, build development.'
	);
} else {
	runNode(['build/buildDesktopDevelopment.ts']);
	const child = spawn(electronExecutable(), ['.build/desktop-development', ...args], {
		cwd: repositoryRoot,
		stdio: 'inherit'
	});
	child.once('error', () => {
		console.error('Desktop development launch failed.');
		process.exitCode = 1;
	});
	child.once('exit', (code, signal) => {
		process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1);
	});
}
