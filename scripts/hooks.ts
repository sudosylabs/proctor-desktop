import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from '../build/lib/paths.ts';

const [action, ...extra] = process.argv.slice(2);
if (extra.length || (action !== '--enable' && action !== '--disable'))
	throw new Error('Usage: npm run hooks:enable | npm run hooks:disable');
const result = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
	cwd: repositoryRoot,
	encoding: 'utf8'
});
if (result.error || (result.status !== 0 && result.status !== 1))
	throw result.error ?? new Error('Cannot read repository hook configuration.');
const existing = result.stdout.trim();
const effective = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
	cwd: repositoryRoot,
	encoding: 'utf8'
});
if (effective.error || (effective.status !== 0 && effective.status !== 1))
	throw effective.error ?? new Error('Cannot read inherited hook configuration.');
if (action === '--enable' && effective.stdout.trim() && effective.stdout.trim() !== '.githooks')
	throw new Error('An existing inherited hook configuration will not be replaced.');
if (action === '--enable' && !existing) {
	const previousHook = execFileSync('git', ['rev-parse', '--git-path', 'hooks/pre-commit'], {
		cwd: repositoryRoot,
		encoding: 'utf8'
	}).trim();
	if (existsSync(resolve(repositoryRoot, previousHook)))
		throw new Error('An existing pre-commit hook will not be replaced.');
}
if (existing && existing !== '.githooks')
	throw new Error(`Existing core.hooksPath is ${existing}; it will not be replaced.`);
if (action === '--enable')
	execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
		cwd: repositoryRoot
	});
else if (existing === '.githooks')
	execFileSync('git', ['config', '--local', '--unset', 'core.hooksPath'], {
		cwd: repositoryRoot
	});
console.log(`Optional repository hook ${action === '--enable' ? 'enabled' : 'disabled'}.`);
