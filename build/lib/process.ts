import { execFileSync } from 'node:child_process';
import { repositoryRoot } from './paths.ts';

export function runNode(arguments_: readonly string[]): void {
	execFileSync(process.execPath, [...arguments_], { cwd: repositoryRoot, stdio: 'inherit' });
}
