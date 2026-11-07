import { spawn } from 'node:child_process';
import { runNode } from '../build/lib/process.ts';
import { developmentLaunch } from '../build/lib/electron.ts';
import { repositoryRoot } from '../build/lib/paths.ts';

if (process.argv.length > 2) throw new Error('Usage: npm run preview:launch');
runNode(['build/buildWindowSkeleton.ts']);
const launch = developmentLaunch(['.build/window-skeleton/preview.js']);
const child = spawn(launch.command, launch.args, {
	cwd: repositoryRoot,
	stdio: 'inherit'
});
child.once('error', (error) => {
	console.error(error);
	process.exitCode = 1;
});
child.once('exit', (code, signal) => {
	process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1);
});
